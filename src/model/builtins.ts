/**
 * Static compute-unit costs the runtime reserves for builtin programs.
 *
 * These only matter when a legacy or v0 transaction sets a compute unit *price*
 * but no compute unit *limit*. The runtime then derives a limit by walking the
 * instruction list and reserving a fixed cost per instruction: a small static
 * amount for a builtin program, and {@link DEFAULT_INSTRUCTION_COMPUTE_UNITS}
 * for anything else. Because the priority fee is `price x limit`, that derived
 * limit decides the fee, so getting it wrong means mispricing the transaction.
 *
 * The 3,000-unit figure is the allocation SIMD-0170 gives to programs **on its
 * builtin list**. A builtin that is migrated to sBPF is removed from that list
 * and falls back to the 200,000 default, so "migrated" means more compute
 * reserved, not less. The list below is exactly the one the proposal names;
 * anything absent from it, including the zk programs and secp256r1 (which
 * postdates the proposal), takes the 200,000 default here.
 *
 * `confirmed` marks the entries this repository verifies directly: its fixtures
 * contain transactions whose charged fee is only reproducible with that value.
 * The others follow the same rule but are not exercised by a fixture, so treat
 * them as the documented default rather than as measured fact. Any error here
 * surfaces as a non-zero `modelResidualLamports` rather than a silently wrong
 * number — see `docs/fee-model.md`.
 */
interface BuiltinCost {
  readonly computeUnits: number;
  readonly confirmed: boolean;
}

export const BUILTIN_COMPUTE_UNIT_COSTS: ReadonlyMap<string, BuiltinCost> = new Map([
  ['11111111111111111111111111111111', { computeUnits: 3000, confirmed: true }], // System
  ['ComputeBudget111111111111111111111111111111', { computeUnits: 3000, confirmed: true }],
  ['AddressLookupTab1e1111111111111111111111111', { computeUnits: 3000, confirmed: false }],
  ['Config1111111111111111111111111111111111111', { computeUnits: 3000, confirmed: false }],
  ['Stake11111111111111111111111111111111111111', { computeUnits: 3000, confirmed: false }],
  ['Vote111111111111111111111111111111111111111', { computeUnits: 3000, confirmed: false }],
  ['BPFLoader1111111111111111111111111111111111', { computeUnits: 3000, confirmed: false }],
  ['BPFLoader2111111111111111111111111111111111', { computeUnits: 3000, confirmed: false }],
  ['BPFLoaderUpgradeab1e11111111111111111111111', { computeUnits: 3000, confirmed: false }],
  ['LoaderV411111111111111111111111111111111111', { computeUnits: 3000, confirmed: false }],
  ['Ed25519SigVerify111111111111111111111111111', { computeUnits: 3000, confirmed: false }],
  ['KeccakSecp256k11111111111111111111111111111', { computeUnits: 3000, confirmed: false }],
]);

/** Reserved for an instruction whose program is not a builtin. */
export const DEFAULT_INSTRUCTION_COMPUTE_UNITS = 200_000;

/** The ceiling a single transaction may be budgeted. */
export const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;

/** Lamports charged per required signature. */
export const LAMPORTS_PER_SIGNATURE = 5_000n;

/** Micro-lamports in one lamport; the denominator of a compute unit price. */
export const MICRO_LAMPORTS_PER_LAMPORT = 1_000_000n;

export const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
export const SYSTEM_PROGRAM = '11111111111111111111111111111111';

/** Units the runtime reserves for one instruction when no limit is declared. */
export function reservedComputeUnits(programAddress: string): number {
  return (
    BUILTIN_COMPUTE_UNIT_COSTS.get(programAddress)?.computeUnits ??
    DEFAULT_INSTRUCTION_COMPUTE_UNITS
  );
}
