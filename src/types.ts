/**
 * Domain types for the fee model.
 *
 * Nothing in here depends on an RPC client. `NormalisedTransaction` is the single
 * input the whole model works from, which is what lets every analysis function be
 * pure and every test run offline against a recorded fixture.
 */

/** Transaction versions currently live on mainnet. */
export type TransactionVersion = 'legacy' | 0 | 1;

/** A single instruction, with account references already resolved to addresses. */
export interface NormalisedInstruction {
  /** The program being invoked. */
  readonly programAddress: string;
  /** Accounts passed to the instruction, in order. */
  readonly accountAddresses: readonly string[];
  /** Raw instruction data. */
  readonly data: Uint8Array;
  /** 1 for a top-level instruction, higher for instructions reached through CPI. */
  readonly stackHeight: number;
}

/**
 * The compute-budget configuration carried in a version 1 transaction header.
 *
 * Introduced by SIMD-0385. In a v1 transaction these values replace the
 * ComputeBudget instructions, and `priorityFee` is a **total in lamports** rather
 * than the per-compute-unit rate that `SetComputeUnitPrice` sets.
 */
export interface TransactionConfig {
  readonly computeUnitLimit: number | null;
  readonly priorityFeeLamports: bigint | null;
  readonly loadedAccountsDataSizeLimit: number | null;
  readonly heapSizeBytes: number | null;
}

/** A transaction reduced to the fields the fee model needs. */
export interface NormalisedTransaction {
  readonly signature: string;
  /** The account that paid the fee: the first account key. */
  readonly feePayer: string;
  readonly version: TransactionVersion;
  readonly slot: bigint;
  /** Signatures the message requires; the base fee is charged per required signature. */
  readonly numRequiredSignatures: number;
  /** The fee actually charged, from transaction metadata. The ground truth. */
  readonly feeLamports: bigint;
  /** Compute units the runtime reported consuming, when the RPC supplies it. */
  readonly computeUnitsConsumed: bigint | null;
  /** Execution error, or null when the transaction succeeded. */
  readonly err: unknown;
  /** Top-level instructions. */
  readonly instructions: readonly NormalisedInstruction[];
  /** Instructions reached through CPI, flattened. Used for tip detection. */
  readonly innerInstructions: readonly NormalisedInstruction[];
  /** Present only on version 1 transactions. */
  readonly transactionConfig: TransactionConfig | null;
  /** How many address lookup tables the message referenced. Always 0 for v1. */
  readonly addressTableLookupCount: number;
}

/** A block reduced to the transactions the fee model can read. */
export interface NormalisedBlock {
  readonly slot: bigint;
  readonly blockTime: bigint | null;
  readonly transactions: readonly NormalisedTransaction[];
}

/** Where the compute unit limit that the runtime actually charged came from. */
export type ComputeLimitSource =
  /** A `SetComputeUnitLimit` ComputeBudget instruction (legacy and v0). */
  | 'compute-budget-instruction'
  /** The v1 transaction header config. */
  | 'v1-header'
  /** No limit was declared, so the runtime derived one from the instruction list. */
  | 'runtime-default';

/** Where the priority fee came from. */
export type PriorityFeeSource =
  /** `SetComputeUnitPrice` x effective compute unit limit (legacy and v0). */
  | 'compute-unit-price'
  /** An absolute lamport total in the v1 header. */
  | 'v1-header'
  /** No priority fee was paid. */
  | 'none';

export interface ComputeBudgetDirectives {
  /** Micro-lamports per compute unit, from `SetComputeUnitPrice`. */
  readonly computeUnitPriceMicroLamports: bigint | null;
  /** Compute units requested, from `SetComputeUnitLimit`. */
  readonly computeUnitLimit: number | null;
  /** Bytes requested, from `SetLoadedAccountsDataSizeLimit`. */
  readonly loadedAccountsDataSizeLimit: number | null;
  /** Bytes requested, from `RequestHeapFrame`. */
  readonly heapFrameBytes: number | null;
  /** How many ComputeBudget instructions the transaction carried. */
  readonly instructionCount: number;
  /**
   * True when these directives were found on a v1 transaction, where the runtime
   * ignores them: they configure nothing and still occupy bytes and compute units.
   */
  readonly inertOnV1: boolean;
}

export interface ComputeAnalysis {
  /** The limit the runtime charged against. */
  readonly effectiveLimit: number;
  readonly limitSource: ComputeLimitSource;
  readonly consumed: bigint | null;
  /** Units budgeted but not used. Null when the RPC did not report consumption. */
  readonly wasted: bigint | null;
  /** `wasted / effectiveLimit`, as a fraction between 0 and 1. */
  readonly wastedFraction: number | null;
  /**
   * Lamports that an exactly-fitted compute unit limit would have saved.
   *
   * Always 0 for v1, where the priority fee is an absolute total and does not
   * scale with the declared limit. Over-declaring on v1 costs scheduling
   * priority rather than lamports.
   */
  readonly overpaidLamports: bigint;
}

