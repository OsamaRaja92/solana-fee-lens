/**
 * Aggregation shared by the slot and account views.
 *
 * Kept separate from both so the two cannot drift apart: "what did this block
 * cost" and "what has this account been paying" are the same arithmetic over a
 * different set of transactions.
 */

import { MICRO_LAMPORTS_PER_LAMPORT } from '../model/builtins.js';
import { percentile } from '../model/math.js';
import type {
  CostAggregate,
  PercentileTable,
  PriorityFeeSource,
  TransactionAnalysis,
} from '../types.js';

function buildPercentiles(values: readonly bigint[]): PercentileTable {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
    p99: percentile(sorted, 0.99),
    max: percentile(sorted, 1),
  };
}

interface Totals {
  succeeded: number;
  fee: bigint;
  priority: bigint;
  tips: bigint;
  tipPayers: number;
  computeBudgeted: bigint;
  computeConsumed: bigint;
  overpaid: bigint;
  modelMismatches: number;
}

function emptyTotals(): Totals {
  return {
    succeeded: 0,
    fee: 0n,
    priority: 0n,
    tips: 0n,
    tipPayers: 0,
    computeBudgeted: 0n,
    computeConsumed: 0n,
    overpaid: 0n,
    modelMismatches: 0,
  };
}

function addTo(totals: Totals, analysis: TransactionAnalysis): void {
  if (analysis.succeeded) totals.succeeded += 1;
  if (analysis.fee.modelResidualLamports !== 0n) totals.modelMismatches += 1;

  totals.fee += analysis.fee.observedFeeLamports;
  totals.priority += analysis.fee.priorityLamports;
  totals.tips += analysis.fee.tipLamports;
  if (analysis.fee.tipLamports > 0n) totals.tipPayers += 1;

  totals.computeBudgeted += BigInt(analysis.compute.effectiveLimit);
  totals.computeConsumed += analysis.compute.consumed ?? 0n;
  totals.overpaid += analysis.compute.overpaidLamports;
}

/** Micro-lamports of priority fee per compute unit consumed, or null if not derivable. */
function pricePerComputeUnit(analysis: TransactionAnalysis): bigint | null {
  const consumed = analysis.compute.consumed;
  if (analysis.fee.priorityLamports <= 0n || consumed === null || consumed <= 0n) return null;
  return (analysis.fee.priorityLamports * MICRO_LAMPORTS_PER_LAMPORT) / consumed;
}

function countBy<K extends string>(keys: readonly K[]): Record<K, number> {
  const counts = {} as Record<K, number>;
  for (const key of keys) counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}

export function aggregate(analyses: readonly TransactionAnalysis[]): CostAggregate {
  const totals = emptyTotals();
  for (const analysis of analyses) addTo(totals, analysis);

  const sourceCounts = countBy(analyses.map((a): PriorityFeeSource => a.fee.prioritySource));
  const priorityValues = analyses
    .map((a) => a.fee.priorityLamports)
    .filter((lamports) => lamports > 0n);
  const perUnitValues = analyses
    .map(pricePerComputeUnit)
    .filter((value): value is bigint => value !== null);

  return {
    transactionCount: analyses.length,
    succeeded: totals.succeeded,
    failed: analyses.length - totals.succeeded,
    versionCounts: countBy(analyses.map((a) => String(a.version))),
    feeSources: {
      v1Header: sourceCounts['v1-header'] ?? 0,
      computeUnitPrice: sourceCounts['compute-unit-price'] ?? 0,
      none: sourceCounts.none ?? 0,
    },
    totalFeeLamports: totals.fee,
    totalPriorityLamports: totals.priority,
    totalTipLamports: totals.tips,
    tipPayingTransactions: totals.tipPayers,
    totalComputeBudgeted: totals.computeBudgeted,
    totalComputeConsumed: totals.computeConsumed,
    computeWastedFraction:
      totals.computeBudgeted === 0n
        ? null
        : Number(totals.computeBudgeted - totals.computeConsumed) / Number(totals.computeBudgeted),
    totalOverpaidLamports: totals.overpaid,
    priorityLamportsPercentiles: buildPercentiles(priorityValues),
    priorityPerComputeUnitPercentiles: buildPercentiles(perUnitValues),
    modelMismatches: totals.modelMismatches,
    transactions: analyses,
  };
}
