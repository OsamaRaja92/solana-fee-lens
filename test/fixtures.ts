/**
 * Fixture loader.
 *
 * Each file under `fixtures/` is a verbatim JSON-RPC response recorded from
 * mainnet: `tx-*.json` from `getTransaction`, `block-*.json` from `getBlock`
 * with the fields this tool never reads removed. They go through exactly the
 * same normalisation as a live response, so the tests exercise the real path and
 * need neither a network connection nor an RPC key.
 *
 * The assertion at the end of `load` is the test-side equivalent of the RPC
 * boundary: a recorded response is untyped JSON until something declares its
 * shape.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WireBlock, WireTransaction } from '../src/rpc/wire.js';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), 'utf8')) as T;
}

export function loadTransaction(name: string): WireTransaction {
  return load<WireTransaction>(name);
}

export function loadBlock(name: string): WireBlock {
  return load<WireBlock>(name);
}

/** The recorded block, and the slot it came from. */
export const RECORDED_BLOCK = { name: 'block-461358125', slot: 461_358_125n } as const;
