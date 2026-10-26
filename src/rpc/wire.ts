/**
 * The shape of the JSON-RPC responses this tool reads.
 *
 * Declared here rather than taken from a client library for two reasons. It is
 * the one place untyped wire data becomes typed domain data, so the narrowing
 * is visible and testable; and it lets a recorded JSON fixture travel through
 * exactly the same normalisation path as a live response, which is what makes
 * the offline tests meaningful.
 *
 * Numeric fields are `number | bigint` because the wire carries JSON numbers
 * while a client library may hand back bigints for lamport amounts. Both are
 * narrowed to `bigint` on the way in.
 */

export type WireNumber = number | bigint;

export interface WireInstruction {
  readonly programIdIndex: number;
  readonly accounts: readonly number[];
  /** Base58-encoded instruction data. */
  readonly data: string;
  readonly stackHeight?: number | null;
}

export interface WireInnerInstructionGroup {
  readonly index: number;
  readonly instructions: readonly WireInstruction[];
}

export interface WireTransactionConfig {
  readonly computeUnitLimit?: number | null;
  readonly priorityFee?: WireNumber | null;
  readonly loadedAccountsDataSizeLimit?: number | null;
  readonly heapSize?: number | null;
}

export interface WireMessage {
  readonly accountKeys: readonly string[];
  readonly header: {
    readonly numRequiredSignatures: number;
    readonly numReadonlySignedAccounts: number;
    readonly numReadonlyUnsignedAccounts: number;
  };
  readonly instructions: readonly WireInstruction[];
  readonly addressTableLookups?: readonly unknown[] | null;
  /** Version 1 only. */
  readonly transactionConfig?: WireTransactionConfig | null;
}

export interface WireLoadedAddresses {
  readonly writable: readonly string[];
  readonly readonly: readonly string[];
}

export interface WireMeta {
  readonly fee: WireNumber;
  readonly err: unknown;
  readonly computeUnitsConsumed?: WireNumber | null;
  readonly innerInstructions?: readonly WireInnerInstructionGroup[] | null;
  readonly loadedAddresses?: WireLoadedAddresses | null;
}

export interface WireTransaction {
  readonly transaction: {
    readonly message: WireMessage;
    readonly signatures: readonly string[];
  };
  readonly meta: WireMeta | null;
  readonly version?: 'legacy' | number;
  readonly slot?: WireNumber;
  readonly blockTime?: WireNumber | null;
}

export interface WireBlock {
  readonly parentSlot: WireNumber;
  readonly blockTime?: WireNumber | null;
  readonly transactions: readonly WireTransaction[];
}
