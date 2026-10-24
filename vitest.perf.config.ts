import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Opt-in performance probes (`npx vitest run --config vitest.perf.config.ts`); excluded from `npm test`.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  define: { __APP_VERSION__: JSON.stringify('perf') },
  test: { include: ['tests/perf/**/*.test.ts'], environment: 'node', testTimeout: 900_000 },
});
