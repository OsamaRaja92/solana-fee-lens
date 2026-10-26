/**
 * A thin, retrying RPC client.
 *
 * Every read passes `maxSupportedTransactionVersion: 1`. Omitting it, or passing
 * 0, makes the node refuse the whole response with error -32015 the moment a
 * version it considers newer appears, and about half the transactions in a
 * current mainnet block are v1. Tooling written before v1 landed either errors
 * out or, worse, quietly reports partial coverage.
 */

import { address, createSolanaRpc, signature as toSignature } from '@solana/kit';
import type { NormalisedBlock, NormalisedTransaction } from '../types.js';
import { normaliseBlock, normaliseTransaction } from './normalise.js';
import type { WireBlock, WireTransaction } from './wire.js';

/** The newest transaction version whose fee rules this build implements. */
export const MAX_SUPPORTED_TRANSACTION_VERSION = 1;

/** The page size `getSignaturesForAddress` allows. */
const SIGNATURE_PAGE_SIZE = 1000;

export interface RpcOptions {
  readonly url: string;
  readonly commitment?: 'confirmed' | 'finalized';
  readonly maxAttempts?: number;
}

/**
 * Attempts before giving up. Set with the public endpoint in mind: it rate limits
 * a burst of reads hard, and backing off for a few seconds usually clears it.
 */
const DEFAULT_MAX_ATTEMPTS = 6;

export class RpcError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options);
    this.name = 'RpcError';
  }
}

function isRateLimit(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|rate limit|too many requests/i.test(message);
}

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    isRateLimit(error) ||
    /\b50[0234]\b|timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed/i.test(message)
  );
}

function describeVersionRefusal(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes('-32015') && !/not supported by the requesting client/i.test(message)) {
    return null;
  }
  return (
    'The node refused the response because it contains a transaction version newer than ' +
    `${MAX_SUPPORTED_TRANSACTION_VERSION}. A new transaction version has probably shipped, and its ` +
    'fee rules are not modelled here. Treat any older reading of this block as incomplete rather ' +
    'than correct.'
  );
}

/**
 * Decides whether a failed attempt is worth another try, and throws if it is not.
 *
 * Separate from the retry loop so that each reads as one idea: this function
 * classifies an error, the loop paces the retries.
 */
function rethrowIfFatal(error: unknown, attempt: number, maxAttempts: number): void {
  const refusal = describeVersionRefusal(error);
  if (refusal !== null) throw new RpcError(refusal, { cause: error });

  if (!isRetryable(error)) throw error;
  if (attempt < maxAttempts) return;

  // Out of attempts. Say what to do about it: a bare 429 leaves the caller
  // guessing, and the usual cause is the default public endpoint, not a bug.
  if (isRateLimit(error)) {
    throw new RpcError(
      `The RPC endpoint rate limited this read and was still rate limiting after ${maxAttempts} ` +
        'attempts. Point --rpc at an endpoint with more headroom, or ask for less at once ' +
        '(a smaller --limit, or --concurrency 1).',
      { cause: error },
    );
  }
  throw error;
}

async function withRetry<T>(operation: () => Promise<T>, maxAttempts: number): Promise<T> {
  let delayMs = 400;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      rethrowIfFatal(error, attempt, maxAttempts);
      // Jitter keeps a batch of parallel callers from retrying in lockstep.
      const jitter = Math.floor(Math.random() * 100);
      await new Promise((resolve) => setTimeout(resolve, delayMs + jitter));
      delayMs *= 2;
    }
  }
}

export class FeeLensRpc {
  private readonly rpc: ReturnType<typeof createSolanaRpc>;
  private readonly commitment: 'confirmed' | 'finalized';
  private readonly maxAttempts: number;

  constructor(options: RpcOptions) {
    this.rpc = createSolanaRpc(options.url);
    this.commitment = options.commitment ?? 'confirmed';
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  async getTransaction(signature: string): Promise<NormalisedTransaction> {
    const response = await withRetry(
      () =>
        this.rpc
          .getTransaction(toSignature(signature), {
            commitment: this.commitment,
            encoding: 'json',
            maxSupportedTransactionVersion: MAX_SUPPORTED_TRANSACTION_VERSION,
          })
          .send(),
      this.maxAttempts,
    );

    if (response === null) {
      throw new RpcError(
        `No transaction found for signature ${signature}. It may have been dropped, or be ` +
          'outside the node’s history.',
      );
    }
    return normaliseTransaction(response as unknown as WireTransaction);
  }

  async getSlot(): Promise<bigint> {
    return withRetry(
      () => this.rpc.getSlot({ commitment: this.commitment }).send(),
      this.maxAttempts,
    );
  }

  async getBlock(slot: bigint): Promise<NormalisedBlock> {
    const response = await withRetry(
      () =>
        this.rpc
          .getBlock(slot, {
            commitment: this.commitment === 'confirmed' ? 'confirmed' : 'finalized',
            encoding: 'json',
            maxSupportedTransactionVersion: MAX_SUPPORTED_TRANSACTION_VERSION,
            rewards: false,
            transactionDetails: 'full',
          })
          .send(),
      this.maxAttempts,
    );

    if (response === null || response === undefined) {
      throw new RpcError(`Slot ${slot} produced no block. It was probably skipped.`);
    }
    return normaliseBlock(response as unknown as WireBlock, slot);
  }

  /** Newest first, paging until `limit` signatures are collected or history runs out. */
  async getSignatures(forAddress: string, limit: number): Promise<string[]> {
    const target = address(forAddress);
    const collected: string[] = [];
    let before: string | undefined;

    while (collected.length < limit) {
      const page = Math.min(SIGNATURE_PAGE_SIZE, limit - collected.length);
      const response = await withRetry(
        () =>
          this.rpc
            .getSignaturesForAddress(target, {
              commitment: this.commitment,
              limit: page,
              ...(before === undefined ? {} : { before: toSignature(before) }),
            })
            .send(),
        this.maxAttempts,
      );

      if (response.length === 0) break;
      for (const entry of response) collected.push(entry.signature);
      const last = response[response.length - 1];
      if (last === undefined || response.length < page) break;
      before = last.signature;
    }

    return collected;
  }
}
