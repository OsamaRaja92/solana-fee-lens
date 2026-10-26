/**
 * Account-level view: what one address has been paying to get its transactions in.
 *
 * Deliberately generic. Point it at a wallet, a program or any account that
 * appears in transactions, and it reports the same cost figures the slot view
 * reports, over that account's recent history instead of over one block.
 */

import type { AccountAnalysis, NormalisedTransaction } from '../types.js';
import { aggregate } from './aggregate.js';
import { type AnalyseOptions, analyseTransaction } from './transaction.js';

export interface AccountInput {
  readonly address: string;
  readonly signaturesInspected: number;
  readonly transactions: readonly NormalisedTransaction[];
}

export function analyseAccount(input: AccountInput, options: AnalyseOptions = {}): AccountAnalysis {
  const analyses = input.transactions.map((transaction) =>
    analyseTransaction(transaction, options),
  );
  return {
    address: input.address,
    signaturesInspected: input.signaturesInspected,
    ...aggregate(analyses),
  };
}