/**
 * A payment made to get the transaction included: a tip, in the usual sense.
 *
 * `service` is null when the recipient is not in the registry. Such a payment is
 * still reported, because the alternative is to tell the caller a transaction
 * tipped nothing when it visibly moved SOL to a third party. Across the recorded
 * blocks, payments to unlisted recipients outnumber the ones to published Jito
 * accounts, so suppressing them would hide the majority of what is paid.
 */
export interface TipTransfer {
  readonly recipient: string;
  readonly lamports: bigint;
  /** The service, when the recipient is a known tip account; null when unlisted. */
  readonly service: string | null;
  /** Whether the transfer was a top-level instruction or reached through CPI. */
  readonly via: 'top-level' | 'inner';
  /** How this was identified. See `findTips`. */
  readonly basis: 'known-recipient' | 'unlabelled-outbound';
}

export interface FeeBreakdown {
  /** 5,000 lamports per charged signature. */
  readonly baseLamports: bigint;
  /**
   * Signatures the base fee was charged for: the message's required signatures
   * plus any a precompile verified.
   */
  readonly signaturesCharged: number;
  /** How many of those came from a signature-verifying precompile. */
  readonly precompileSignatures: number;
  /** The priority fee the model derives from the transaction's own directives. */
  readonly priorityLamports: bigint;
  readonly prioritySource: PriorityFeeSource;
  /**
   * Payments for inclusion that actually moved, which is zero on a failed
   * transaction: the chain rolls its instructions back and only the fee is
   * taken. Not part of the protocol fee.
   */
  readonly tipLamports: bigint;
  /**
   * What the transaction's transfers instructed, whether or not they executed.
   * Equal to `tipLamports` when the transaction succeeded. On a failed
   * transaction this is what was offered and `tipLamports` is what was paid.
   */
  readonly tipLamportsInstructed: bigint;
  /** The part of `tipLamports` paid to a recipient in the registry. */
  readonly labelledTipLamports: bigint;
  /** `baseLamports + priorityLamports`, the fee the model predicts. */
  readonly modelledFeeLamports: bigint;
  /** `feeLamports` from transaction metadata. The ground truth. */
  readonly observedFeeLamports: bigint;
  /**
   * `observedFee - modelledFee`. Zero means the model reproduced the charged fee
   * exactly. A non-zero value is surfaced rather than hidden: it means the fee
   * model is missing something about this transaction.
   */
  readonly modelResidualLamports: bigint;
  /** The priority fee implied by the charged fee, independent of the model. */
  readonly impliedPriorityLamports: bigint;
  /** Total cost to land: protocol fee plus tips. */
  readonly totalCostLamports: bigint;
}

export interface TransactionAnalysis {
  readonly signature: string;
  readonly version: TransactionVersion;
  readonly slot: bigint;
  readonly succeeded: boolean;
  readonly err: unknown;
  readonly fee: FeeBreakdown;
  readonly compute: ComputeAnalysis;
  readonly directives: ComputeBudgetDirectives;
  readonly tips: readonly TipTransfer[];
  readonly addressTableLookupCount: number;
}

/** Counts of transactions by how their priority fee was expressed. */
export interface FeeSourceCounts {
  readonly v1Header: number;
  readonly computeUnitPrice: number;
  readonly none: number;
}

export interface PercentileTable {
  readonly p50: bigint | null;
  readonly p75: bigint | null;
  readonly p90: bigint | null;
  readonly p99: bigint | null;
  readonly max: bigint | null;
}

/**
 * Aggregate cost statistics over a set of transactions.
 *
 * Shared by the slot view and the account view: the same figures answer "what
 * did this block cost" and "what has this account been paying".
 */
export interface CostAggregate {
  readonly transactionCount: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly versionCounts: Readonly<Record<string, number>>;
  readonly feeSources: FeeSourceCounts;

  readonly totalFeeLamports: bigint;
  readonly totalPriorityLamports: bigint;
  readonly totalTipLamports: bigint;
  readonly tipPayingTransactions: number;

  readonly totalComputeBudgeted: bigint;
  readonly totalComputeConsumed: bigint;
  /** Budgeted but unused, as a fraction of what was budgeted. */
  readonly computeWastedFraction: number | null;
  /** Lamports an exactly fitted compute unit limit would have saved, summed. */
  readonly totalOverpaidLamports: bigint;

  /** Priority fee per transaction, over transactions that paid one. */
  readonly priorityLamportsPercentiles: PercentileTable;
  /**
   * Priority fee per compute unit consumed, in micro-lamports, over transactions
   * that paid a priority fee and reported consumption. More comparable across
   * transactions than a per-transaction total, which scales with size.
   */
  readonly priorityPerComputeUnitPercentiles: PercentileTable;

  /**
   * How many transactions the fee model failed to reproduce exactly.
   *
   * This is a self-test that runs on every real transaction the tool reads. It
   * should be zero; if it is not, the model is out of date with the runtime.
   */
  readonly modelMismatches: number;

  readonly transactions: readonly TransactionAnalysis[];
}

export interface SlotAnalysis extends CostAggregate {
  readonly slot: bigint;
  readonly blockTime: bigint | null;
}

export interface AccountAnalysis extends CostAggregate {
  readonly address: string;
  /** Signatures inspected, newest first. */
  readonly signaturesInspected: number;
}
