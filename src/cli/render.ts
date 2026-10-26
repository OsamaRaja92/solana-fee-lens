/** Terminal views. All numbers come from the analysis; nothing is recomputed here. */

import pc from 'picocolors';
import type {
  AccountAnalysis,
  CostAggregate,
  PercentileTable,
  SlotAnalysis,
  TipTransfer,
  TransactionAnalysis,
} from '../types.js';
import {
  formatInteger,
  formatPercent,
  formatSlot,
  formatSol,
  formatVersion,
  safeJson,
  shorten,
} from './format.js';
import { renderTable } from './table.js';

const LIMIT_SOURCE_LABEL = {
  'compute-budget-instruction': 'from a SetComputeUnitLimit instruction',
  'v1-header': 'from the v1 header',
  'runtime-default': 'derived by the runtime (none declared)',
} as const;

const PRIORITY_SOURCE_LABEL = {
  'compute-unit-price': 'price per compute unit x limit',
  'v1-header': 'absolute total in the v1 header',
  none: 'no priority fee paid',
} as const;

const LABEL_WIDTH = 19;

function field(label: string, value: string, note?: string): string {
  const padded = label.padEnd(LABEL_WIDTH);
  return note === undefined
    ? `  ${pc.dim(padded)}${value}`
    : `  ${pc.dim(padded)}${value}  ${pc.dim(note)}`;
}

/**
 * The note beside the tips line.
 *
 * A failed transaction pays nothing: its transfers are rolled back, so what it
 * instructed is reported separately from what it paid.
 */
function describeTipLine(analysis: TransactionAnalysis): string {
  if (analysis.tips.length === 0) return 'no outbound payment found';
  if (!analysis.succeeded) {
    return `${formatInteger(analysis.fee.tipLamportsInstructed)} instructed, rolled back with the transaction`;
  }
  return describeTips(analysis.tips);
}

/** Says how many payments were found and how many had an identifiable recipient. */
function describeTips(tips: readonly TipTransfer[]): string {
  const labelled = tips.filter((tip) => tip.service !== null).length;
  const unlabelled = tips.length - labelled;
  if (unlabelled === 0) return `${labelled} payment(s), recipient identified`;
  if (labelled === 0) return `${unlabelled} payment(s), recipient not in the registry`;
  return `${labelled} identified, ${unlabelled} to unlisted recipient(s)`;
}

function lamportLine(label: string, lamports: bigint, note?: string): string {
  const value = `${formatInteger(lamports).padStart(14)} lamports`;
  return field(label, value, note);
}

function percentileRows(table: PercentileTable, render: (value: bigint) => string): string {
  const entries: [string, bigint | null][] = [
    ['p50', table.p50],
    ['p75', table.p75],
    ['p90', table.p90],
    ['p99', table.p99],
    ['max', table.max],
  ];
  return entries
    .map(([name, value]) => `  ${pc.dim(name.padEnd(6))}${value === null ? '-' : render(value)}`)
    .join('\n');
}

