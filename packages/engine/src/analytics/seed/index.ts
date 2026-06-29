import type { Analytic } from '../types.js';
import { deaths } from './deaths.js';
import { damageDone, damageBreakdown, priorityTargetDamage } from './damage.js';
import { healingDone, externalCooldowns } from './healing.js';
import { interrupts, dispels } from './interrupts.js';
import { damageTaken } from './damageTaken.js';
import { sharedStubs, tankStubs } from './stubs.js';
import { hpTimeline } from './hpTimelineAnalytic.js';
import { healResponse } from './healResponse.js';
import { recovery } from './recovery.js';
import { tankMelee } from './tankMitigation.js';
import { interruptsPriority, dispelsPriority } from './priorityActions.js';
import { interruptAccountability } from './interruptAccountability.js';
import { clutchPlays } from './clutchPlays.js';
import { removal } from './removal.js';
import { avoidableDamage } from './avoidableDamage.js';
import { deathRecap } from './deathRecap.js';

/**
 * The seed analytics set the registry is built around. Real computations where the
 * columns suffice; honest, role-tagged stubs where a reference table is still needed.
 * Add new metrics by appending here — the parser never changes.
 */
export const seedAnalytics: Analytic[] = [
  // all roles
  deaths,
  deathRecap,
  damageTaken,
  interrupts,
  interruptsPriority,
  avoidableDamage,
  clutchPlays,
  ...sharedStubs,
  // dps
  damageDone,
  damageBreakdown,
  priorityTargetDamage,
  interruptAccountability,
  // healer
  healingDone,
  dispels,
  externalCooldowns,
  healResponse,
  recovery,
  dispelsPriority,
  removal,
  // tank
  tankMelee,
  ...tankStubs,
  // derived primitives (registry face)
  hpTimeline,
];

export { deaths } from './deaths.js';
export { damageDone, damageBreakdown, priorityTargetDamage } from './damage.js';
export { healingDone, externalCooldowns } from './healing.js';
export { interrupts, dispels } from './interrupts.js';
export { damageTaken } from './damageTaken.js';
