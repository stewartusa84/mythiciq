import type { Analytic, AnalyticContext, AnalyticResult, Role } from './types.js';

/**
 * Pluggable analytics registry. Register modules at startup; run them over a parsed
 * store. New metrics never require parser changes — they only need the columns they
 * declare to exist.
 */
export class AnalyticsRegistry {
  private readonly byId = new Map<string, Analytic>();

  register(a: Analytic): this {
    if (this.byId.has(a.id)) throw new Error(`duplicate analytic id: ${a.id}`);
    this.byId.set(a.id, a);
    return this;
  }

  registerAll(list: Iterable<Analytic>): this {
    for (const a of list) this.register(a);
    return this;
  }

  get(id: string): Analytic | undefined {
    return this.byId.get(id);
  }

  all(): Analytic[] {
    return [...this.byId.values()];
  }

  byRole(role: Role): Analytic[] {
    return this.all().filter((a) => a.role === role);
  }

  /** Analytics flagged for the fast summary report. */
  summaryAnalytics(): Analytic[] {
    return this.all().filter((a) => a.summary);
  }

  /** Run a specific subset (or all) analytics and collect their results. */
  run(ctx: AnalyticContext, which?: Iterable<Analytic>): AnalyticResult[] {
    const list = which ? [...which] : this.all();
    const out: AnalyticResult[] = [];
    for (const a of list) {
      out.push({ id: a.id, title: a.title, role: a.role, value: a.run(ctx) });
    }
    return out;
  }
}
