/**
 * The RPC boundary: turning a recorded response into the model's input.
 *
 * The contract being tested is the account index space. An instruction refers to
 * its accounts by position in a list that is the message's static keys followed
 * by the writable addresses the runtime loaded from lookup tables, then the
 * readonly ones. Get that order wrong and indices past the static keys resolve
 * to the wrong account, or to nothing at all.
 */

import { describe, expect, it } from 'vitest';
import { COMPUTE_BUDGET_PROGRAM, SYSTEM_PROGRAM } from '../src/model/builtins.js';
import { normaliseBlock, normaliseTransaction, resolveAccountKeys } from '../src/rpc/normalise.js';
import type { WireTransaction } from '../src/rpc/wire.js';
import { loadBlock, loadTransaction, RECORDED_BLOCK } from './fixtures.js';

describe('resolveAccountKeys', () => {
  it('orders static keys, then loaded writable, then loaded readonly', () => {
    const wire = loadTransaction('tx-v0-explicit-limit-with-alts');
    const keys = resolveAccountKeys(wire);
    const staticKeys = wire.transaction.message.accountKeys;
    const loaded = wire.meta?.loadedAddresses;

    expect(staticKeys).toHaveLength(22);
    expect(loaded?.writable).toHaveLength(13);
    expect(loaded?.readonly).toHaveLength(9);
    expect(keys).toHaveLength(44);

    expect(keys.slice(0, 22)).toEqual([...staticKeys]);
    expect(keys.slice(22, 35)).toEqual([...(loaded?.writable ?? [])]);
    expect(keys.slice(35)).toEqual([...(loaded?.readonly ?? [])]);
  });

  it('resolves an index that falls in the loaded readonly range', () => {
    // Built by hand: the only way to pin the behaviour for an index past the
    // writable addresses without depending on a block that happens to contain one.
    const wire: WireTransaction = {
      version: 0,
      slot: 1,
      transaction: {
        signatures: ['sig'],
        message: {
          accountKeys: ['Payer'],
          header: {
            numRequiredSignatures: 1,
            numReadonlySignedAccounts: 0,
            numReadonlyUnsignedAccounts: 0,
          },
          // Index 2 is the first readonly loaded address.
          instructions: [{ programIdIndex: 2, accounts: [0, 1], data: '', stackHeight: 1 }],
          addressTableLookups: [{}],
        },
      },
      meta: {
        fee: 5000,
        err: null,
        computeUnitsConsumed: 150,
        loadedAddresses: { writable: ['Writable'], readonly: [SYSTEM_PROGRAM] },
      },
    };

    const [instruction] = normaliseTransaction(wire).instructions;
    expect(instruction?.programAddress).toBe(SYSTEM_PROGRAM);
    expect(instruction?.accountAddresses).toEqual(['Payer', 'Writable']);
  });
});

describe('normaliseTransaction', () => {
  it('base58-decodes instruction data', () => {
    const transaction = normaliseTransaction(loadTransaction('tx-legacy-explicit-limit'));
    const budget = transaction.instructions.find(
      (instruction) => instruction.programAddress === COMPUTE_BUDGET_PROGRAM,
    );

    expect(budget).toBeDefined();
    expect(budget?.data).toBeInstanceOf(Uint8Array);
    // A ComputeBudget payload is a one-byte discriminant plus a 4- or 8-byte value.
    expect(budget?.data.length).toBeGreaterThanOrEqual(5);
  });

  it('accepts lamport fields as either a JSON number or a bigint', () => {
    const wire = loadTransaction('tx-v1-top-level-tip');
    const asNumber = normaliseTransaction({ ...wire, meta: { ...wire.meta, fee: 5000 } as never });
    const asBigint = normaliseTransaction({ ...wire, meta: { ...wire.meta, fee: 5000n } as never });

    expect(asNumber.feeLamports).toBe(5_000n);
    expect(asBigint.feeLamports).toBe(5_000n);
  });

  it('refuses a transaction version it does not model', () => {
    const wire = loadTransaction('tx-v1-top-level-tip');
    expect(() => normaliseTransaction({ ...wire, version: 2 })).toThrow(
      /Unsupported transaction version 2/,
    );
  });

  it('refuses a transaction with no metadata, because the fee is then unknown', () => {
    const wire = loadTransaction('tx-v1-top-level-tip');
    expect(() => normaliseTransaction({ ...wire, meta: null })).toThrow(/no metadata/);
  });

  it('flattens inner instructions so CPI activity is visible', () => {
    const transaction = normaliseTransaction(loadTransaction('tx-cpi-tip'));
    expect(transaction.innerInstructions.length).toBeGreaterThan(0);
    expect(transaction.innerInstructions.some((i) => i.programAddress === SYSTEM_PROGRAM)).toBe(
      true,
    );
  });
});

describe('normaliseBlock', () => {
  it('stamps every transaction with the slot it came from', () => {
    const block = normaliseBlock(loadBlock(RECORDED_BLOCK.name), RECORDED_BLOCK.slot);
    expect(block.slot).toBe(RECORDED_BLOCK.slot);
    expect(block.transactions).toHaveLength(574);
    for (const transaction of block.transactions) {
      expect(transaction.slot).toBe(RECORDED_BLOCK.slot);
    }
  });
});
