// Pull the live/admin-approved mechanics library from the backend and write repo-shaped mechanic-card
// source files under packages/data/curation/mechanics/. This keeps git as a snapshot/export of the AWS
// live library, not the publication mechanism.
//
// Usage:
//   pnpm --filter @wow/data run sync:mechanics -- https://api.example.com/api/mechanics/source-export
//   MECHANICS_SOURCE_EXPORT_URL=https://.../api/mechanics/source-export pnpm --filter @wow/data run sync:mechanics
//   pnpm --filter @wow/data run sync:mechanics -- --dry-run https://...

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const cardsDir = join(root, 'curation', 'mechanics');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const urlArg = args.find((a) => a !== '--dry-run');
const sourceUrl = urlArg ?? process.env.MECHANICS_SOURCE_EXPORT_URL;

function fail(message) {
  console.error(`sync-mechanics-source: ${message}`);
  process.exit(1);
}

function safeRelativeJsonPath(path) {
  if (typeof path !== 'string' || !path.endsWith('.json')) fail(`bad export path: ${String(path)}`);
  const normalized = normalize(path).replaceAll('\\', '/');
  if (normalized.startsWith('../') || normalized.includes('/../') || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    fail(`unsafe export path: ${path}`);
  }
  return normalized;
}

function validateExport(value) {
  if (!value || typeof value !== 'object') fail('export response is not an object');
  if (value.schemaVersion !== 1) fail(`unsupported schemaVersion: ${String(value.schemaVersion)}`);
  if (!Array.isArray(value.files)) fail('export response has no files[]');
  return value;
}

if (!sourceUrl) {
  fail('pass an export URL or set MECHANICS_SOURCE_EXPORT_URL');
}

const res = await fetch(sourceUrl);
if (!res.ok) fail(`fetch failed: HTTP ${res.status}`);
const exportData = validateExport(await res.json());

let cards = 0;
for (const file of exportData.files) {
  const rel = safeRelativeJsonPath(file.path);
  if (!file.content || typeof file.content !== 'object' || !file.content._meta || !file.content.cards) {
    fail(`bad file payload for ${rel}`);
  }
  const outPath = join(cardsDir, rel);
  const text = JSON.stringify(file.content, null, 2) + '\n';
  cards += Object.keys(file.content.cards).length;
  if (dryRun) {
    console.log(`would write ${rel} (${Object.keys(file.content.cards).length} cards)`);
  } else {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, text);
    console.log(`wrote ${rel} (${Object.keys(file.content.cards).length} cards)`);
  }
}

console.log(
  `sync-mechanics-source: ${dryRun ? 'dry-run ' : ''}${exportData.files.length} files / ${cards} cards from bundle ${exportData.bundleVersion}`,
);
