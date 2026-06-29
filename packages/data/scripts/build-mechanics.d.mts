/** Rebuild generated/mechanics.json from the six source files; returns the new content-hash
 *  version and a summary of counts. Safe to call in-process (the backend uses it after promotion). */
export function buildMechanics(): Promise<{
  version: string;
  counts: {
    seedSpells: number;
    categories: number;
    removers: number;
    debuffs: number;
    facts: number;
  };
}>;
