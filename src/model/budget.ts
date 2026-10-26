/**
 * Decoder for the ComputeBudget program's instructions.
 *
 * The instruction data is a one-byte discriminant followed by a little-endian
 * payload. Decoding it directly, rather than relying on an RPC's `jsonParsed`
 * output, keeps the tool working against any endpoint and makes the parsing
 * testable without a network call.
 */

import type { ComputeBudgetDirectives, NormalisedInstruction } from '../types.js';
import { COMPUTE_BUDGET_PROGRAM } from './builtins.js';

/**
 * Instruction discriminants, as a plain object rather than an enum: `isolatedModules`
 * forbids a `const enum`, and a runtime enum would be emitted for no benefit.
 */
const Discriminant = {
  /** Deprecated, superseded by SetComputeUnitLimit. */
  RequestUnitsDeprecated: 0,
  RequestHeapFrame: 1,
  SetComputeUnitLimit: 2,
  SetComputeUnitPrice: 3,
  SetLoadedAccountsDataSizeLimit: 4,
} as const;

function readU32LE(data: Uint8Array, offset: number): number | null {
  if (data.length < offset + 4) return null;
  return new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true);
}

function readU64LE(data: Uint8Array, offset: number): bigint | null {
  if (data.length < offset + 8) return null;
  return new DataView(data.buffer, data.byteOffset + offset, 8).getBigUint64(0, true);
}

/**
 * Reads every ComputeBudget directive out of a transaction's top-level instructions.
 *
 * When a directive appears more than once the runtime rejects the transaction, so
 * the last value wins here only as a defensive choice; it cannot happen on a
 * transaction that landed.
 */
export function decodeComputeBudget(
  instructions: readonly NormalisedInstruction[],
  options: { readonly isVersion1: boolean },
): ComputeBudgetDirectives {
  let computeUnitPriceMicroLamports: bigint | null = null;
  let computeUnitLimit: number | null = null;
  let loadedAccountsDataSizeLimit: number | null = null;
  let heapFrameBytes: number | null = null;
  let instructionCount = 0;

  for (const instruction of instructions) {
    if (instruction.programAddress !== COMPUTE_BUDGET_PROGRAM) continue;
    instructionCount += 1;

    const { data } = instruction;
    const discriminant = data[0];
    if (discriminant === undefined) continue;

    switch (discriminant) {
      case Discriminant.SetComputeUnitLimit:
        computeUnitLimit = readU32LE(data, 1) ?? computeUnitLimit;
        break;
      case Discriminant.SetComputeUnitPrice:
        computeUnitPriceMicroLamports = readU64LE(data, 1) ?? computeUnitPriceMicroLamports;
        break;
      case Discriminant.SetLoadedAccountsDataSizeLimit:
        loadedAccountsDataSizeLimit = readU32LE(data, 1) ?? loadedAccountsDataSizeLimit;
        break;
      case Discriminant.RequestHeapFrame:
        heapFrameBytes = readU32LE(data, 1) ?? heapFrameBytes;
        break;
      case Discriminant.RequestUnitsDeprecated:
        computeUnitLimit = readU32LE(data, 1) ?? computeUnitLimit;
        break;
      default:
        break;
    }
  }

  return {
    computeUnitPriceMicroLamports,
    computeUnitLimit,
    loadedAccountsDataSizeLimit,
    heapFrameBytes,
    instructionCount,
    inertOnV1: options.isVersion1 && instructionCount > 0,
  };
}
