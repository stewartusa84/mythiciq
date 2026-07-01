<!-- Enemies tab: damage taken grouped by enemy npc type — the biggest threats to the party. -->
<script lang="ts">
  import type { RunReport, DamageTakenByEnemyResult } from '@wow/engine';
  import DamageByEnemy from '../DamageByEnemy.svelte';
  import { analytic } from '../report.js';

  let { report }: { report: RunReport } = $props();
  let result = $derived(analytic<DamageTakenByEnemyResult>(report, 'damageTaken.byEnemy'));
</script>

<DamageByEnemy {result} />
