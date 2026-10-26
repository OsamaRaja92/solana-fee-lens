# The fee model

What a Solana transaction pays, where each part comes from, and which parts of this were derived
from measurement rather than read from a specification.

Everything here is reproduced by `test/`, and the figures quoted were taken from mainnet blocks
around slot 461,358,125 (25 October 2026).

## The two parts of a fee

A transaction's fee, as reported in `meta.fee`, is the base fee plus the priority fee. Tips are not
part of it.

### Base fee

```
base = 5,000 lamports x (numRequiredSignatures + precompile signatures)
```

Charged per signature, and that includes the signatures verified by the Ed25519, secp256k1 and
secp256r1 precompiles — not only the ones the message header requires. Each precompile instruction
begins with a one-byte count of the signatures it verifies.

Counting only the header understates the base fee by 5,000 lamports per precompile signature. The
fixture `tx-ed25519-precompile.json` is one required signature plus one Ed25519 signature and pays
10,000 lamports of base fee. Precompile transactions are rare — about one per block in the slots
sampled, and none at all in the 1,428 transactions used to develop this — so a corpus check cannot
be relied on to find this. The residual below is what does.

### Priority fee, on legacy and v0

Four ComputeBudget instructions can appear. The first two decide the fee; the others constrain the
transaction without changing what it pays:

| discriminant | instruction                      | payload           |
| ------------ | -------------------------------- | ----------------- |
| `2`          | `SetComputeUnitLimit`            | `u32` units       |
| `3`          | `SetComputeUnitPrice`            | `u64` micro-lamports per unit |
| `4`          | `SetLoadedAccountsDataSizeLimit` | `u32` bytes       |
| `1`          | `RequestHeapFrame`               | `u32` bytes       |

The price is a **rate**, so:

```
priority = ceil(price_micro_lamports x effective_limit / 1,000,000)
```

Rounding is up. `ceil` reproduced every transaction that declared a limit; `floor` did not.

The important consequence: the fee is charged against the limit the transaction **declared**, not
against what it used. Over-declaring costs real lamports.

### Priority fee, on v1

SIMD-0385 moved this into the message header. The RPC exposes it as `message.transactionConfig`:

```json
{
  "computeUnitLimit": 327450,
  "priorityFee": 5008,
  "loadedAccountsDataSizeLimit": 67108864,
  "heapSize": null
}
```

```
priority = transactionConfig.priorityFee ?? 0        // already a lamport total
```

Three differences from legacy and v0, each of which breaks a tool that assumes otherwise:

1. **`priorityFee` is an absolute total in lamports, not a rate.** Multiplying it by a limit, or
   dividing it by a million, gives a wrong answer.
2. **The fee does not scale with the compute unit limit.** Declaring far more compute than you use
   no longer costs lamports. It still costs scheduling priority, because the declared limit feeds
   the block's cost accounting.
3. **ComputeBudget instructions are inert.** They still execute, consume compute and occupy bytes,
   but they configure nothing. A v1 transaction in `test/fixtures` carries a
   `SetComputeUnitLimit(0)` while its header declares 327,450: read the instruction and you get `0`.

An unset v1 limit is **zero**, not the 200,000-per-instruction default of the older versions.

## The compute unit limit the runtime charges against

In precedence order:

1. **v1** — `transactionConfig.computeUnitLimit`, or `0` if absent. The header always wins.
2. **legacy and v0 with a declared limit** — the `SetComputeUnitLimit` value, capped at 1,400,000.
3. **legacy and v0 with no declared limit** — derived by the runtime, below.

### The derived limit

When no limit is declared, the runtime reserves a fixed amount per instruction and sums it:

```
limit = min(1,400,000, sum over instructions of:
              3,000    if the program is a builtin
              200,000  otherwise)
```

The 3,000 figure is the reserve SIMD-0170 assigns to builtins migrated to Core BPF.

**This part was derived from measurement, not read off a page.** The transactions that declare a
price but no limit are the only ones whose fee depends on it, and their fee pins the limit exactly:
`priority = ceil(price x limit / 1e6)` can be inverted to bracket the limit the runtime used. Doing
that across a block gave these cases, every one of which the rule above reproduces:

| instructions                                              | limit implied by the fee | rule gives                   |
| --------------------------------------------------------- | ------------------------ | ---------------------------- |
| ComputeBudget, 2 programs                                  | 403,000                  | 3,000 + 2 x 200,000          |
| ComputeBudget, 1 program                                   | 203,000                  | 3,000 + 200,000              |
| ComputeBudget, 4 programs, System                          | 806,000                  | 2 x 3,000 + 4 x 200,000      |
| ComputeBudget, 5 programs, System                          | 1,006,000                | 2 x 3,000 + 5 x 200,000      |
| 1 System instruction only                                  | 3,000                    | 3,000                        |

