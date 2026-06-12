import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 15000,
    passWithNoTests: true,
    env: { SCALPEL_NO_CONFIG: '1' }, // tests never read ~/.scalpel/config.json
  },
})
