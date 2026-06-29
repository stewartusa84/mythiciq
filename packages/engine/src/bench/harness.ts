// Phase-by-phase benchmark harness. Wrap each phase in `bench.phase(name, fn)` to
// record wall-clock ms; `report()` prints a per-phase table plus throughput.

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

export interface PhaseTiming {
  name: string;
  ms: number;
}

export class Bench {
  private readonly timings: PhaseTiming[] = [];

  phase<T>(name: string, fn: () => T): T {
    const t0 = now();
    const result = fn();
    this.timings.push({ name, ms: now() - t0 });
    return result;
  }

  async phaseAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const t0 = now();
    const result = await fn();
    this.timings.push({ name, ms: now() - t0 });
    return result;
  }

  get totalMs(): number {
    return this.timings.reduce((a, t) => a + t.ms, 0);
  }

  phases(): readonly PhaseTiming[] {
    return this.timings;
  }

  report(meta: { bytes?: number; events?: number } = {}): void {
    const pad = Math.max(...this.timings.map((t) => t.name.length), 10);
    /* eslint-disable no-console */
    console.log('\n── benchmark ──────────────────────────────');
    for (const t of this.timings) {
      const pct = this.totalMs > 0 ? ((t.ms / this.totalMs) * 100).toFixed(1) : '0.0';
      console.log(`  ${t.name.padEnd(pad)}  ${t.ms.toFixed(1).padStart(9)} ms  ${pct.padStart(5)}%`);
    }
    console.log(`  ${'TOTAL'.padEnd(pad)}  ${this.totalMs.toFixed(1).padStart(9)} ms`);
    if (meta.bytes) {
      const mb = meta.bytes / (1024 * 1024);
      const mbps = mb / (this.totalMs / 1000);
      console.log(`  → ${mb.toFixed(1)} MB at ${mbps.toFixed(1)} MB/s`);
    }
    if (meta.events) {
      const eps = meta.events / (this.totalMs / 1000);
      console.log(`  → ${meta.events.toLocaleString()} events at ${(eps / 1e6).toFixed(2)} M events/s`);
    }
    console.log('───────────────────────────────────────────\n');
    /* eslint-enable no-console */
  }
}
