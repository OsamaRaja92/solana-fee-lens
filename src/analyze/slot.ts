/**
 * Slot-level view: what it cost to be in this block.
 *
 * A caveat worth stating before the numbers are used for anything. This measures
 * the transactions that LANDED. It cannot see the ones that were dropped, so the
 * distribution says what was sufficient, not what was necessary. Reading a
 * percentile here as "the bid required to land" treats a sample of winners as if
 * it described the whole field.
 */

import type { NormalisedBlock, SlotAnalysis } from '../types.js';
import { aggregate } from './aggregate.js';
import { type AnalyseOptions, analyseTransaction } from './transaction.js';

export function analyseSlot(block: NormalisedBlock, options: AnalyseOptions = {}): SlotAnalysis {
  const analyses = block.transactions.map((transaction) =>
    analyseTransaction(transaction, options),
  );
  return { slot: block.slot, blockTime: block.blockTime, ...aggregate(analyses) };
}
