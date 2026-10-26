/**
 * Resolving the compute unit limit a transaction was actually charged against,
 * and measuring how much of it went unused.
 */

import type {
  ComputeAnalysis,
  ComputeBudgetDirectives,
  ComputeLimitSource,
  NormalisedTransaction,
} from '../types.js';
import {
  MAX_COMPUTE_UNIT_LIMIT,
  MICRO_LAMPORTS_PER_LAMPORT,
  reservedComputeUnits,
} from './builtins.js';
import { ceilDiv } from './math.js';

export interface ResolvedComputeLimit {
  readonly effectiveLimit: number;
  readonly limitSource: ComputeLimitSource;
}

/**
 * The limit the runtime derives when a transaction declares none: the sum of the
 * units reserved for each instruction, capped at the per-transaction ceiling.
 */
export function runtimeDefaultComputeLimit(transaction: NormalisedTransaction): number {
  let total = 0;
  for (const instruction of transaction.instructions) {
    total += reservedComputeUnits(instruction.programAddress);
  }
  return Math.min(total, MAX_COMPUTE_UNIT_LIMIT);
}

/**
 * Works out which limit applies, and says where it came from.
 *
 * The order matters. On a version 1 transaction the header wins outright: any
 * ComputeBudget instruction present is inert, and reading it instead would report
 * the wrong limit — often zero, since a limit of 0 is a common no-op payload.
 */
export function resolveComputeLimit(
  transaction: NormalisedTransaction,
  directives: ComputeBudgetDirectives,
): ResolvedComputeLimit {
  if (transaction.version === 1) {
    return {
      effectiveLimit: transaction.transactionConfig?.computeUnitLimit ?? 0,
      limitSource: 'v1-header',
    };
  }
  if (directives.computeUnitLimit !== null) {
    return {
      effectiveLimit: Math.min(directives.computeUnitLimit, MAX_COMPUTE_UNIT_LIMIT),
      limitSource: 'compute-budget-instruction',
    };
  }
  return {
    effectiveLimit: runtimeDefaultComputeLimit(transaction),
    limitSource: 'runtime-default',
  };
}

/**
 * Compute waste, and what an exactly-fitted limit would have saved in lamports.
 *
 * The saving is zero on a version 1 transaction by construction: its priority fee
 * is an absolute lamport total, so declaring more compute than you use no longer
 * costs anything in fees. It still costs scheduling priority, because the
 * declared limit feeds the block's cost accounting.
 */
export function analyseCompute(
  transaction: NormalisedTransaction,
  directives: ComputeBudgetDirectives,
  limit: ResolvedComputeLimit,
): ComputeAnalysis {
  const consumed = transaction.computeUnitsConsumed;
  const effectiveLimitBig = BigInt(limit.effectiveLimit);

  const wasted =
    consumed === null ? null : effectiveLimitBig > consumed ? effectiveLimitBig - consumed : 0n;

  const wastedFraction =
    wasted === null || limit.effectiveLimit === 0 ? null : Number(wasted) / limit.effectiveLimit;

  let overpaidLamports = 0n;
  const price = directives.computeUnitPriceMicroLamports;
  if (transaction.version !== 1 && price !== null && price > 0n && consumed !== null) {
    const chargedForLimit = ceilDiv(price * effectiveLimitBig, MICRO_LAMPORTS_PER_LAMPORT);
    const chargedForConsumed = ceilDiv(price * consumed, MICRO_LAMPORTS_PER_LAMPORT);
    overpaidLamports =
      chargedForLimit > chargedForConsumed ? chargedForLimit - chargedForConsumed : 0n;
  }

  return {
    effectiveLimit: limit.effectiveLimit,
    limitSource: limit.limitSource,
    consumed,
    wasted,
    wastedFraction,
    overpaidLamports,
  };
}
