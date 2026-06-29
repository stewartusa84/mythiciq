// Spell lookup CLI: given a spell id, print how the unified SpellTable classifies it — removable
// (and by which removers), interruptible, avoidable, dispellable, dangerous-debuff, active-mitigation,
// defensive, or a remover itself. Reads the SAME generated mechanics bundle the analytics use, so the
// answers match runtime exactly (no digging through the raw DB2 CSVs).
//
//   pnpm --filter @wow/engine spell 1269286
//   pnpm --filter @wow/engine spell 1269286 1044 1262509   (multiple ids)
import { loadSpellTable } from '../src/spells/nodeSpellTable.js';
import type { SpellTable } from '../src/spells/spellTable.js';

function yn(b: boolean): string {
  return b ? '✓ yes' : '· no';
}

function report(table: SpellTable, id: number): void {
  const info = table.get(id);
  const debuff = table.debuff(id);
  const remover = table.remover(id);
  const name = info?.name ?? debuff?.name ?? remover?.name;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`spell ${id}${name ? `  —  ${name}` : ''}   (wowhead.com/spell=${id})`);
  console.log('='.repeat(60));

  if (!info && !debuff && !remover) {
    console.log('  NOT in the table (unknown spell — no seed / overlay / debuff / remover / DB2 fact).');
    console.log('  → would classify as "unknown" everywhere.');
    return;
  }

  // --- avoidable -------------------------------------------------------------------------------
  console.log(`  avoidable (stand-in-fire):   ${yn(table.isAvoidable(id))}`);

  // --- interruptible ---------------------------------------------------------------------------
  const ip = table.interruptPriority(id);
  console.log(`  interruptible:               ${ip ? `✓ yes (priority: ${ip})` : '· no'}`);

  // --- dispellable (school) ---------------------------------------------------------------------
  const dp = table.dispelPriority(id);
  console.log(`  dispellable (school):        ${dp ? `✓ yes (priority: ${dp}${info?.dispelType ? `, type: ${info.dispelType}` : ''})` : '· no'}`);

  // --- removable (the category-intersection model: schools AND mechanics) ----------------------
  const cats = table.removableCategoriesOf(id);
  if (cats.length) {
    console.log(`  removable categories:        ✓ [${cats.join(', ')}]`);
    const removers = table.removersForDebuff(id);
    if (removers.length) {
      console.log(`  → cleared by ${removers.length} remover(s):`);
      for (const rid of removers) {
        const r = table.remover(rid);
        const who = [r?.class, r?.spec].filter(Boolean).join(' ');
        console.log(`       ${String(rid).padStart(8)}  ${(r?.name ?? '?').padEnd(22)} provides [${[...(r?.providesSet ?? [])].join(', ')}]${who ? `  (${who})` : ''}`);
      }
    } else {
      console.log('  → but NO remover currently provides any of those categories (gap).');
    }
  } else {
    console.log('  removable categories:        · none');
  }

  // --- dangerous debuff entry ------------------------------------------------------------------
  if (debuff) {
    console.log(`  dangerous debuff:            ✓ yes (priority: ${debuff.priority ?? '?'})`);
    if (debuff.caster) console.log(`       caster: ${debuff.caster}`);
    if (info?.dungeon ?? debuff.dungeon) console.log(`       dungeon: ${info?.dungeon ?? debuff.dungeon}`);
    if (debuff.notes) console.log(`       notes: ${debuff.notes}`);
  }

  // --- is this spell itself a remover? ---------------------------------------------------------
  if (remover) {
    const who = [remover.class, remover.spec].filter(Boolean).join(' ');
    console.log(`  is a REMOVER:                ✓ yes — provides [${[...remover.providesSet].join(', ')}]${remover.scope ? `, scope: ${remover.scope}` : ''}${who ? ` (${who})` : ''}`);
    if (remover.notes) console.log(`       notes: ${remover.notes}`);
  }

  // --- misc table facts ------------------------------------------------------------------------
  const misc: string[] = [];
  if (info?.activeMitigation) misc.push('active-mitigation buff');
  if (info?.defensive) misc.push(`player defensive (${info.defensive.type}${info.defensive.cooldownSeconds ? `, ${info.defensive.cooldownSeconds}s CD` : ''})`);
  if (info?.isBoss) misc.push('boss ability');
  if (info?.durationSeconds) misc.push(`duration ${info.durationSeconds}s`);
  if (info?.maxStacks) misc.push(`max ${info.maxStacks} stacks`);
  if (info?.npcIds?.length) misc.push(`npc(s): ${info.npcIds.join(', ')}`);
  if (misc.length) console.log(`  also: ${misc.join(' · ')}`);
  if (info?.notes && info.notes !== debuff?.notes) console.log(`  overlay notes: ${info.notes}`);
}

async function main(): Promise<void> {
  const ids = process.argv.slice(2).map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length === 0) {
    console.error('usage: pnpm --filter @wow/engine spell <spellId> [spellId...]');
    process.exit(1);
  }
  const table = await loadSpellTable();
  for (const id of ids) report(table, id);
  console.log('');
}

void main();
