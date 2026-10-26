/**
 * solana-fee-lens
 *
 * Works out what a Solana transaction actually paid to land, and gets it right
 * across legacy, v0 and v1 transactions.
 *
 * The analysis functions are pure. Feed them a `NormalisedTransaction` and they
 * return a result with no network access involved, which is how this library is
 * tested against recorded blocks.
 */

export { type AccountInput, analyseAccount } from './analyze/account.js';
export { aggregate } from './analyze/aggregate.js';
export { analyseSlot } from './analyze/slot.js';
export { type AnalyseOptions, analyseTransaction } from './analyze/transaction.js';
export { decodeComputeBudget } from './model/budget.js';
export {
  BUILTIN_COMPUTE_UNIT_COSTS,
  DEFAULT_INSTRUCTION_COMPUTE_UNITS,
  LAMPORTS_PER_SIGNATURE,
  MAX_COMPUTE_UNIT_LIMIT,
  MICRO_LAMPORTS_PER_LAMPORT,
  reservedComputeUnits,
} from './model/builtins.js';
export {
  analyseCompute,
  type ResolvedComputeLimit,
  resolveComputeLimit,
  runtimeDefaultComputeLimit,
} from './model/compute.js';
export { baseFee, buildFeeBreakdown, type PriorityFee, priorityFee } from './model/fee.js';
export { ceilDiv, percentile, sumBigints } from './model/math.js';
export {
  countPrecompileSignatures,
  ED25519_PROGRAM,
  SECP256K1_PROGRAM,
  SECP256R1_PROGRAM,
  SIGNATURE_PRECOMPILES,
} from './model/precompiles.js';
export { decodeSystemTransfer, findTips } from './model/tips.js';
export { KNOWN_TIP_ACCOUNTS, type TipAccount, tipAccountIndex } from './registry/tip-accounts.js';
export {
  FeeLensRpc,
  MAX_SUPPORTED_TRANSACTION_VERSION,
  RpcError,
  type RpcOptions,
} from './rpc/client.js';
export { normaliseBlock, normaliseTransaction, resolveAccountKeys } from './rpc/normalise.js';
export type * from './rpc/wire.js';
export type * from './types.js';
