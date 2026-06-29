// Phase-by-phase benchmark runner (Node).
//
//   pnpm bench                 # synthetic ~1.5M-line log
//   pnpm bench -- <file.txt>   # a real exported combat log
//   pnpm bench -- --lines 3000000
//
// Prints ms per phase: read, alloc+copy, wasmParse, buildViews, segment, analytics.
import { readFile } from 'node:fs/promises';
import { Bench } from './harness.js';
import { generateLog } from './genLog.js';
import { loadWasmBytes } from '../wasm/nodeWasm.js';
import { instantiateParser } from '../wasm/loader.js';
import { ColumnStore } from '../columns/columnStore.js';
import { segment } from '../segments/segmenter.js';
import { createRegistry, buildSummary } from '../pipeline.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fileArg = args.find((a) => !a.startsWith('--'));
  const linesArg = args.indexOf('--lines');
  const targetLines = linesArg >= 0 ? Number(args[linesArg + 1]) : 1_500_000;

  const bench = new Bench();

  const logBytes = await bench.phaseAsync('fileRead', async () => {
    if (fileArg) return new Uint8Array(await readFile(fileArg));
    return generateLog(targetLines);
  });

  const wasmBytes = await loadWasmBytes();
  const wasm = await bench.phaseAsync('wasmInstantiate', () => instantiateParser(wasmBytes));

  const len = logBytes.byteLength;
  const ptr = bench.phase('alloc+copy', () => {
    const p = wasm.alloc(len);
    new Uint8Array(wasm.memory.buffer, p, len).set(logBytes);
    return p;
  });

  const count = bench.phase('wasmParse', () => wasm.parse(ptr, len));

  const store = bench.phase('buildViews+intern', () => new ColumnStore(wasm));
  wasm.dealloc(ptr, len);

  const segments = bench.phase('segment', () => segment(store));

  const registry = createRegistry();
  bench.phase('analytics(summary)', () =>
    buildSummary({ wasm, store, segments }, registry),
  );

  bench.report({ bytes: len, events: count });
  // eslint-disable-next-line no-console
  console.log(
    `events=${count.toLocaleString()}  segments=${segments.length}  ` +
      `actors=${store.actorIds().length}`,
  );
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
