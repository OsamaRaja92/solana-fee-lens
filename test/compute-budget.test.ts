/** ComputeBudget instruction decoding, on synthetic payloads. */

import { describe, expect, it } from 'vitest';
import { decodeComputeBudget } from '../src/model/budget.js';
import { COMPUTE_BUDGET_PROGRAM, SYSTEM_PROGRAM } from '../src/model/builtins.js';
import type { NormalisedInstruction } from '../src/types.js';

function instruction(programAddress: string, data: readonly number[]): NormalisedInstruction {
  return { programAddress, accountAddresses: [], data: Uint8Array.from(data), stackHeight: 1 };
}

function u32(value: number): number[] {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return [...bytes];
}

function u64(value: bigint): number[] {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return [...bytes];
}

const notV1 = { isVersion1: false };

describe('decodeComputeBudget', () => {
  it('reads a compute unit limit', () => {
    const result = decodeComputeBudget(
      [instruction(COMPUTE_BUDGET_PROGRAM, [2, ...u32(300_000)])],
      notV1,
    );
    expect(result.computeUnitLimit).toBe(300_000);
    expect(result.instructionCount).toBe(1);
  });

  it('reads a compute unit price as a 64-bit value', () => {
    const price = 18_446_744_073_709_551_615n; // u64 max, to prove no float rounding
    const result = decodeComputeBudget(
      [instruction(COMPUTE_BUDGET_PROGRAM, [3, ...u64(price)])],
      notV1,
    );
    expect(result.computeUnitPriceMicroLamports).toBe(price);
  });

  it('reads the loaded accounts data size limit and the heap frame', () => {
    const result = decodeComputeBudget(
      [
        instruction(COMPUTE_BUDGET_PROGRAM, [4, ...u32(65_536)]),
        instruction(COMPUTE_BUDGET_PROGRAM, [1, ...u32(262_144)]),
      ],
      notV1,
    );
    expect(result.loadedAccountsDataSizeLimit).toBe(65_536);
    expect(result.heapFrameBytes).toBe(262_144);
    expect(result.instructionCount).toBe(2);
  });

  it('ignores instructions belonging to other programs', () => {
    const result = decodeComputeBudget([instruction(SYSTEM_PROGRAM, [2, ...u32(300_000)])], notV1);
    expect(result.computeUnitLimit).toBeNull();
    expect(result.instructionCount).toBe(0);
  });

  it('leaves a field null rather than guessing when the payload is truncated', () => {
    const result = decodeComputeBudget([instruction(COMPUTE_BUDGET_PROGRAM, [2, 0, 1])], notV1);
    expect(result.computeUnitLimit).toBeNull();
    expect(result.instructionCount).toBe(1);
  });

  it('tolerates empty instruction data', () => {
    const result = decodeComputeBudget([instruction(COMPUTE_BUDGET_PROGRAM, [])], notV1);
    expect(result.computeUnitLimit).toBeNull();
    expect(result.computeUnitPriceMicroLamports).toBeNull();
  });

  it('flags directives as inert on a v1 transaction', () => {
    const instructions = [instruction(COMPUTE_BUDGET_PROGRAM, [2, ...u32(0)])];
    expect(decodeComputeBudget(instructions, { isVersion1: true }).inertOnV1).toBe(true);
    expect(decodeComputeBudget(instructions, notV1).inertOnV1).toBe(false);
    expect(decodeComputeBudget([], { isVersion1: true }).inertOnV1).toBe(false);
  });

  it('accepts the deprecated RequestUnits instruction as a limit', () => {
    const result = decodeComputeBudget(
      [instruction(COMPUTE_BUDGET_PROGRAM, [0, ...u32(120_000)])],
      notV1,
    );
    expect(result.computeUnitLimit).toBe(120_000);
  });
});
