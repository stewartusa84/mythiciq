/** Rebuild generated/mechanics.json from the source files; returns the new content-hash
 *  version and a summary of counts. Safe to call in-process (the backend uses it after promotion).
 *  Pass `{ write: false }` to validate and compute the bundle without touching generated output. */
export function buildMechanics(options?: { write?: boolean }): Promise<{
  version: string;
  counts: {
    seedSpells: number;
    categories: number;
    removers: number;
    debuffs: number;
    facts: number;
    enemyDungeons: number;
    cards: number;
    cardFiles: number;
  };
}>;