export function renderTransaction(analysis: TransactionAnalysis): string {
  const { fee, compute, directives } = analysis;
  const out: string[] = [];

  out.push(pc.bold(`Transaction ${shorten(analysis.signature, 8)}`));
  out.push(field('version', formatVersion(analysis.version)));
  out.push(field('slot', formatSlot(analysis.slot)));
  out.push(
    field(
      'result',
      analysis.succeeded ? pc.green('success') : pc.red('failed'),
      analysis.succeeded ? undefined : safeJson(analysis.err).slice(0, 120),
    ),
  );
  if (analysis.addressTableLookupCount > 0) {
    out.push(field('lookup tables', formatInteger(analysis.addressTableLookupCount)));
  }

  out.push('', pc.bold('Fee'));
  out.push(
    lamportLine(
      'base',
      fee.baseLamports,
      fee.precompileSignatures > 0
        ? `${formatInteger(fee.signaturesCharged)} signature(s) x 5,000, ${formatInteger(fee.precompileSignatures)} from a precompile`
        : `${formatInteger(fee.signaturesCharged)} signature(s) x 5,000`,
    ),
  );
  out.push(
    lamportLine('priority', fee.priorityLamports, PRIORITY_SOURCE_LABEL[fee.prioritySource]),
  );
  out.push(lamportLine('tips', fee.tipLamports, describeTipLine(analysis)));
  out.push(
    lamportLine('charged', fee.observedFeeLamports, `${formatSol(fee.observedFeeLamports)} SOL`),
  );
  out.push(
    lamportLine(
      'total to land',
      fee.totalCostLamports,
      `${formatSol(fee.totalCostLamports)} SOL, fee plus tips`,
    ),
  );

  if (fee.modelResidualLamports === 0n) {
    out.push(
      field('model check', pc.green('exact'.padStart(14)), 'the model reproduces the charged fee'),
    );
  } else {
    out.push(
      field(
        'model check',
        pc.yellow(`off by ${formatInteger(fee.modelResidualLamports)}`.padStart(14)),
        'lamports unaccounted for: the fee model is incomplete here',
      ),
    );
  }

  out.push('', pc.bold('Compute'));
  out.push(
    field(
      'limit',
      `${formatInteger(compute.effectiveLimit).padStart(14)} units`,
      LIMIT_SOURCE_LABEL[compute.limitSource],
    ),
  );
  out.push(
    field(
      'consumed',
      `${(compute.consumed === null ? '-' : formatInteger(compute.consumed)).padStart(14)} units`,
    ),
  );
  out.push(
    field(
      'unused',
      `${(compute.wasted === null ? '-' : formatInteger(compute.wasted)).padStart(14)} units`,
      compute.wastedFraction === null
        ? undefined
        : `${formatPercent(compute.wastedFraction)} of the budget`,
    ),
  );
  out.push(
    lamportLine(
      'overpaid',
      compute.overpaidLamports,
      analysis.version === 1
        ? 'a v1 priority fee does not scale with the limit'
        : 'what an exactly fitted limit would have saved',
    ),
  );

  if (directives.inertOnV1) {
    out.push('', pc.yellow('ComputeBudget instructions present but inert'));
    out.push(
      pc.dim(
        `  This is a v1 transaction, so the runtime reads its limits from the header and ignores\n` +
          `  the ${directives.instructionCount} ComputeBudget instruction(s) in the message. Those instructions declare a\n` +
          `  limit of ${directives.computeUnitLimit === null ? 'none' : formatInteger(directives.computeUnitLimit)}, against the header's ${formatInteger(compute.effectiveLimit)}. A tool that reads the instruction\n` +
          `  rather than the header reports the wrong figure here.`,
      ),
    );
  }

  if (analysis.tips.length > 0) {
    out.push('', pc.bold('Tips'));
    out.push(
      renderTable(
        [
          { header: 'recipient' },
          { header: 'service' },
          { header: 'lamports', align: 'right' },
          { header: 'via' },
        ],
        analysis.tips.map((tip) => [
          shorten(tip.recipient),
          tip.service ?? pc.yellow('not in registry'),
          formatInteger(tip.lamports),
          tip.via,
        ]),
        { dim: pc.dim },
      )
        .split('\n')
        .map((row) => `  ${row}`)
        .join('\n'),
    );
  }

  return out.join('\n');
}

