/** Counting the signatures a precompile verifies, which the base fee is charged for. */

import { describe, expect, it } from 'vitest';
import {
  countPrecompileSignatures,
  ED25519_PROGRAM,
  SECP256K1_PROGRAM,
  SECP256R1_PROGRAM,
} from '../src/model/precompiles.js';
import type { NormalisedInstruction } from '../src/types.js';

function instruction(programAddress: string, data: readonly number[]): NormalisedInstruction {
  return { programAddress, accountAddresses: [], data: Uint8Array.from(data), stackHeight: 1 };
}

describe('countPrecompileSignatures', () => {
  it('reads the count from the first data byte', () => {
    expect(countPrecompileSignatures([instruction(ED25519_PROGRAM, [1, 0])])).toBe(1);
    expect(countPrecompileSignatures([instruction(ED25519_PROGRAM, [7, 0])])).toBe(7);
  });

  it('counts every signature-verifying precompile', () => {
    const instructions = [
      instruction(ED25519_PROGRAM, [1, 0]),
      instruction(SECP256K1_PROGRAM, [2, 0]),
      instruction(SECP256R1_PROGRAM, [3, 0]),
    ];
    expect(countPrecompileSignatures(instructions)).toBe(6);
  });

  it('ignores other programs', () => {
    expect(countPrecompileSignatures([instruction('11111111111111111111111111111111', [9])])).toBe(
      0,
    );
  });

  it('treats empty instruction data as zero rather than throwing', () => {
    expect(countPrecompileSignatures([instruction(ED25519_PROGRAM, [])])).toBe(0);
  });
});
