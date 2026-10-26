/**
 * Turns a wire response into the model's input.
 *
 * Two things happen here that matter for correctness.
 *
 * Account indices are resolved against the FULL key list: the message's static
 * keys, then the writable addresses loaded from lookup tables, then the readonly
 * ones, in that order. An index past the static keys is an address the runtime
 * loaded from a lookup table, and resolving against the static keys alone simply
 * yields nothing for it. In the block recorded under `test/fixtures` that
 * applies to 1,690 account references across 81 transactions, and to the
 * program of 231 instructions reached through CPI, which is what tip detection
 * reads. Version 1 transactions inline their accounts and never need this.
 *
 * Instruction data is base58-decoded here, so everything downstream works on
 * bytes and never has to know how the wire encoded them.
 */

import { getBase58Encoder } from '@solana/kit';
import type {
  NormalisedBlock,
  NormalisedInstruction,
  NormalisedTransaction,
  TransactionConfig,
  TransactionVersion,
} from '../types.js';
import type {
  WireBlock,
  WireInstruction,
  WireNumber,
  WireTransaction,
  WireTransactionConfig,
} from './wire.js';

const base58 = getBase58Encoder();

function toBigint(value: WireNumber): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

function toBigintOrNull(value: WireNumber | null | undefined): bigint | null {
  return value === null || value === undefined ? null : toBigint(value);
}

function toVersion(version: WireTransaction['version']): TransactionVersion {
  if (version === 'legacy' || version === undefined) return 'legacy';
  if (version === 0) return 0;
  if (version === 1) return 1;
  // A version this build does not model. Failing loudly beats reporting a fee
  // derived from the wrong rules: that is precisely how v1 broke older tooling.
  throw new Error(
    `Unsupported transaction version ${String(version)}. ` +
      'This build models legacy, v0 and v1 only; the fee rules for newer versions may differ.',
  );
}

function normaliseConfig(
  config: WireTransactionConfig | null | undefined,
): TransactionConfig | null {
  if (config === null || config === undefined) return null;
  return {
    computeUnitLimit: config.computeUnitLimit ?? null,
    priorityFeeLamports: toBigintOrNull(config.priorityFee),
    loadedAccountsDataSizeLimit: config.loadedAccountsDataSizeLimit ?? null,
    heapSizeBytes: config.heapSize ?? null,
  };
}

/**
 * Converts bigints inside an error payload back to numbers.
 *
 * An RPC client may hand back bigints anywhere in a response. In an error
 * payload every number is a small instruction index or program error code, so
 * rendering them as strings misreports what the node actually sent. Values too
 * large to be exact as a number keep their string form rather than silently
 * losing precision.
 */
function sanitiseErr(value: unknown): unknown {
  if (typeof value === 'bigint') {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  if (Array.isArray(value)) return value.map(sanitiseErr);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        sanitiseErr(entry),
      ]),
    );
  }
  return value;
}

function normaliseInstruction(
  instruction: WireInstruction,
  keys: readonly string[],
): NormalisedInstruction {
  const programAddress = keys[instruction.programIdIndex];
  if (programAddress === undefined) {
    throw new Error(
      `Instruction references account index ${instruction.programIdIndex}, ` +
        `but only ${keys.length} accounts were resolved.`,
    );
  }

  const accountAddresses: string[] = [];
  for (const index of instruction.accounts) {
    const address = keys[index];
    if (address !== undefined) accountAddresses.push(address);
  }

  return {
    programAddress,
    accountAddresses,
    data: new Uint8Array(base58.encode(instruction.data)),
    stackHeight: instruction.stackHeight ?? 1,
  };
}

/** Static keys, then lookup-table writables, then lookup-table readonlys. */
export function resolveAccountKeys(wire: WireTransaction): readonly string[] {
  const loaded = wire.meta?.loadedAddresses;
  return [
    ...wire.transaction.message.accountKeys,
    ...(loaded?.writable ?? []),
    ...(loaded?.readonly ?? []),
  ];
}

export function normaliseTransaction(
  wire: WireTransaction,
  fallbackSlot?: bigint,
): NormalisedTransaction {
  const { message, signatures } = wire.transaction;
  const meta = wire.meta;
  if (meta === null) {
    throw new Error('Transaction has no metadata, so the fee it paid is unknown.');
  }

  const keys = resolveAccountKeys(wire);
  const signature = signatures[0];
  if (signature === undefined) throw new Error('Transaction carries no signature.');

  const slot = toBigintOrNull(wire.slot) ?? fallbackSlot;
  if (slot === undefined) throw new Error('Transaction has no slot, and no fallback was supplied.');

  const innerInstructions: NormalisedInstruction[] = [];
  for (const group of meta.innerInstructions ?? []) {
    for (const instruction of group.instructions) {
      innerInstructions.push(normaliseInstruction(instruction, keys));
    }
  }

  const feePayer = keys[0];
  if (feePayer === undefined) throw new Error('Transaction has no account keys.');

  return {
    signature,
    feePayer,
    version: toVersion(wire.version),
    slot,
    numRequiredSignatures: message.header.numRequiredSignatures,
    feeLamports: toBigint(meta.fee),
    computeUnitsConsumed: toBigintOrNull(meta.computeUnitsConsumed),
    err: sanitiseErr(meta.err ?? null),
    instructions: message.instructions.map((instruction) =>
      normaliseInstruction(instruction, keys),
    ),
    innerInstructions,
    transactionConfig: normaliseConfig(message.transactionConfig),
    addressTableLookupCount: message.addressTableLookups?.length ?? 0,
  };
}

export function normaliseBlock(wire: WireBlock, slot: bigint): NormalisedBlock {
  return {
    slot,
    blockTime: toBigintOrNull(wire.blockTime),
    transactions: wire.transactions.map((transaction) => normaliseTransaction(transaction, slot)),
  };
}
