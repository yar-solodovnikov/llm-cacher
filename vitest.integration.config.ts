import { defineConfig } from 'vitest/config'

export default defineConfig({
  // see src/utils/optionalDeps.ts — tests run the sources as ESM
  define: { __ESM_BUILD__: 'true' },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 30_000,
    reporters: ['verbose'],
    pool: 'forks',
  },
})
