import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