Two builtin costs are confirmed this way: System and ComputeBudget, both 3,000. The other builtins
in `src/model/builtins.ts` carry `confirmed: false`: they follow the same documented rule but no
recorded transaction pins them. If one is wrong, the model residual below will say so.

## The self-check

Two independent numbers:

- **modelled** — base plus the priority fee derived from the transaction's own directives.
- **observed** — `meta.fee`, what the chain actually took.

```
residual = observed - modelled
```

A residual of zero means the model reproduced the charge exactly. Measured during development over
three mainnet blocks, **1,428 of 1,428 transactions had a residual of zero**. One of those blocks ships as a fixture, so what you can reproduce from this repository is
the 574 in `test/block.test.ts`; the other two were not kept.

A non-zero residual is surfaced in the output, not smoothed away. It means the model is missing
something about that transaction, and a visible gap is more useful than a confident wrong number.

`impliedPriorityLamports` is reported alongside it: `observed - base`, which needs no model at all
and stays correct even if the model does not.

## Tips

A tip is a System Program transfer to an account a block builder or relay controls:

```
SystemInstruction::Transfer   u32 discriminant = 2, then u64 lamports
accounts                      [funding, recipient]
```

Tips never appear in `meta.fee`, so they are counted separately and added only into the total cost
to land.

**A failed transaction pays none of them.** The chain rolls its instructions back and keeps only the
fee, so a tip that a failed transaction instructed never leaves the payer's account — confirmed
against balance deltas, where the recipient of a rolled-back 2,000,000 lamport transfer gains
nothing. `tipLamports` therefore counts only what moved, and `tipLamportsInstructed` reports what
was offered. Counting the instructed amount would overstate this block's tips as 67,345,751 lamports
rather than 13,842,684.

Two rules, and the output keeps them apart:

**`known-recipient`** — the destination is in the registry. Certain, and labelled with the service.
Scanned at the top level and through CPI: CPI tips are a minority, one of the 133 Jito tips in the
recorded blocks, but a top-level-only scan reports those transactions as having tipped nothing.

**`unlabelled-outbound`** — a top-level transfer from the fee payer to an account that no other
instruction in the transaction references, in a transaction that also does something other than move
SOL. Reported without a label.

The second rule exists because only a handful of relays publish their tip accounts. In the recorded
block that ships as a fixture, among transactions that succeeded, it finds **22 payments to 16
distinct recipients against 66 to the Jito registry** — fewer payments, but **70% of the lamports**
(9,735,483 against 4,107,201). A registry-only tool reports that 70% as nothing. One recorded transaction
pays 2,328,594 lamports to two unlisted recipients on top of a 116,703 lamport fee: registry-only,
its cost to land comes out 21 times too low.

The two conditions are what keep the rule from firing on ordinary activity. Requiring the recipient
to be untouched elsewhere excludes SOL moved as part of the trade, such as a payment into a pool.
Requiring non-SOL work in the transaction excludes a plain wallet-to-wallet transfer, where the
recipient is the point rather than a toll. It remains a heuristic: a transfer to a genuine third
party that happens to look like this will be counted. `--known-tips-only` restricts the count to
registry matches.

`TransferWithSeed` has a different layout and is not decoded.

## Asking the RPC correctly

Every read passes `maxSupportedTransactionVersion: 1`. Measured against the public mainnet endpoint:

| request                                 | result                                             |
| --------------------------------------- | -------------------------------------------------- |
| `getBlock` with no version parameter    | error `-32015`, naming version 0                   |
| `getBlock` with `0`                     | error `-32015`, naming version 1                   |
| `getBlock` with `1`                     | the full block                                     |

The refusal covers the whole response, not the offending transaction, so a caller that passes `0`
sees an error rather than partial data — and a caller that catches and ignores that error sees
nothing at all. A version newer than 1 raises an error here rather than being priced by rules that
may no longer apply.

Account indices are resolved against the message's static keys followed by the writable addresses
loaded from lookup tables, then the readonly ones. In the recorded block that affects 1,690 account
references across 81 transactions, and the program of 231 instructions reached through CPI, which is
what tip detection reads. v1 transactions inline their accounts and never need it.

## References

- SIMD-0385, transaction v1 — <https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0385-transaction-v1.md>
- Solana docs, versioned transactions — <https://solana.com/docs/core/transactions/versioned-transactions>
- Jito `getTipAccounts` — <https://docs.jito.wtf>
