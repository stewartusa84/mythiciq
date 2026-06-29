<!-- A Wowhead-decorated link (spell by default, or affix). tooltips.js iconizes/renames/colors it and
     attaches a hover tooltip; we trigger a re-scan whenever a valid id (re)renders. Falls back to a
     plain span when the id is missing/invalid so nothing ever links to a bogus page. -->
<script lang="ts">
  import { refreshWowhead } from './wowhead.js';

  let {
    id,
    name,
    kind = 'spell',
  }: { id: number | null | undefined; name?: string; kind?: 'spell' | 'affix' } = $props();

  let valid = $derived(typeof id === 'number' && id > 0);
  $effect(() => {
    id; // track id so a CHANGED (still-valid) id triggers a re-scan, not just the first valid render
    if (valid) refreshWowhead();
  });
</script>

{#if valid}
  <!-- Key on id: tooltips.js iconizes/renames a link once and won't re-process the same element when
       only its href changes, so reusing the <a> for a new spell shows the stale name. Recreating it on
       id change hands Wowhead a fresh, unprocessed link to decorate. -->
  {#key id}
    <a href="https://www.wowhead.com/{kind}={id}" target="_blank" rel="noreferrer">{name ?? `${kind} ${id}`}</a>
  {/key}
{:else}
  <span>{name ?? '—'}</span>
{/if}
