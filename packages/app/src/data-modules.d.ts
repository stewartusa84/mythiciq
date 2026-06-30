// Ambient shape for the generated preset library JSON imported via the @wow/data package export.
// Vite imports the real JSON at build time; svelte-check just needs the type.
declare module '@wow/data/metric-presets' {
  import type { MetricPresetLibrary } from '@wow/engine';
  const lib: MetricPresetLibrary;
  export default lib;
}

// Curated positive messages + select ESV Scripture rotated on the topbar.
declare module '@wow/data/curation/positive-messages' {
  interface PositiveMessage {
    kind: 'verse' | 'affirmation';
    text: string;
    ref?: string;
  }
  const data: { _meta?: Record<string, string>; messages: PositiveMessage[] };
  export default data;
}

declare module '@wow/data/curation/affixes' {
  interface AffixEntry {
    name: string;
    keyLevels?: string;
    meaning?: string;
  }
  const data: { _meta?: Record<string, string>; [id: string]: AffixEntry | Record<string, string> | undefined };
  export default data;
}

// The served mechanics bundle (Vite imports the real generated JSON; svelte-check just needs the
// shape). Consolidated mechanic CARDS live in bundle.cards. Typed via the engine's MechanicsBundle.
declare module '@wow/data/mechanics' {
  import type { MechanicsBundle } from '@wow/engine';
  const bundle: MechanicsBundle;
  export default bundle;
}
