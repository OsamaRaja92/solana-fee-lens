/** Integer helpers. Fees round up, and percentiles return values that were really paid. */

import { describe, expect, it } from 'vitest';
import { ceilDiv, percentile, sumBigints } from '../src/model/math.js';

describe('ceilDiv', () => {
  it('rounds up on a remainder', () => {
    expect(ceilDiv(1n, 1_000_000n)).toBe(1n);
    expect(ceilDiv(999_999n, 1_000_000n)).toBe(1n);
    expect(ceilDiv(1_000_001n, 1_000_000n)).toBe(2n);
  });

  it('is exact when the division is exact', () => {
    expect(ceilDiv(2_000_000n, 1_000_000n)).toBe(2n);
    expect(ceilDiv(0n, 1_000_000n)).toBe(0n);
  });

  it('stays exact far beyond the range of a double', () => {
    const price = 18_446_744_073_709_551_615n;
    expect(ceilDiv(price * 1_400_000n, 1_000_000n)).toBe(25_825_441_703_193_372_261n);
  });

  it('refuses a non-positive denominator', () => {
    expect(() => ceilDiv(1n, 0n)).toThrow(RangeError);
  });
});

describe('percentile', () => {
  const values = [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n];

  it('uses nearest rank, so every result is a value from the data', () => {
    expect(percentile(values, 0.5)).toBe(5n);
    expect(percentile(values, 0.9)).toBe(9n);
    expect(percentile(values, 1)).toBe(10n);
  });

  it('clamps out-of-range fractions', () => {
    expect(percentile(values, 0)).toBe(1n);
    expect(percentile(values, -1)).toBe(1n);
    expect(percentile(values, 2)).toBe(10n);
  });

  it('returns null for no data', () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  it('handles a single value', () => {
    expect(percentile([42n], 0.5)).toBe(42n);
  });
});

describe('sumBigints', () => {
  it('adds without overflowing', () => {
    expect(sumBigints([1n, 2n, 3n])).toBe(6n);
    expect(sumBigints([])).toBe(0n);
    expect(sumBigints([2n ** 70n, 2n ** 70n])).toBe(2n ** 71n);
  });
});
