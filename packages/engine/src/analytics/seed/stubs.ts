import type { Analytic } from '../types.js';

// Role-tagged seed analytics whose *shape* is fixed but whose computation needs
// reference tables (spell-id allowlists, ability classifications) that arrive with
// the ported field logic. They are registered now so the registry is complete and
// the UI can render their slots; each returns a `todo` marker until wired.

function stub(id: string, title: string, role: Analytic['role'], needs: string): Analytic<{ todo: string }> {
  return {
    id,
    title,
    role,
    columns: ['eventType', 'source', 'target', 'spell'],
    summary: false,
    run: () => ({ todo: needs }),
  };
}

// All roles
export const defensiveCooldowns = stub(
  'defensives',
  'Defensive Cooldown Usage',
  'all',
  'needs defensive-CD spell-id allowlist',
);
export const ccStops = stub(
  'ccStops',
  'CC / Stops',
  'all',
  'needs CC/stop spell-id classification (stun/incap/silence/root)',
);

// Tank
export const mitigationUptime = stub(
  'tank.mitigation',
  'Active Mitigation Uptime',
  'tank',
  'needs active-mitigation aura spell-id list per tank spec',
);
export const damageTakenSmoothing = stub(
  'tank.smoothing',
  'Damage-Taken Smoothing',
  'tank',
  'needs windowed variance over the damage-taken series (compute pass TBD)',
);
export const kiting = stub(
  'tank.kiting',
  'Kiting',
  'tank',
  'needs position/threat data (ADVANCED params + UNIT positions)',
);

export const tankStubs = [mitigationUptime, damageTakenSmoothing, kiting];
export const sharedStubs = [defensiveCooldowns, ccStops];
