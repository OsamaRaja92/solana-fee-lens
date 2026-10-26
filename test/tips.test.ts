/** Tip detection: System transfers to known tip accounts, top-level and through CPI. */

import { describe, expect, it } from 'vitest';
import { analyseTransaction } from '../src/analyze/transaction.js';
import { SYSTEM_PROGRAM } from '../src/model/builtins.js';
import { decodeSystemTransfer, findTips } from '../src/model/tips.js';
import { KNOWN_TIP_ACCOUNTS, tipAccountIndex } from '../src/registry/tip-accounts.js';
import { normaliseTransaction } from '../src/rpc/normalise.js';
import type { NormalisedInstruction, NormalisedTransaction } from '../src/types.js';
import { loadTransaction } from './fixtures.js';

function transferData(lamports: bigint): Uint8Array {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true); // SystemInstruction::Transfer
  view.setBigUint64(4, lamports, true);
  return data;
}

function transfer(destination: string, lamports: bigint): NormalisedInstruction {
  return {
    programAddress: SYSTEM_PROGRAM,
    accountAddresses: ['SourceAccount11111111111111111111111111111', destination],
    data: transferData(lamports),
    stackHeight: 1,
  };
}

/** Stands in for whatever the transaction is actually there to do. */
function swapInstruction(accountAddresses: string[]): NormalisedInstruction {
  return {
    programAddress: 'SomeDexProgram11111111111111111111111111',
    accountAddresses,
    data: Uint8Array.from([1, 2, 3]),
    stackHeight: 1,
  };
}

function transactionWith(instructions: NormalisedInstruction[]): NormalisedTransaction {
  return {
    signature: 'test',
    feePayer: 'SourceAccount11111111111111111111111111111',
    version: 0,
    slot: 1n,
    numRequiredSignatures: 1,
    feeLamports: 5_000n,
    computeUnitsConsumed: 150n,
    err: null,
    instructions,
    innerInstructions: [],
    transactionConfig: null,
    addressTableLookupCount: 0,
  };
}

const firstKnownTipAccount = KNOWN_TIP_ACCOUNTS[0]?.address ?? '';

/** Default analysis options: the published registry, heuristic enabled. */
function options() {
  return { tipAccounts: tipAccountIndex() };
}

describe('decodeSystemTransfer', () => {
  it('decodes a transfer amount', () => {
    const result = decodeSystemTransfer(
      transfer('Destination1111111111111111111111111111111', 125_000n),
    );
    expect(result).toEqual({
      source: 'SourceAccount11111111111111111111111111111',
      destination: 'Destination1111111111111111111111111111111',
      lamports: 125_000n,
    });
  });

  it('rejects a non-transfer System instruction', () => {
    const instruction = transfer('Destination1111111111111111111111111111111', 1n);
    const data = new Uint8Array(instruction.data);
    new DataView(data.buffer).setUint32(0, 3, true); // AllocateWithSeed, not Transfer
    expect(decodeSystemTransfer({ ...instruction, data })).toBeNull();
  });

  it('rejects an instruction from another program', () => {
    const instruction = transfer('Destination1111111111111111111111111111111', 1n);
    expect(decodeSystemTransfer({ ...instruction, programAddress: 'Other1111' })).toBeNull();
  });

  it('rejects a truncated payload rather than reading past the end', () => {
    const instruction = transfer('Destination1111111111111111111111111111111', 1n);
    expect(decodeSystemTransfer({ ...instruction, data: instruction.data.slice(0, 8) })).toBeNull();
  });
});

describe('findTips', () => {
  it('labels a transfer to a known tip account', () => {
    const tips = findTips(
      transactionWith([transfer(firstKnownTipAccount, 10_000n)]),
      tipAccountIndex(),
    );
    expect(tips).toEqual([
      {
        recipient: firstKnownTipAccount,
        lamports: 10_000n,
        service: 'Jito',
        via: 'top-level',
        basis: 'known-recipient',
      },
    ]);
  });

  it('does not treat a plain wallet-to-wallet transfer as a tip', () => {
    // Nothing but SOL movement: the recipient is the point, not a toll.
    const tips = findTips(
      transactionWith([transfer('SomeRandomWallet111111111111111111111111', 10_000n)]),
      tipAccountIndex(),
    );
    expect(tips).toEqual([]);
  });

  it('reports an unlisted recipient when the transaction also does real work', () => {
    const relay = 'SomeRelayNobodyPublished1111111111111111';
    const tips = findTips(
      transactionWith([swapInstruction([]), transfer(relay, 7_100_000n)]),
      tipAccountIndex(),
    );

    expect(tips).toEqual([
      {
        recipient: relay,
        lamports: 7_100_000n,
        service: null,
        via: 'top-level',
        basis: 'unlabelled-outbound',
      },
    ]);
  });

  it('ignores SOL moved to an account the transaction otherwise uses', () => {
    // A pool or vault being paid into is part of the trade, not a toll.
    const pool = 'PoolVault111111111111111111111111111111111';
    const tips = findTips(
      transactionWith([swapInstruction([pool]), transfer(pool, 1_000_000n)]),
      tipAccountIndex(),
    );
    expect(tips).toEqual([]);
  });

  it('ignores a transfer that did not come from the fee payer', () => {
    const relay = 'SomeRelayNobodyPublished1111111111111111';
    const instruction = transfer(relay, 7_100_000n);
    const notThePayer = {
      ...instruction,
      accountAddresses: ['SomeoneElse1111111111111111111111111111', relay],
    };
    const tips = findTips(transactionWith([swapInstruction([]), notThePayer]), tipAccountIndex());
    expect(tips).toEqual([]);
  });

  it('labels a caller-supplied account when given ADDRESS=LABEL', () => {
    const relay = 'SomeRelayNobodyPublished1111111111111111';
    const tips = findTips(
      transactionWith([swapInstruction([]), transfer(relay, 7_100_000n)]),
      tipAccountIndex([`${relay}=SpeedyRelay`]),
    );

    expect(tips[0]?.service).toBe('SpeedyRelay');
    expect(tips[0]?.basis).toBe('known-recipient');
  });

  it('can be told to report only recipients in the registry', () => {
    const relay = 'SomeRelayNobodyPublished1111111111111111';
    const tips = findTips(
      transactionWith([swapInstruction([]), transfer(relay, 7_100_000n)]),
      tipAccountIndex(),
      { knownRecipientsOnly: true },
    );
    expect(tips).toEqual([]);
  });

  it('recognises a caller-supplied tip account', () => {
    const custom = 'MyRelayTipAccount11111111111111111111111';
    const tips = findTips(transactionWith([transfer(custom, 7n)]), tipAccountIndex([custom]));
    expect(tips).toEqual([
      {
        recipient: custom,
        lamports: 7n,
        service: 'custom',
        via: 'top-level',
        basis: 'known-recipient',
      },
    ]);
  });

  it('ignores a zero-lamport transfer', () => {
    const tips = findTips(transactionWith([transfer(firstKnownTipAccount, 0n)]), tipAccountIndex());
    expect(tips).toEqual([]);
  });
});

