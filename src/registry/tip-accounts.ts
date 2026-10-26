/**
 * Known tip accounts.
 *
 * A tip is not a protocol fee. It is a plain SOL transfer to an account a block
 * builder or relay controls, so it never appears in `meta.fee` and has to be
 * found by looking at the instructions.
 *
 * Only accounts that can be checked against a published source belong here. The
 * Jito set below is the one its `getTipAccounts` endpoint returns; all eight were
 * observed receiving tips in the blocks recorded under `test/fixtures`.
 *
 * Other relays run tip accounts that are not published in any one place. Rather
 * than guess, the CLI takes `--tip-account <address>` (repeatable) so you can add
 * your own, and `docs/fee-model.md` states the gap plainly. A tip to an account
 * nobody has told us about is invisible to any tool, including this one.
 */

export interface TipAccount {
  readonly address: string;
  readonly service: string;
}

export const KNOWN_TIP_ACCOUNTS: readonly TipAccount[] = [
  { address: '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5', service: 'Jito' },
  { address: 'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe', service: 'Jito' },
  { address: 'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY', service: 'Jito' },
  { address: 'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49', service: 'Jito' },
  { address: 'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh', service: 'Jito' },
  { address: 'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt', service: 'Jito' },
  { address: 'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL', service: 'Jito' },
  { address: '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT', service: 'Jito' },
];

/**
 * Builds a lookup table, optionally extended with caller-supplied accounts.
 *
 * An entry may be a bare address or `address=label`. The label matters when you
 * run against several relays: a name you recognise in the output is worth more
 * than "custom" when you are comparing what each one costs you.
 */
export function tipAccountIndex(extra: readonly string[] = []): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const { address, service } of KNOWN_TIP_ACCOUNTS) index.set(address, service);

  for (const entry of extra) {
    const separator = entry.indexOf('=');
    const address = separator === -1 ? entry : entry.slice(0, separator);
    const label = separator === -1 ? 'custom' : entry.slice(separator + 1);
    if (address.length === 0) continue;
    index.set(address, label.length === 0 ? 'custom' : label);
  }

  return index;
}
