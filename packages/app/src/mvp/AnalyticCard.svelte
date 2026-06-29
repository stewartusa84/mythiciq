<!-- Titled card around a generic analytic value (MetricView), for tabs without a bespoke panel yet. -->
<script lang="ts">
  import type { RunReport } from '@wow/engine';
  import MetricView from './MetricView.svelte';
  import { analytic } from './report.js';

  let { report, id, title }: { report: RunReport; id: string; title?: string } = $props();
  let result = $derived(report.overall.find((a) => a.id === id) ?? null);
  let value = $derived(analytic<unknown>(report, id));
</script>

{#if result}
  <section class="card">
    <h2>{title ?? result.title}</h2>
    <MetricView {value} />
  </section>
{/if}
