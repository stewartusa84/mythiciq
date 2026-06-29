<script lang="ts">
  import fullLogo from '../assets/img/logo-new.png';

  export let small = false;
</script>

<span class="brand-lockup" class:small>
  <img
    class="brand-full-logo"
    src={fullLogo}
    alt=""
    aria-hidden="true"
    decoding="async"
  />
</span>
