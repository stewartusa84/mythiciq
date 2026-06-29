// Role ordering for the replay (tank → healer → dps). Icons on the player card are now SPEC icons
// (see specVisuals.ts); role is kept only as the sort key. Re-exports the engine PlayerRole type.
import type { PlayerRole } from '@wow/engine';
export type { PlayerRole };

export const ROLE_ORDER: Record<PlayerRole, number> = { tank: 0, healer: 1, dps: 2 };
/** Sort key: tank first, then healer, then dps; unknown role → after dps. */
export function roleRank(role: PlayerRole | undefined): number {
  return role ? ROLE_ORDER[role] : 3;
}