function renderAggregate(analysis: CostAggregate): string[] {
  const out: string[] = [];
  const versionOrder = (version: string): number => (version === 'legacy' ? -1 : Number(version));
  const versions = Object.entries(analysis.versionCounts)
    .sort(([a], [b]) => versionOrder(a) - versionOrder(b))
    .map(([version, count]) => `${version === 'legacy' ? 'legacy' : `v${version}`} ${count}`)
    .join('   ');

  out.push(field('transactions', formatInteger(analysis.transactionCount)));
  out.push(
    field(
      'outcome',
      `${pc.green(`${formatInteger(analysis.succeeded)} succeeded`)}   ${pc.red(`${formatInteger(analysis.failed)} failed`)}`,
    ),
  );
  out.push(field('versions', versions));
  out.push(
    field(
      'fee expressed as',
      `v1 header ${analysis.feeSources.v1Header}   price per unit ${analysis.feeSources.computeUnitPrice}   none ${analysis.feeSources.none}`,
    ),
  );

  out.push('', pc.bold('Cost'));
  out.push(field('fees charged', `${formatSol(analysis.totalFeeLamports, 6).padStart(14)} SOL`));
  out.push(
    field('of that, priority', `${formatSol(analysis.totalPriorityLamports, 6).padStart(14)} SOL`),
  );
  out.push(
    field(
      'tips',
      `${formatSol(analysis.totalTipLamports, 6).padStart(14)} SOL`,
      `across ${formatInteger(analysis.tipPayingTransactions)} transaction(s)`,
    ),
  );
  out.push(
    field(
      'overpaid compute',
      `${formatSol(analysis.totalOverpaidLamports, 6).padStart(14)} SOL`,
      'recoverable by fitting the limit to what is used',
    ),
  );

  out.push('', pc.bold('Compute'));
  out.push(field('budgeted', `${formatInteger(analysis.totalComputeBudgeted).padStart(14)} units`));
  out.push(field('consumed', `${formatInteger(analysis.totalComputeConsumed).padStart(14)} units`));
  out.push(
    field(
      'unused',
      formatPercent(analysis.computeWastedFraction).padStart(14),
      'of what was budgeted',
    ),
  );

  out.push(
    '',
    pc.bold('Priority fee per transaction'),
    pc.dim('  lamports, over transactions that paid one'),
  );
  out.push(percentileRows(analysis.priorityLamportsPercentiles, (v) => formatInteger(v)));

  out.push(
    '',
    pc.bold('Priority fee per compute unit consumed'),
    pc.dim('  micro-lamports, the figure that is comparable between transactions'),
  );
  out.push(percentileRows(analysis.priorityPerComputeUnitPercentiles, (v) => formatInteger(v)));

  const exact = analysis.transactionCount - analysis.modelMismatches;
  out.push('', pc.bold('Model self-check'));
  out.push(
    analysis.modelMismatches === 0
      ? `  ${pc.green(`${formatInteger(exact)}/${formatInteger(analysis.transactionCount)}`)} transactions reproduced exactly from their own directives.`
      : `  ${pc.yellow(`${formatInteger(exact)}/${formatInteger(analysis.transactionCount)}`)} reproduced exactly; ${formatInteger(analysis.modelMismatches)} did not. The fee model is incomplete.`,
  );

  return out;
}

function renderTopTable(analysis: CostAggregate, topCount: number): string[] {
  if (topCount <= 0 || analysis.transactions.length === 0) return [];

  const top = [...analysis.transactions]
    .sort((a, b) =>
      a.fee.totalCostLamports < b.fee.totalCostLamports
        ? 1
        : a.fee.totalCostLamports > b.fee.totalCostLamports
          ? -1
          : 0,
    )
    .slice(0, topCount);

  const table = renderTable(
    [
      { header: 'signature' },
      { header: 'ver' },
      { header: 'fee', align: 'right' },
      { header: 'tip', align: 'right' },
      { header: 'total', align: 'right' },
      { header: 'cu used', align: 'right' },
      { header: 'ok' },
    ],
    top.map((tx) => [
      shorten(tx.signature, 7),
      formatVersion(tx.version),
      formatInteger(tx.fee.observedFeeLamports),
      formatInteger(tx.fee.tipLamports),
      formatInteger(tx.fee.totalCostLamports),
      tx.compute.consumed === null ? '-' : formatInteger(tx.compute.consumed),
      tx.succeeded ? pc.green('y') : pc.red('n'),
    ]),
    { dim: pc.dim },
  );

  return [
    '',
    pc.bold(`Highest total cost to land (top ${top.length})`),
    table
      .split('\n')
      .map((row) => `  ${row}`)
      .join('\n'),
  ];
}

const LANDED_ONLY_NOTE = pc.dim(
  '  Note: these are the transactions that landed. The ones that were dropped are not\n' +
    '  visible here, so a percentile shows what was sufficient, not what was required.',
);

export function renderSlot(analysis: SlotAnalysis, topCount: number): string {
  return [
    pc.bold(`Slot ${formatSlot(analysis.slot)}`),
    ...renderAggregate(analysis),
    ...renderTopTable(analysis, topCount),
    '',
    LANDED_ONLY_NOTE,
  ].join('\n');
}

export function renderAccount(analysis: AccountAnalysis, topCount: number): string {
  return [
    pc.bold(`Account ${analysis.address}`),
    field('signatures', formatInteger(analysis.signaturesInspected), 'newest first'),
    ...renderAggregate(analysis),
    ...renderTopTable(analysis, topCount),
    '',
    LANDED_ONLY_NOTE,
  ].join('\n');
}
