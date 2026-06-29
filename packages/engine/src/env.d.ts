// Ambient declarations for bundler-only import suffixes used in browser code
// (resolved by Vite at build time; tsc just needs the shape).
declare module '*?url' {
  const src: string;
  export default src;
}

// The mechanics bundle imported in the worker (Vite imports the real JSON; tsc just needs a shape).
declare module '@wow/data/mechanics' {
  import type { MechanicsBundle } from './spells/mechanics.js';
  const bundle: MechanicsBundle;
  export default bundle;
}

declare module '@wow/data/curation/clutch-abilities' {
  type ClutchKind = 'damage-reduction' | 'immunity' | 'death-prevent' | 'pull';
  interface ClutchAbilityEntry {
    name: string;
    kind: ClutchKind;
    detect: 'aura' | 'cast';
    class?: string;
    notes?: string;
  }
  const data: {
    _meta?: Record<string, string>;
    abilities?: Record<string, ClutchAbilityEntry>;
  };
  export default data;
}

// Vite injects import.meta.env at build time; tsc just needs the shape for the worker's config.
interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
