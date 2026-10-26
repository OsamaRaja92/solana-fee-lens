/**
 * The fee model.
 *
 * A Solana transaction fee has two parts. The base fee is 5,000 lamports for each
 * signature the message requires. The priority fee is whatever the sender bid on
 * top, and how that is expressed depends on the transaction version:
 *
 *   legacy, v0  `SetComputeUnitPrice` sets a RATE in micro-lamports per compute
 *               unit, and the fee is that rate times the declared compute unit
 *               limit. Declaring more compute therefore costs more lamports.
 *   v1          The header carries an ABSOLUTE lamport total (SIMD-0385). The
 *               compute unit limit does not enter the fee at all.
 *
 * Treating the two as the same number is the single easiest way to misread a v1
 * transaction, and the error is large: a rate is out by a factor of the limit
 * over a million.
 *
 * The base fee is charged per signature, and that includes signatures verified by
 * the Ed25519 and secp256 precompiles, not only the ones the message header
 * requires. See `./precompiles.ts`.
 *
 * Tips are not fees. They are ordinary SOL transfers to a block builder or relay,
 * so they never appear in `meta.fee`. They are counted separately and added only
 * into the total cost to land.
 *
 * A failed transaction pays none of them. The chain rolls its instructions back
 * and keeps only the fee, so a tip a failed transaction instructed never leaves
 * the payer's account. Counting it inflates what landing cost: in the recorded
 * block it would overstate the tips paid by a factor of nearly five.
 */

import type {
  ComputeBudgetDirectives,
  FeeBreakdown,
  NormalisedTransaction,
  PriorityFeeSource,
  TipTransfer,
} from '../types.js';
import { LAMPORTS_PER_SIGNATURE, MICRO_LAMPORTS_PER_LAMPORT } from './builtins.js';
import type { ResolvedComputeLimit } from './compute.js';
import { ceilDiv, sumBigints } from './math.js';
import { countPrecompileSignatures } from './precompiles.js';

export interface PriorityFee {
  readonly lamports: bigint;
  readonly source: PriorityFeeSource;
}

/** The base fee: one flat charge per charged signature. */
export function baseFee(signaturesCharged: number): bigint {
  return LAMPORTS_PER_SIGNATURE * BigInt(signaturesCharged);
}

/**
 * The priority fee implied by the transaction's own directives.
 *
 * This is derived from what the sender asked for, not from what was charged,
 * which is what makes it worth comparing against `meta.fee`.
 */
export function priorityFee(
  transaction: NormalisedTransaction,
  directives: ComputeBudgetDirectives,
  limit: ResolvedComputeLimit,
): PriorityFee {
  if (transaction.version === 1) {
    const declared = transaction.transactionConfig?.priorityFeeLamports;
    return declared === null || declared === undefined
      ? { lamports: 0n, source: 'none' }
      : { lamports: declared, source: 'v1-header' };
  }

  const price = directives.computeUnitPriceMicroLamports;
  if (price === null || price === 0n) return { lamports: 0n, source: 'none' };

  return {
    lamports: ceilDiv(price * BigInt(limit.effectiveLimit), MICRO_LAMPORTS_PER_LAMPORT),
    source: 'compute-unit-price',
  };
}

/**
 * Assembles the breakdown and checks the model against reality.
 *
 * `modelResidualLamports` is the point of this function. The model predicts the
 * fee from the transaction's directives; `meta.fee` says what was charged. The
 * two are independent, so their difference is a running self-test. It is
 * reported rather than smoothed over: a non-zero residual means the model is
 * missing something about this transaction, and the caller should know that
 * instead of trusting a confident wrong answer.
 */
export function buildFeeBreakdown(
  transaction: NormalisedTransaction,
  priority: PriorityFee,
  tips: readonly TipTransfer[],
): FeeBreakdown {
  const precompileSignatures = countPrecompileSignatures(transaction.instructions);
  const signaturesCharged = transaction.numRequiredSignatures + precompileSignatures;
  const baseLamports = baseFee(signaturesCharged);
  const modelledFeeLamports = baseLamports + priority.lamports;
  const observedFeeLamports = transaction.feeLamports;
  const succeeded = transaction.err === null || transaction.err === undefined;
  const tipLamportsInstructed = sumBigints(tips.map((tip) => tip.lamports));
  const tipLamports = succeeded ? tipLamportsInstructed : 0n;
  const labelledTipLamports = succeeded
    ? sumBigints(tips.filter((tip) => tip.service !== null).map((tip) => tip.lamports))
    : 0n;
  const impliedPriority = observedFeeLamports - baseLamports;

  return {
    baseLamports,
    signaturesCharged,
    precompileSignatures,
    priorityLamports: priority.lamports,
    prioritySource: priority.source,
    tipLamports,
    tipLamportsInstructed,
    labelledTipLamports,
    modelledFeeLamports,
    observedFeeLamports,
    modelResidualLamports: observedFeeLamports - modelledFeeLamports,
    impliedPriorityLamports: impliedPriority > 0n ? impliedPriority : 0n,
    totalCostLamports: observedFeeLamports + tipLamports,
  };
}
