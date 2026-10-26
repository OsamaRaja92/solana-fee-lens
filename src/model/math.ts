/** Small integer helpers. Lamports are held as `bigint` throughout, never as a float. */

/** Ceiling division for non-negative bigints. The runtime rounds fees up. */
export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive');
  if (numerator <= 0n) return 0n;
  return (numerator + denominator - 1n) / denominator;
}

/**
 * Nearest-rank percentile over a sorted ascending array.
 *
 * Nearest-rank is used rather than an interpolating definition because every
 * value returned is a figure some transaction actually paid, which is what makes
 * the output usable as a reference point.
 */
export function percentile(sortedAscending: readonly bigint[], fraction: number): bigint | null {
  if (sortedAscending.length === 0) return null;
  if (fraction <= 0) return sortedAscending[0] ?? null;
  if (fraction >= 1) return sortedAscending[sortedAscending.length - 1] ?? null;
  const rank = Math.ceil(fraction * sortedAscending.length) - 1;
  const index = Math.min(Math.max(rank, 0), sortedAscending.length - 1);
  return sortedAscending[index] ?? null;
}

export function sumBigints(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const value of values) total += value;
  return total;
}
