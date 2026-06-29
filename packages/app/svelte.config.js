import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  // Use Vite/esbuild to handle <script lang="ts"> in .svelte files.
  preprocess: vitePreprocess(),
};
