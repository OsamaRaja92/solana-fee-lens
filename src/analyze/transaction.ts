/**
 * Puts the model together for a single transaction.
 *
 * Pure: it takes a normalised transaction and returns an analysis. No network, no
 * clock, no configuration beyond the tip registry, which makes every case in
 * `test/` a plain input-output assertion.
 */

import { decodeComputeBudget } from '../model/budget.js';
import { analyseCompute, resolveComputeLimit } from '../model/compute.js';
import { buildFeeBreakdown, priorityFee } from '../model/fee.js';
import { findTips } from '../model/tips.js';
import { tipAccountIndex } from '../registry/tip-accounts.js';
import type { NormalisedTransaction, TransactionAnalysis } from '../types.js';

export interface AnalyseOptions {
  /** Extra tip accounts to recognise, on top of the published registry. */
  readonly tipAccounts?: ReadonlyMap<string, string>;
  /**
   * Report only payments to recipients in the registry, suppressing the
   * unlabelled-outbound heuristic. Off by default, because most relays do not
   * publish their tip accounts and suppressing them under-reports what was paid.
   */
  readonly knownRecipientsOnly?: boolean;
}

export function analyseTransaction(
  transaction: NormalisedTransaction,
  options: AnalyseOptions = {},
): TransactionAnalysis {
  const tipAccounts = options.tipAccounts ?? tipAccountIndex();

  const directives = decodeComputeBudget(transaction.instructions, {
    isVersion1: transaction.version === 1,
  });
  const limit = resolveComputeLimit(transaction, directives);
  const compute = analyseCompute(transaction, directives, limit);
  const tips = findTips(transaction, tipAccounts, {
    knownRecipientsOnly: options.knownRecipientsOnly === true,
  });
  const fee = buildFeeBreakdown(transaction, priorityFee(transaction, directives, limit), tips);

  return {
    signature: transaction.signature,
    version: transaction.version,
    slot: transaction.slot,
    succeeded: transaction.err === null || transaction.err === undefined,
    err: transaction.err ?? null,
    fee,
    compute,
    directives,
    tips,
    addressTableLookupCount: transaction.addressTableLookupCount,
  };
}
