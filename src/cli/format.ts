/** Formatting helpers. Lamport amounts are converted to text exactly, never through a float. */

const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Renders lamports as SOL with full precision and no trailing zeroes. */
export function formatSol(lamports: bigint, minimumDecimals = 0): string {
  const negative = lamports < 0n;
  const value = negative ? -lamports : lamports;
  const whole = value / LAMPORTS_PER_SOL;
  const fraction = value % LAMPORTS_PER_SOL;

  let digits = fraction.toString().padStart(9, '0').replace(/0+$/, '');
  while (digits.length < minimumDecimals) digits += '0';

  const body = digits.length === 0 ? whole.toString() : `${whole}.${digits}`;
  return negative ? `-${body}` : body;
}

export function formatLamports(lamports: bigint): string {
  return `${lamports.toLocaleString('en-US')}`;
}

export function formatInteger(value: bigint | number): string {
  return value.toLocaleString('en-US');
}

/** Slot and block numbers are identifiers, so they are printed without separators. */
export function formatSlot(slot: bigint): string {
  return slot.toString();
}

export function formatPercent(fraction: number | null, decimals = 1): string {
  return fraction === null ? '-' : `${(fraction * 100).toFixed(decimals)}%`;
}

export function shorten(value: string, edge = 6): string {
  return value.length <= edge * 2 + 1 ? value : `${value.slice(0, edge)}..${value.slice(-edge)}`;
}

export function formatVersion(version: 'legacy' | 0 | 1): string {
  return version === 'legacy' ? 'legacy' : `v${version}`;
}

/** JSON replacer that renders bigints as decimal strings rather than failing. */
export function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

/**
 * `JSON.stringify` that survives bigints.
 *
 * Needed because an RPC client may hand back bigints anywhere in a response,
 * including inside a transaction's error payload, and plain `JSON.stringify`
 * throws on those rather than degrading.
 */
export function safeJson(value: unknown): string {
  return JSON.stringify(value, jsonReplacer) ?? 'null';
}
