/**
 * Fee model, case by case, against transactions recorded from mainnet.
 *
 * Every expected number here was charged on chain. The figure that matters in
 * each case is `modelResidualLamports`: the model predicts the fee from the
 * transaction's own directives, `meta.fee` says what was actually taken, and a
 * residual of zero means the two agree exactly.
 */

import { describe, expect, it } from 'vitest';
import { analyseTransaction } from '../src/analyze/transaction.js';
import { normaliseTransaction } from '../src/rpc/normalise.js';
import { loadTransaction } from './fixtures.js';

function analyse(fixture: string) {
  return analyseTransaction(normaliseTransaction(loadTransaction(fixture)));
}

describe('legacy and v0: the fee is a rate times the declared limit', () => {
  it('charges price x explicit limit', () => {
    const { fee, compute, directives } = analyse('tx-legacy-explicit-limit');

    expect(directives.computeUnitPriceMicroLamports).toBe(57_000n);
    expect(directives.computeUnitLimit).toBe(600);
    expect(compute.limitSource).toBe('compute-budget-instruction');

    // ceil(57,000 micro-lamports x 600 units / 1e6) = 35 lamports.
    expect(fee.priorityLamports).toBe(35n);
    expect(fee.prioritySource).toBe('compute-unit-price');
    // Two required signatures, so the base fee is doubled.
    expect(fee.baseLamports).toBe(10_000n);
    expect(fee.observedFeeLamports).toBe(10_035n);
    expect(fee.modelResidualLamports).toBe(0n);
  });

  it('resolves account indices through address lookup tables', () => {
    const { fee, compute, addressTableLookupCount } = analyse('tx-v0-explicit-limit-with-alts');

    expect(addressTableLookupCount).toBe(3);
    expect(compute.effectiveLimit).toBe(707_059);
    expect(fee.priorityLamports).toBe(111_703n);
    expect(fee.modelResidualLamports).toBe(0n);
  });

  it('derives the limit from the instruction list when none is declared', () => {
    const { fee, compute, directives } = analyse('tx-v0-runtime-default-limit');

    expect(directives.computeUnitLimit).toBeNull();
    expect(compute.limitSource).toBe('runtime-default');
    // Five non-builtin instructions at 200,000 plus one System instruction at
    // 3,000 plus one ComputeBudget instruction at 3,000.
    expect(compute.effectiveLimit).toBe(1_006_000);
    expect(fee.priorityLamports).toBe(10_161n);
    expect(fee.modelResidualLamports).toBe(0n);
  });

  it('derives a smaller default for a shorter instruction list', () => {
    const { fee, compute } = analyse('tx-legacy-runtime-default-limit');

    // Two non-builtin instructions at 200,000 plus ComputeBudget at 3,000.
    expect(compute.effectiveLimit).toBe(403_000);
    expect(fee.priorityLamports).toBe(4_030n);
    expect(fee.modelResidualLamports).toBe(0n);
  });

  it('reserves 3,000 units for a builtin instruction', () => {
    const { compute, fee } = analyse('tx-no-priority-fee');

    // A single System Program instruction and no declared limit.
    expect(compute.effectiveLimit).toBe(3_000);
    expect(compute.consumed).toBe(150n);
    expect(fee.prioritySource).toBe('none');
    expect(fee.priorityLamports).toBe(0n);
    expect(fee.modelResidualLamports).toBe(0n);
  });
});

describe('v1: the fee is an absolute total in the header', () => {
  it('reads the priority fee from the header, not from a rate', () => {
    const { fee, compute } = analyse('tx-v1-header-priority-fee');

    expect(fee.prioritySource).toBe('v1-header');
    expect(fee.priorityLamports).toBe(1_000n);
    expect(fee.observedFeeLamports).toBe(6_000n);
    expect(fee.modelResidualLamports).toBe(0n);

    // The limit is large and the consumption tiny, yet the fee is unaffected:
    // on v1 the priority fee does not scale with the declared limit. Treating
    // 1,000 as a per-unit rate would predict 48 lamports instead of 1,000.
    expect(compute.effectiveLimit).toBe(48_484);
    expect(compute.consumed).toBe(287n);
    expect(compute.overpaidLamports).toBe(0n);
  });

  it('takes the limit from the header and ignores an inert ComputeBudget instruction', () => {
    const { compute, directives, fee } = analyse('tx-v1-inert-compute-budget');

    // The trap: the message carries a ComputeBudget instruction declaring a
    // limit of 0, while the limit the runtime charged against is in the header.
    expect(directives.instructionCount).toBe(1);
    expect(directives.computeUnitLimit).toBe(0);
    expect(directives.inertOnV1).toBe(true);

    expect(compute.limitSource).toBe('v1-header');
    expect(compute.effectiveLimit).toBe(327_450);
    expect(compute.consumed).toBe(121_199n);
    expect(fee.priorityLamports).toBe(5_008n);
    expect(fee.modelResidualLamports).toBe(0n);
  });

  it('records a failed transaction as having still paid', () => {
    const analysis = analyse('tx-v1-header-priority-fee');

    expect(analysis.succeeded).toBe(false);
    expect(analysis.err).not.toBeNull();
    expect(analysis.fee.observedFeeLamports).toBeGreaterThan(0n);
  });
});

describe('unused compute', () => {
  it('prices the waste on a transaction that over-declared', () => {
    const { compute } = analyse('tx-v0-runtime-default-limit');

    expect(compute.consumed).toBe(40_450n);
    expect(compute.wasted).toBe(965_550n);
    expect(compute.wastedFraction).toBeCloseTo(0.9598, 3);
    // ceil(10,100 x 1,006,000 / 1e6) - ceil(10,100 x 40,450 / 1e6).
    expect(compute.overpaidLamports).toBe(9_752n);
  });

  it('finds nothing to recover on an exactly fitted transaction', () => {
    const { compute } = analyse('tx-legacy-explicit-limit');

    expect(compute.effectiveLimit).toBe(600);
    expect(compute.consumed).toBe(600n);
    expect(compute.wasted).toBe(0n);
    expect(compute.overpaidLamports).toBe(0n);
  });
});

describe('precompile signatures', () => {
  it('charges the base fee for signatures a precompile verified', () => {
    const { fee } = analyse('tx-ed25519-precompile');

    // One required signature, one Ed25519 signature verified by the precompile.
    // Counting only the message header would predict 5,000 and be out by 5,000.
    expect(fee.precompileSignatures).toBe(1);
    expect(fee.signaturesCharged).toBe(2);
    expect(fee.baseLamports).toBe(10_000n);
    expect(fee.priorityLamports).toBe(2_788n);
    expect(fee.observedFeeLamports).toBe(12_788n);
    expect(fee.modelResidualLamports).toBe(0n);
  });

  it('counts no precompile signatures on an ordinary transaction', () => {
    const { fee } = analyse('tx-v0-explicit-limit-with-alts');

    expect(fee.precompileSignatures).toBe(0);
    expect(fee.signaturesCharged).toBe(1);
    expect(fee.modelResidualLamports).toBe(0n);
  });
});
