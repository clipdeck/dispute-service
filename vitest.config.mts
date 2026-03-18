import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
      exclude: ['tests/**', 'dist/**', 'prisma/**', 'src/index.ts', 'node_modules/**'],
    },
  },
})
