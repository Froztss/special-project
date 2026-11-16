import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/db/feature-data.integration.test.ts'],
  },
});