describe('recorded transactions', () => {
  it('finds a top-level tip', () => {
    const analysis = analyseTransaction(
      normaliseTransaction(loadTransaction('tx-v1-top-level-tip')),
    );
    expect(analysis.tips).toHaveLength(1);
    expect(analysis.tips[0]?.lamports).toBe(125_000n);
    expect(analysis.tips[0]?.via).toBe('top-level');
    expect(analysis.tips[0]?.service).toBe('Jito');

    // A tip is not part of the protocol fee, so it must not inflate meta.fee.
    expect(analysis.fee.observedFeeLamports).toBe(5_000n);
    expect(analysis.fee.totalCostLamports).toBe(130_000n);
  });

  it('reports payments to relays that publish no tip account', () => {
    // A real transaction paying two third parties that are in no registry. Before
    // the unlabelled-outbound rule this reported "no tip paid" and understated the
    // cost of landing it by a factor of 21.
    const analysis = analyseTransaction(
      normaliseTransaction(loadTransaction('tx-v0-explicit-limit-with-alts')),
    );

    expect(analysis.tips).toHaveLength(2);
    expect(analysis.tips.every((tip) => tip.basis === 'unlabelled-outbound')).toBe(true);
    expect(analysis.tips.every((tip) => tip.service === null)).toBe(true);
    expect(analysis.fee.tipLamports).toBe(2_328_594n);
    expect(analysis.fee.labelledTipLamports).toBe(0n);

    // The fee was 116,703 lamports; landing it really cost 2,445,297.
    expect(analysis.fee.observedFeeLamports).toBe(116_703n);
    expect(analysis.fee.totalCostLamports).toBe(2_445_297n);
  });

  it('suppresses unlisted recipients when asked for registry matches only', () => {
    const analysis = analyseTransaction(
      normaliseTransaction(loadTransaction('tx-v0-explicit-limit-with-alts')),
      { knownRecipientsOnly: true },
    );
    expect(analysis.tips).toEqual([]);
    expect(analysis.fee.totalCostLamports).toBe(116_703n);
  });

  it('finds a tip paid through a program, which a top-level-only scan would miss', () => {
    const analysis = analyseTransaction(normaliseTransaction(loadTransaction('tx-cpi-tip')));
    expect(analysis.tips).toHaveLength(1);
    expect(analysis.tips[0]?.lamports).toBe(2_635n);
    expect(analysis.tips[0]?.via).toBe('inner');

    const topLevelOnly = findTips(
      { ...normaliseTransaction(loadTransaction('tx-cpi-tip')), innerInstructions: [] },
      tipAccountIndex(),
    );
    expect(topLevelOnly).toEqual([]);
  });
});

describe('failed transactions', () => {
  it('reports what a failed transaction instructed but not as paid', () => {
    // This transaction's instructions include a 20,356 lamport transfer, but it
    // failed, so the chain rolled that back and took only the fee.
    const analysis = analyseTransaction(
      normaliseTransaction(loadTransaction('tx-v1-inert-compute-budget')),
      options(),
    );

    expect(analysis.succeeded).toBe(false);
    expect(analysis.tips).toHaveLength(1);
    expect(analysis.fee.tipLamportsInstructed).toBe(20_356n);

    // What matters: none of it was paid, so it must not enter the cost to land.
    expect(analysis.fee.tipLamports).toBe(0n);
    expect(analysis.fee.labelledTipLamports).toBe(0n);
    expect(analysis.fee.totalCostLamports).toBe(analysis.fee.observedFeeLamports);
    expect(analysis.fee.totalCostLamports).toBe(10_008n);
  });

  it('counts instructed and paid alike when the transaction succeeded', () => {
    const analysis = analyseTransaction(
      normaliseTransaction(loadTransaction('tx-v1-top-level-tip')),
      options(),
    );

    expect(analysis.succeeded).toBe(true);
    expect(analysis.fee.tipLamports).toBe(125_000n);
    expect(analysis.fee.tipLamportsInstructed).toBe(125_000n);
  });
});
