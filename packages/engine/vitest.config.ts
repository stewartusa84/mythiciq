import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The fixture test builds real WASM-backed column views; give it a little room.
    testTimeout: 20_000,
  },
});
