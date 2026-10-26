#!/usr/bin/env node
/**
 * The fee-lens command line interface.
 *
 * Three views over the same model: one transaction, one slot, or one account's
 * recent history. Every command takes `--json` and prints the full analysis, so
 * the tool composes with anything that reads JSON rather than only being
 * readable by a person.
 */

import { Command, Option } from 'commander';
import { analyseAccount } from '../analyze/account.js';
import { analyseSlot } from '../analyze/slot.js';
import { type AnalyseOptions, analyseTransaction } from '../analyze/transaction.js';
import { tipAccountIndex } from '../registry/tip-accounts.js';
import { FeeLensRpc } from '../rpc/client.js';
import { mapWithConcurrency } from './concurrency.js';
import { jsonReplacer } from './format.js';
import { renderAccount, renderSlot, renderTransaction } from './render.js';

const PUBLIC_RPC = 'https://api.mainnet-beta.solana.com';

/** Concurrent transaction fetches. Kept low by default: public endpoints rate limit hard. */
const DEFAULT_CONCURRENCY = 2;

interface GlobalOptions {
  readonly rpc?: string;
  readonly json?: boolean;
  readonly tipAccount?: string[];
  readonly knownTipsOnly?: boolean;
}

function resolveRpcUrl(options: GlobalOptions): string {
  return options.rpc ?? process.env.SOLANA_RPC_URL ?? PUBLIC_RPC;
}

function emit(value: unknown, rendered: () => string, options: GlobalOptions): void {
  process.stdout.write(
    options.json === true ? `${JSON.stringify(value, jsonReplacer, 2)}\n` : `${rendered()}\n`,
  );
}

function analyseOptions(options: GlobalOptions): AnalyseOptions {
  return {
    tipAccounts: tipAccountIndex(options.tipAccount ?? []),
    knownRecipientsOnly: options.knownTipsOnly === true,
  };
}

const program = new Command();

program
  .name('fee-lens')
  .description(
    'Work out what a Solana transaction actually paid to land: base fee, priority fee\n' +
      'and tips, correct across legacy, v0 and v1 transactions.',
  )
  .version('0.1.0')
  .option('--rpc <url>', `JSON-RPC endpoint (default: $SOLANA_RPC_URL, else ${PUBLIC_RPC})`)
  .option('--json', 'print the full analysis as JSON')
  .addOption(
    new Option(
      '--tip-account <entry...>',
      'name additional tip accounts: ADDRESS or ADDRESS=LABEL, repeatable',
    ),
  )
  .option(
    '--known-tips-only',
    'count only payments to registry recipients, not unlabelled outbound transfers',
  );

program
  .command('tx')
  .description('break down the cost of one transaction')
  .argument('<signature>', 'transaction signature, base58')
  .action(async (signature: string) => {
    const options = program.opts<GlobalOptions>();
    const rpc = new FeeLensRpc({ url: resolveRpcUrl(options) });
    const transaction = await rpc.getTransaction(signature);
    const analysis = analyseTransaction(transaction, analyseOptions(options));
    emit(analysis, () => renderTransaction(analysis), options);
  });

program
  .command('slot')
  .description('what it cost to be in one block')
  .argument('[slot]', 'slot number; defaults to the most recent confirmed slot')
  .option('--top <n>', 'show the n most expensive transactions', '10')
  .action(async (slotArgument: string | undefined, commandOptions: { top: string }) => {
    const options = program.opts<GlobalOptions>();
    const rpc = new FeeLensRpc({ url: resolveRpcUrl(options) });

    const slot = slotArgument === undefined ? await rpc.getSlot() : BigInt(slotArgument);
    const block = await rpc.getBlock(slot);
    const analysis = analyseSlot(block, analyseOptions(options));
    emit(analysis, () => renderSlot(analysis, Number.parseInt(commandOptions.top, 10)), options);
  });

program
  .command('account')
  .description('what an account has been paying across its recent transactions')
  .argument('<address>', 'any account address, base58')
  .option('--limit <n>', 'how many recent transactions to inspect', '25')
  .option('--top <n>', 'show the n most expensive transactions', '10')
  .option(
    '--concurrency <n>',
    'transactions to fetch at once; lower it if the endpoint rate limits',
    String(DEFAULT_CONCURRENCY),
  )
  .action(
    async (
      addressArgument: string,
      commandOptions: { limit: string; top: string; concurrency: string },
    ) => {
      const options = program.opts<GlobalOptions>();
      const rpc = new FeeLensRpc({ url: resolveRpcUrl(options) });

      const limit = Number.parseInt(commandOptions.limit, 10);
      if (!Number.isFinite(limit) || limit <= 0)
        throw new Error('--limit must be a positive integer');

      const concurrency = Math.max(1, Number.parseInt(commandOptions.concurrency, 10) || 1);
      const signatures = await rpc.getSignatures(addressArgument, limit);
      const transactions = await mapWithConcurrency(signatures, concurrency, (signature) =>
        rpc.getTransaction(signature),
      );

      const analysis = analyseAccount(
        { address: addressArgument, signaturesInspected: signatures.length, transactions },
        analyseOptions(options),
      );
      emit(
        analysis,
        () => renderAccount(analysis, Number.parseInt(commandOptions.top, 10)),
        options,
      );
    },
  );

try {
  await program.parseAsync(process.argv);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
