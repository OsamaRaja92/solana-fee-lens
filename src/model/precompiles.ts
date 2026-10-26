/**
 * Signature-verifying precompiles.
 *
 * The base fee is charged per signature, and the signatures a precompile
 * verifies are billed alongside the ones the message header requires. A
 * transaction with one required signature and one Ed25519 precompile signature
 * pays 10,000 lamports, not 5,000.
 *
 * Counting only `numRequiredSignatures` understates the base fee by 5,000
 * lamports per precompile signature. Nothing in the recorded block exercises
 * this — mainnet precompile transactions are rare, roughly one per block in the
 * slots sampled — which is exactly why the model is checked against the charged
 * fee rather than against a corpus that happens to agree with it.
 *
 * Each precompile's instruction data begins with a one-byte count of the
 * signatures it verifies.
 */

import type { NormalisedInstruction } from '../types.js';

export const ED25519_PROGRAM = 'Ed25519SigVerify111111111111111111111111111';
export const SECP256K1_PROGRAM = 'KeccakSecp256k11111111111111111111111111111';
export const SECP256R1_PROGRAM = 'Secp256r1SigVerify1111111111111111111111111';

/** Precompiles whose verified signatures are billed like message signatures. */
export const SIGNATURE_PRECOMPILES: readonly string[] = [
  ED25519_PROGRAM,
  SECP256K1_PROGRAM,
  SECP256R1_PROGRAM,
];

/**
 * How many signatures the transaction's precompile instructions verify.
 *
 * Only top-level instructions count: a precompile cannot be invoked through CPI.
 */
export function countPrecompileSignatures(instructions: readonly NormalisedInstruction[]): number {
  let total = 0;
  for (const instruction of instructions) {
    if (!SIGNATURE_PRECOMPILES.includes(instruction.programAddress)) continue;
    total += instruction.data[0] ?? 0;
  }
  return total;
}
