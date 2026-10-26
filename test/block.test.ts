/**
 * The whole-block test.
 *
 * This is the strongest claim the project makes: for every transaction in a real
 * mainnet block, the fee predicted from the transaction's own directives equals
 * the fee the chain charged, to the lamport. The block mixes all three live
 * transaction versions and every way of expressing a priority fee, so it covers
 * the model's branches with real data rather than with cases chosen to pass.
 *
 * If a future runtime change alters how fees are derived, this test fails.
 */

import { describe, expect, it } from 'vitest';
import { analyseSlot } from '../src/analyze/slot.js';
import { normaliseBlock } from '../src/rpc/normalise.js';
import { loadBlock, RECORDED_BLOCK } from './fixtures.js';

const analysis = analyseSlot(normaliseBlock(loadBlock(RECORDED_BLOCK.name), RECORDED_BLOCK.slot));

describe(`slot ${RECORDED_BLOCK.slot}`, () => {
  it('reproduces the charged fee for every transaction in the block', () => {
    const offBy = analysis.transactions.filter((tx) => tx.fee.modelResidualLamports !== 0n);

    expect(
      offBy.map((tx) => ({
        signature: tx.signature,
        version: tx.version,
        residual: tx.fee.modelResidualLamports.toString(),
      })),
    ).toEqual([]);
    expect(analysis.modelMismatches).toBe(0);
    expect(analysis.transactionCount).toBe(574);
  });

  it('covers all three live transaction versions', () => {
    // Recorded 2026-10-25. v1 was already the largest share.
    expect(analysis.versionCounts).toEqual({ legacy: 104, '0': 190, '1': 280 });
  });

  it('covers every way of expressing a priority fee', () => {
    expect(analysis.feeSources.v1Header).toBeGreaterThan(0);
    expect(analysis.feeSources.computeUnitPrice).toBeGreaterThan(0);
    expect(analysis.feeSources.none).toBeGreaterThan(0);
    const total =
      analysis.feeSources.v1Header +
      analysis.feeSources.computeUnitPrice +
      analysis.feeSources.none;
    expect(total).toBe(analysis.transactionCount);
  });

  it('totals the fees to the sum of the parts', () => {
    const summed = analysis.transactions.reduce((acc, tx) => acc + tx.fee.observedFeeLamports, 0n);
    expect(analysis.totalFeeLamports).toBe(summed);
    expect(analysis.succeeded + analysis.failed).toBe(analysis.transactionCount);
  });

  it('counts only the tips a successful transaction actually paid', () => {
    // A failed transaction's transfers are rolled back, so the tips it
    // instructed never move. Counting them inflated this block's tips from
    // 13,842,684 to 67,345,751 lamports, nearly five times over.
    expect(analysis.totalTipLamports).toBe(13_842_684n);
    expect(analysis.tipPayingTransactions).toBe(86);

    const instructedOnFailures = analysis.transactions
      .filter((tx) => !tx.succeeded)
      .reduce((total, tx) => total + tx.fee.tipLamportsInstructed, 0n);
    expect(instructedOnFailures).toBe(53_503_067n);

    for (const tx of analysis.transactions.filter((tx) => !tx.succeeded)) {
      expect(tx.fee.tipLamports).toBe(0n);
      expect(tx.fee.totalCostLamports).toBe(tx.fee.observedFeeLamports);
    }

    // Tips are transfers, not protocol fees, so they must not be counted in
    // meta.fee. Every tip-paying transaction should still reproduce exactly.
    const tipPayers = analysis.transactions.filter((tx) => tx.fee.tipLamports > 0n);
    for (const tx of tipPayers) expect(tx.fee.modelResidualLamports).toBe(0n);
  });

  it('reports percentiles only over transactions that paid a priority fee', () => {
    const { p50, max } = analysis.priorityLamportsPercentiles;
    expect(p50).not.toBeNull();
    expect(max).not.toBeNull();
    if (p50 !== null && max !== null) expect(max).toBeGreaterThanOrEqual(p50);
  });

  it('measures compute that was budgeted but never used', () => {
    expect(analysis.totalComputeBudgeted).toBeGreaterThan(analysis.totalComputeConsumed);
    expect(analysis.computeWastedFraction).not.toBeNull();
    if (analysis.computeWastedFraction !== null) {
      expect(analysis.computeWastedFraction).toBeGreaterThan(0);
      expect(analysis.computeWastedFraction).toBeLessThan(1);
    }
  });
});
