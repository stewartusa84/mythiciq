// Build parser-core to WASM and copy the artifact into ./pkg.
//
// Usage: node scripts/build-wasm.mjs [--debug]
// Requires: rustup target add wasm32-unknown-unknown
//
// Optional size pass: if `wasm-opt` (binaryen) is on PATH, we run it. It is not
// required — the build succeeds without it.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const crateDir = join(here, '..');
const pkgDir = join(crateDir, 'pkg');

const debug = process.argv.includes('--debug');
const profile = debug ? 'debug' : 'release';
const target = 'wasm32-unknown-unknown';

const cargoArgs = ['build', '--target', target];
if (!debug) cargoArgs.push('--release');

console.log(`[build-wasm] cargo ${cargoArgs.join(' ')}`);
execFileSync('cargo', cargoArgs, { cwd: crateDir, stdio: 'inherit' });

const artifact = join(crateDir, 'target', target, profile, 'parser_core.wasm');
if (!existsSync(artifact)) {
  console.error(`[build-wasm] expected artifact not found: ${artifact}`);
  process.exit(1);
}

mkdirSync(pkgDir, { recursive: true });
const out = join(pkgDir, 'parser_core.wasm');
copyFileSync(artifact, out);

// Best-effort size optimization via binaryen's wasm-opt, if available.
if (!debug) {
  const probe = spawnSync('wasm-opt', ['--version'], { stdio: 'ignore' });
  if (probe.status === 0) {
    console.log('[build-wasm] wasm-opt -O3');
    spawnSync('wasm-opt', ['-O3', out, '-o', out], { stdio: 'inherit' });
  }
}

const kb = (statSync(out).size / 1024).toFixed(1);
console.log(`[build-wasm] wrote ${out} (${kb} KB)`);
