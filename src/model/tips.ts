/**
 * Finding what a transaction paid for inclusion.
 *
 * A tip is not a protocol fee. It reaches a block builder or relay as an
 * ordinary System Program transfer, so it never appears in `meta.fee` and has to
 * be found in the instructions.
 *
 * Two things are detected, and the distinction is kept in the output:
 *
 *   known-recipient      A transfer to an account in the registry, top-level or
 *                        through CPI. Certain, and labelled with the service.
 *
 *   unlabelled-outbound  A top-level transfer from the fee payer to an account
 *                        that no other instruction in the transaction touches,
 *                        in a transaction that also does something other than
 *                        move SOL. Reported without a label.
 *
 * The second rule exists because only a handful of relays publish their tip
 * accounts. In the blocks recorded under `test/fixtures`, payments matching the
 * second rule outnumber the ones to published Jito accounts, and every one of
 * them would otherwise be reported as "no tip paid" — a positive claim the tool
 * has no grounds to make. A heuristic that is shown and explained beats silence
 * that reads as fact.
 *
 * The two conditions on the second rule are what keep it from firing on ordinary
 * activity. Requiring the recipient to be untouched elsewhere excludes SOL moved
 * as part of the trade, such as a payment into a pool. Requiring some non-SOL
 * work in the transaction excludes a plain wallet-to-wallet transfer, where the
 * recipient is the point rather than a toll.
 */

import type { NormalisedInstruction, NormalisedTransaction, TipTransfer } from '../types.js';
import { COMPUTE_BUDGET_PROGRAM, SYSTEM_PROGRAM } from './builtins.js';

/** Discriminant of `SystemInstruction::Transfer`, as a little-endian u32. */
const SYSTEM_TRANSFER_DISCRIMINANT = 2;

/** 4-byte discriminant followed by a u64 lamport amount. */
const TRANSFER_DATA_LENGTH = 12;

interface SystemTransfer {
  readonly source: string;
  readonly destination: string;
  readonly lamports: bigint;
}

/**
 * Decodes a System Program transfer, or returns null if the instruction is not one.
 *
 * `TransferWithSeed` has a different layout and is not decoded: it is not used to
 * pay tips in practice, and guessing at it would be worse than saying so.
 */
export function decodeSystemTransfer(instruction: NormalisedInstruction): SystemTransfer | null {
  if (instruction.programAddress !== SYSTEM_PROGRAM) return null;
  if (instruction.data.length < TRANSFER_DATA_LENGTH) return null;

  const view = new DataView(
    instruction.data.buffer,
    instruction.data.byteOffset,
    instruction.data.byteLength,
  );
  if (view.getUint32(0, true) !== SYSTEM_TRANSFER_DISCRIMINANT) return null;

  // Transfer takes [funding account, recipient account].
  const source = instruction.accountAddresses[0];
  const destination = instruction.accountAddresses[1];
  if (source === undefined || destination === undefined) return null;

  return { source, destination, lamports: view.getBigUint64(4, true) };
}

export interface FindTipsOptions {
  /** Report only transfers to recipients in the registry. Default false. */
  readonly knownRecipientsOnly?: boolean;
}

/** True when the transaction does something besides move SOL around. */
function hasNonTransferWork(transaction: NormalisedTransaction): boolean {
  return transaction.instructions.some(
    (instruction) =>
      instruction.programAddress !== SYSTEM_PROGRAM &&
      instruction.programAddress !== COMPUTE_BUDGET_PROGRAM,
  );
}

/** True when any instruction other than `exclude` references `address`. */
function referencedElsewhere(
  transaction: NormalisedTransaction,
  address: string,
  exclude: NormalisedInstruction,
): boolean {
  for (const instruction of transaction.instructions) {
    if (instruction === exclude) continue;
    if (instruction.accountAddresses.includes(address)) return true;
  }
  return false;
}

/**
 * Classifies one System transfer, or returns null if it is not a payment for
 * inclusion. Split out of the scan so that each reads as a single idea.
 */
function classifyTransfer(
  transaction: NormalisedTransaction,
  instruction: NormalisedInstruction,
  transfer: SystemTransfer,
  via: TipTransfer['via'],
  tipAccounts: ReadonlyMap<string, string>,
  allowUnlabelled: boolean,
): TipTransfer | null {
  const { destination: recipient, lamports } = transfer;

  const service = tipAccounts.get(recipient);
  if (service !== undefined) {
    return { recipient, lamports, service, via, basis: 'known-recipient' };
  }

  // Unlisted recipients are only considered at the top level: a transfer made
  // through CPI is the program's own logic, such as paying into a pool.
  if (!allowUnlabelled || via !== 'top-level') return null;
  if (transfer.source !== transaction.feePayer) return null;
  if (referencedElsewhere(transaction, recipient, instruction)) return null;

  return { recipient, lamports, service: null, via, basis: 'unlabelled-outbound' };
}

export function findTips(
  transaction: NormalisedTransaction,
  tipAccounts: ReadonlyMap<string, string>,
  options: FindTipsOptions = {},
): readonly TipTransfer[] {
  const tips: TipTransfer[] = [];
  const allowUnlabelled = options.knownRecipientsOnly !== true && hasNonTransferWork(transaction);

  const scan = (instructions: readonly NormalisedInstruction[], via: TipTransfer['via']): void => {
    for (const instruction of instructions) {
      const transfer = decodeSystemTransfer(instruction);
      if (transfer === null || transfer.lamports === 0n) continue;

      const tip = classifyTransfer(
        transaction,
        instruction,
        transfer,
        via,
        tipAccounts,
        allowUnlabelled,
      );
      if (tip !== null) tips.push(tip);
    }
  };

  scan(transaction.instructions, 'top-level');
  scan(transaction.innerInstructions, 'inner');

  return tips;
}
