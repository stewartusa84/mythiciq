<!-- Spec icon (Wowhead/zamimg) for a player's specId, tinted with the class color. Falls back to a
     class-colored dot when there's no specId/icon or the image fails to load. -->
<script lang="ts">
  import { specIconUrl, classColorOf, classNameOf, specNameOf } from './specVisuals.js';

  let { specId }: { specId: number | undefined } = $props();
  let url = $derived(specIconUrl(specId));
  let color = $derived(classColorOf(specId) ?? '#8b95a4');
  let label = $derived([specNameOf(specId), classNameOf(specId)].filter(Boolean).join(' '));
  let failed = $state(false);
</script>

{#if url && !failed}
  <img class="specicon" src={url} alt={label} title={label} style="--cc:{color}" onerror={() => (failed = true)} />
{:else}
  <span class="specicon dot" title={label || 'unknown spec'} style="--cc:{color}"></span>
{/if}

<style>
  .specicon {
    width: 18px; height: 18px; flex: none; vertical-align: middle; display: inline-block;
    border-radius: 4px; box-shadow: 0 0 0 1px var(--cc);
  }
  .specicon.dot { background: color-mix(in srgb, var(--cc) 35%, transparent); }
</style>
