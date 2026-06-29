// Node-side entry: resolves the on-disk path to the compiled WASM artifact so the
// engine's tests/bench can read it with fs. Browser/Vite consumers should instead
// import the artifact URL directly:
//
//   import wasmUrl from '@wow/parser-core/pkg/parser_core.wasm?url';
//
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute filesystem path to the compiled parser-core WASM. */
export const wasmPath = join(here, 'pkg', 'parser_core.wasm');
