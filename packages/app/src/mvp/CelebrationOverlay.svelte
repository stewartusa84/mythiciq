<script lang="ts">
  let {
    kind,
    stars = 0,
    label = '',
  }: {
    kind: 'timed' | 'pb' | 'kill';
    stars?: number;
    label?: string;
  } = $props();
</script>

<div class="celebrate" aria-hidden="true">
  <div class="cbackdrop" class:pb={kind === 'pb'}></div>
  <div class="burst" class:pb={kind === 'pb'}>
    <div class="boom" class:pb={kind === 'pb'}>{kind === 'pb' ? 'Personal Best!' : kind === 'kill' ? 'Kill!' : 'Timed!'}</div>
    {#if label}<div class="csub">{label}</div>{/if}
    {#if stars > 0}<div class="cstars">{'★'.repeat(stars)}</div>{/if}
  </div>
</div>

<style>
  /* Site-level celebration overlay. It is mounted by App.svelte, outside the clipped analysis sidebar,
     so the message always fills the full viewport. */
  .celebrate {
    position: fixed; inset: 0; z-index: 1200; pointer-events: none;
    display: flex; align-items: center; justify-content: center;
  }
  .cbackdrop {
    position: absolute; inset: 0; background: rgba(5, 8, 12, 0.2);
    animation: cdim 1.5s ease forwards;
  }
  .cbackdrop.pb { animation: cdim 3.4s ease forwards; }
  .burst {
    position: relative;
    width: min(92vw, 980px);
    padding: 0 18px;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    animation: burst 1.5s cubic-bezier(0.16, 0.8, 0.3, 1) forwards;
  }
  .burst.pb { animation: burst-pb 3.4s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
  .boom {
    width: 100%;
    text-align: center;
    font-size: 64px; line-height: 1.02; font-weight: 900; letter-spacing: 0;
    background: linear-gradient(100deg, #ffce3a 0%, #ffce3a 40%, #fff7d6 50%, #ffce3a 60%, #ffce3a 100%);
    background-size: 280% 100%;
    background-position: 0% 0;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    color: transparent;
    filter: drop-shadow(0 0 8px rgba(0, 0, 0, 0.95)) drop-shadow(0 0 18px rgba(0, 0, 0, 0.6));
    animation: shimmer 1.2s ease-out forwards;
  }
  .boom.pb { animation: shimmer 2.4s ease-out forwards; }
  .csub {
    max-width: min(90vw, 760px);
    text-align: center;
    font-size: 30px; line-height: 1.12; font-weight: 800; letter-spacing: 0; color: #ffe08a;
    text-shadow: 0 0 8px rgba(0, 0, 0, 0.9), 0 2px 16px rgba(255, 200, 60, 0.6);
  }
  .cstars {
    font-size: 52px; letter-spacing: 0; color: #ffcf3a;
    text-shadow: 0 0 8px rgba(0, 0, 0, 0.9), 0 2px 22px rgba(255, 200, 60, 0.7);
  }
  @keyframes burst {
    0% { transform: scale(0.85); opacity: 0; }
    12% { opacity: 1; }
    80% { opacity: 1; }
    100% { transform: scale(1.14); opacity: 0; }
  }
  @keyframes burst-pb {
    0% { transform: scale(0.85); opacity: 0; }
    8% { opacity: 1; }
    60% { transform: scale(1.02); opacity: 1; }
    82% { transform: scale(1.08); opacity: 1; }
    100% { transform: scale(1.16); opacity: 0; }
  }
  @keyframes shimmer {
    0% { background-position: 100% 0; }
    100% { background-position: 0% 0; }
  }
  @keyframes cdim {
    0% { opacity: 0; }
    15% { opacity: 1; }
    70% { opacity: 1; }
    100% { opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .burst, .burst.pb, .boom, .boom.pb, .cbackdrop, .cbackdrop.pb { animation-duration: 0.3s; }
  }
  @media (max-width: 640px) {
    .boom { font-size: 46px; }
    .csub { font-size: 24px; }
    .cstars { font-size: 42px; }
  }
  @media (max-width: 420px) {
    .boom { font-size: 38px; }
    .csub { font-size: 20px; }
    .cstars { font-size: 36px; }
  }
</style>
