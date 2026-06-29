// Node-only helper: read the compiled parser-core WASM bytes from disk. Used by the
// fixture test and benchmark harness. Browser code loads the artifact via Vite's
// `?url` import instead (see parse.worker.ts).
import { readFile } from 'node:fs/promises';
import { wasmPath } from '@wow/parser-core';

export async function loadWasmBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const buf = await readFile(wasmPath);
  // Copy into an ArrayBuffer-backed view (fs returns a possibly-pooled Buffer typed
  // as ArrayBufferLike, which WebAssembly's BufferSource param rejects under TS 5.7+).
  const bytes = new Uint8Array(buf.byteLength);
  bytes.set(buf);
  return bytes;
}
