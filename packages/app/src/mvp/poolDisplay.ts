// Pool display config — the ONE place to tweak how the LFG pools look (names, taglines, dot colors, icons).
// Edit freely over time; the run-type IDS (the keys) are the stable backend contract (`runTypes.ts`), only
// the PRESENTATION lives here. The backend `RUN_TYPE_CONFIG.label` is the server-side name used in the
// social-contract text — keep these names roughly in sync if you rename a pool.
//
// `icon` is the inner SVG markup of a 24×24 stroke icon (Lucide), rendered with stroke=currentColor so it
// picks up the pool color. Swap in any path string to change an icon.

import type { RunType } from './lfg.js';

export interface PoolDisplay {
  /** User-facing pool name. */
  name: string;
  /** One-line description shown under the name in the pool chooser. */
  tagline: string;
  /** Identifying color — the pool dot + icon tint. */
  color: string;
  /** Inner SVG of a 24×24 Lucide stroke icon. */
  icon: string;
  /** The checklist of expectations shown when you hover a pool card. CURATE THESE per pool over time. */
  expectations: string[];
}

const ICON = {
  // package / vault
  vault:
    '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  // hourglass
  timer:
    '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
  // flag
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  // cpu / circuit (techie)
  cpu: '<path d="M12 20v2"/><path d="M12 2v2"/><path d="M17 20v2"/><path d="M17 2v2"/><path d="M2 12h2"/><path d="M2 17h2"/><path d="M2 7h2"/><path d="M20 12h2"/><path d="M20 17h2"/><path d="M20 7h2"/><path d="M7 20v2"/><path d="M7 2v2"/><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
};

export const POOL_DISPLAY: Record<RunType, PoolDisplay> = {
  'growth-vault': {
    name: 'Growth Vault',
    tagline: 'Weekly vault & great rewards',
    color: '#8fd6a6',
    icon: ICON.vault,
    expectations: [
      'Relaxed pace — completion over the timer',
      'Everyone is here for vault / gear progress',
      'Be patient with lower-geared players',
      'Friendly comms, no pressure',
    ],
  },
  'timed-completion': {
    name: 'Timed Completion',
    tagline: 'Beat the timer, get it done',
    color: '#7dafff',
    icon: ICON.timer,
    expectations: [
      'Goal is to beat the dungeon timer',
      'Know your route and interrupt assignments',
      'Bring food, pots, and a healthstone',
      'Keep the pace — minimal AFKs',
    ],
  },
  'progression-push': {
    name: 'Progression Push',
    tagline: 'Push keys & chase rating',
    color: '#ff8f6b',
    icon: ICON.flag,
    expectations: [
      'Pushing high keys and rating',
      'Tight execution — mechanics matter',
      'Full consumables and gear expected',
      'Voice comms recommended',
    ],
  },
  'route-lab': {
    name: 'Tech Lab',
    tagline: 'Test routes & optimize runs',
    color: '#d6a6ff',
    icon: ICON.cpu,
    expectations: [
      'Experimental routes and pull testing',
      'Expect wipes while we figure it out',
      'Share feedback on what worked',
      'Patience for trying new strats',
    ],
  },
};

/** The user-facing pool name (display source of truth for the Groups UI). */
export function poolName(t: RunType): string {
  return POOL_DISPLAY[t]?.name ?? t;
}
