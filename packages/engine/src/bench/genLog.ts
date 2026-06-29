// Synthetic combat-log generator for benchmarking without a real 200MB file.
// Emits the non-advanced line format the skeleton parser understands. Not a
// correctness fixture (that lives in test/fixtures) — just realistic volume/shape.

const PLAYERS = [
  { guid: 'Player-1-0000001', name: 'Tankadin' },
  { guid: 'Player-1-0000002', name: 'Healpriest' },
  { guid: 'Player-1-0000003', name: 'Stabby' },
  { guid: 'Player-1-0000004', name: 'Pewpew' },
  { guid: 'Player-1-0000005', name: 'Boomy' },
];
const SPELLS = [
  { id: 100780, name: 'Tiger Palm' },
  { id: 1822, name: 'Rake' },
  { id: 589, name: 'Shadow Word: Pain' },
  { id: 116, name: 'Frostbolt' },
  { id: 8936, name: 'Regrowth' },
];

function ts(sec: number): string {
  const h = Math.floor(sec / 3600) % 24;
  const m = Math.floor(sec / 60) % 60;
  const s = Math.floor(sec) % 60;
  const ms = Math.floor((sec % 1) * 1000);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `6/6/2026 ${p2(h)}:${p2(m)}:${p2(s)}.${String(ms).padStart(3, '0')}-0500`;
}

/**
 * Generate ~`targetLines` lines of synthetic log. Returns UTF-8 bytes.
 * Mixes trash + a couple of ENCOUNTER_START/END boss pulls with deaths/heals/interrupts.
 */
export function generateLog(targetLines: number): Uint8Array {
  const out: string[] = [];
  let sec = 0;
  let line = 0;
  const npc = { guid: 'Creature-0-1-0001', name: 'Risen Ghoul' };
  const enemyFlags = '0xa48';
  const friendFlags = '0x511';

  const emit = (s: string) => {
    out.push(s);
    line++;
  };

  let pull = 0;
  while (line < targetLines) {
    // Occasionally start a boss encounter.
    const boss = pull % 400 === 399;
    if (boss) {
      emit(`${ts(sec)}  ENCOUNTER_START,1234,"Test Boss",8,5,2000`);
    }
    const burst = boss ? 300 : 40;
    for (let k = 0; k < burst && line < targetLines; k++) {
      sec += 0.05;
      const p = PLAYERS[k % PLAYERS.length]!;
      const sp = SPELLS[k % SPELLS.length]!;
      const amt = 1000 + ((k * 137) % 9000);
      // player damages npc
      emit(
        `${ts(sec)}  SPELL_DAMAGE,${p.guid},"${p.name}",${friendFlags},0x0,${npc.guid},"${npc.name}",${enemyFlags},0x0,${sp.id},"${sp.name}",0x1,${amt},0,1,0,0,0,nil,nil,nil`,
      );
      if (k % 7 === 0) {
        // healer heals a player
        const h = PLAYERS[1]!;
        emit(
          `${ts(sec)}  SPELL_HEAL,${h.guid},"${h.name}",${friendFlags},0x0,${p.guid},"${p.name}",${friendFlags},0x0,8936,"Regrowth",0x8,${amt},0,0,nil`,
        );
      }
      if (k % 23 === 0) {
        // npc damages a player
        emit(
          `${ts(sec)}  SPELL_DAMAGE,${npc.guid},"${npc.name}",${enemyFlags},0x0,${p.guid},"${p.name}",${friendFlags},0x0,9999,"Ghoul Strike",0x1,${3000 + (k % 5000)},0,1,0,0,0,nil,nil,nil`,
        );
      }
      if (k % 31 === 0) {
        emit(
          `${ts(sec)}  SPELL_INTERRUPT,${PLAYERS[2]!.guid},"${PLAYERS[2]!.name}",${friendFlags},0x0,${npc.guid},"${npc.name}",${enemyFlags},0x0,116705,"Spear Hand Strike",0x1,9999,"Casted Spell",0x1`,
        );
      }
      if (boss && k === burst - 5) {
        emit(
          `${ts(sec)}  UNIT_DIED,0000000000000000,nil,0x0,0x0,${PLAYERS[4]!.guid},"${PLAYERS[4]!.name}",${friendFlags},0x0`,
        );
      }
    }
    if (boss) {
      emit(`${ts(sec)}  ENCOUNTER_END,1234,"Test Boss",8,5,1`);
      sec += 8; // gap before next trash pack
    } else {
      sec += 6; // combat gap between trash packs
    }
    pull++;
  }

  return new TextEncoder().encode(out.join('\n') + '\n');
}
