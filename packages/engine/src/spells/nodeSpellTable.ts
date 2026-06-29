// Node-only loader: read the generated mechanics bundle from @wow/data and build the unified
// SpellTable. Browser code instead imports the bundle JSON (or fetches it) and calls tableFromBundle
// / loadMechanics. The bundle is produced by @wow/data scripts/build-mechanics.mjs.
import { readFile } from 'node:fs/promises';
import { mechanicsPath } from '@wow/data';
import type { SpellTable } from './spellTable.js';
import { tableFromBundle, type MechanicsBundle } from './mechanics.js';

export async function loadSpellTable(): Promise<SpellTable> {
  const bundle = JSON.parse(await readFile(mechanicsPath, 'utf8')) as MechanicsBundle;
  return tableFromBundle(bundle);
}
