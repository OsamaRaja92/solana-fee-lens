import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Every test runs against recorded fixtures: no network, no RPC key.
    environment: 'node',
  },
});
