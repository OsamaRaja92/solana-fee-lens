# solana-fee-lens

What a Solana transaction actually paid to land: base fee, priority fee and tips, separated, and
correct across legacy, v0 and v1 transactions. Point it at a transaction, a slot or an account.

A Rust implementation lives at [fee-lens-rs](https://github.com/OsamaRaja92/fee-lens-rs). Both
reproduce the same 574 recorded fees to the lamport and agree on every aggregate; its test suite
asserts these figures directly, so neither can drift unnoticed. (`--json` differs between them:
field naming and number encoding follow each language's conventions.)

```
$ fee-lens tx 4aAxVhvY62QQHM9Y4UpBxZFvoX5jLmd83TzpJik79n5bqz9kyM9CqCisZdNGHreTpR5GZEVX3aTZg59vC69xTS28

Transaction 4aAxVhvY..C69xTS28
  version            v0
  slot               461358125
  result             success

Fee
  base                        5,000 lamports  1 signature(s) x 5,000
  priority                   10,161 lamports  price per compute unit x limit
  tips                            0 lamports  no outbound payment found
  charged                    15,161 lamports  0.000015161 SOL
  total to land              15,161 lamports  0.000015161 SOL, fee plus tips
  model check                 exact  the model reproduces the charged fee

Compute
  limit                   1,006,000 units  derived by the runtime (none declared)
  consumed                   40,450 units
  unused                    965,550 units  96.0% of the budget
  overpaid                    9,752 lamports  what an exactly fitted limit would have saved
```

That transaction declared no compute unit limit. The runtime derived 1,006,000 units from its
instruction list and charged the priority fee against that figure. It used 4% of it.

## The v1 problem

Since SIMD-0385, a v1 transaction carries its compute unit limit and priority fee in the message
header rather than in ComputeBudget instructions. Three consequences:

- **ComputeBudget instructions in a v1 transaction are inert.** One fixture here declares a limit
  of `0` while its header declares 327,450. Read the instruction and you report zero.
- **`priorityFee` is an absolute lamport total**, not the micro-lamports-per-unit rate that
  `SetComputeUnitPrice` sets. Treating one as the other is wrong by a factor of the limit over a
  million.
- **v1 is not an edge case.** It is 280 of 574 transactions in the recorded block, the largest of
  the three versions (v0 is 190, legacy 104).

Every RPC read passes `maxSupportedTransactionVersion: 1`. Omit it and the node refuses the entire
response with `-32015`; pass `0` and it refuses again, naming v1.

A failed transaction pays no tips. Its instructions are rolled back and only the fee is taken, so a
transfer it instructed never moves — confirmed against balance deltas. `tipLamports` counts what
moved and `tipLamportsInstructed` what was offered. Counting the instructed amount would overstate
the recorded block's tips as 67,345,751 lamports instead of 13,842,684.

The base fee has a second trap. It is 5,000 lamports per **signature**, and that includes signatures
verified by the Ed25519 and secp256 precompiles, not only the ones the message header requires.
Counting the header alone understates the fee by 5,000 lamports per precompile signature.
`docs/fee-model.md` has the detail; `tx-ed25519-precompile.json` is the fixture.


## Verification

The model predicts each fee from the transaction's own directives. `meta.fee` says what was
charged. The difference is reported on every analysis and should always be zero.

`test/block.test.ts` runs that over every transaction in a recorded mainnet block:

```
574 / 574 transactions reproduced exactly
```

Tests run against recorded JSON fixtures through the same code path as a live response. No network,
no RPC key: clone and `npm test`.

## Use

Node 22.12 or newer.

```bash
npm install && npm run build

node dist/cli/index.js tx <signature>
node dist/cli/index.js slot 461358125 --top 10
node dist/cli/index.js account <address> --limit 50 --concurrency 1
node dist/cli/index.js slot 461358125 --json
```

RPC endpoint comes from `--rpc`, else `$SOLANA_RPC_URL`, else the public endpoint. Read calls only;
no key or signer. The public endpoint rate limits, so keep `--limit` small or pass `--concurrency 1`
for `account`, which makes one request per transaction.

`--tip-account ADDRESS=LABEL` names relays the registry does not know. `--known-tips-only`
restricts tips to registry matches.

## Limitations

- **Tip recipients mostly cannot be named.** The registry holds Jito's eight published accounts.
  Everything else is matched by shape: a top-level transfer from the fee payer to an account no
  other instruction touches, in a transaction that also does something besides move SOL. Among the
  transactions in the shipped block that succeeded, it finds 22 payments to 16 distinct recipients
  against 66 to the Jito registry — fewer payments, but 70% of the lamports (9,735,483 against
  4,107,201). It is a heuristic and is labelled as one.
- **A slot shows the transactions that landed.** Dropped ones are not in the block, so a percentile
  says what was sufficient, not what was required.
- **`TransferWithSeed` is not decoded.** Different layout, not used for tips in practice.
- **The derived-limit rule is checked against the builtins in the fixtures.** Others follow the
  documented rule but are unverified; an error shows up as a non-zero residual, not a wrong number.
- **Unknown transaction versions raise an error** rather than being priced by the wrong rules.

MIT.
