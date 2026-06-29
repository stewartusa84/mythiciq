// GCD length from a player's haste rating (COMBATANT_INFO). The combat log gives a haste RATING, not a
// percent, so we convert with a per-level coefficient. This is intentionally approximate — it ignores
// haste from buffs/talents (except Bloodlust/Heroism, handled by the caller passing `lust`) and the
// rating→percent coefficient shifts by level/expansion. It's a pressure-metric input, not ground truth.

/** Haste rating per 1% haste at the current level cap. APPROXIMATE + tunable — combat-rating
 *  coefficients change by level/expansion; refine when a Midnight value is confirmed. The GCD is only
 *  mildly sensitive to this (small haste% ⇒ GCD stays near the 1.5s base). */
export const HASTE_RATING_PER_PERCENT = 330;

/** The in-game GCD floor: haste can shorten the 1.5s base GCD only down to 0.75s. */
export const GCD_FLOOR_MS = 750;
/** Unhasted base GCD. */
export const GCD_BASE_MS = 1500;
/** Bloodlust/Heroism family haste bonus (multiplicative on 1+haste). */
export const LUST_HASTE_MULT = 1.3;

/** Haste fraction (0.05 = 5%) from a rating. */
export function hastePercentFromRating(rating: number): number {
  if (!(rating > 0)) return 0;
  return rating / HASTE_RATING_PER_PERCENT / 100;
}

/** GCD length (ms) for a player with the given haste rating, optionally inside a lust window.
 *  `GCD = 1.5s / ((1 + haste%) * lust)`, clamped to the [floor, base] range. */
export function gcdMsFromHaste(rating: number, opts: { lust?: boolean } = {}): number {
  const mult = (1 + hastePercentFromRating(rating)) * (opts.lust ? LUST_HASTE_MULT : 1);
  const gcd = GCD_BASE_MS / mult;
  return Math.max(GCD_FLOOR_MS, Math.min(GCD_BASE_MS, gcd));
}
