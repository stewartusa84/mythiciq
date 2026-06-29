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

declare module '@wow/data/curation/mechanic-advice' {
  interface MechanicAdviceText {
    generic?: string;
    tank?: string;
    healer?: string;
    dps?: string;
  }
  interface MechanicAdviceEntry {
    spellId: number;
    name?: string;
    dungeon?: string;
    category?: string;
    advice?: MechanicAdviceText;
    tags?: string[];
    confidence?: string;
    basis?: string;
  }
  const data: {
    schemaVersion?: number;
    generatedAt?: string;
    purpose?: string;
    roles?: string[];
    mechanics?: MechanicAdviceEntry[];
  };
  export default data;
}
