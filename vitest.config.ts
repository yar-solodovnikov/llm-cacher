import { defineConfig } from 'vitest/config'

export default defineConfig({
  // see src/utils/optionalDeps.ts — tests run the sources as ESM
  define: { __ESM_BUILD__: 'true' },
  test: {
    exclude: ['tests/integration/**', '**/node_modules/**'],
  },
})
