import { defineConfig } from 'vitest/config';
import suite from './vitest.config.ts';
export default defineConfig({ ...suite, test: { ...suite.test, projects: [
  ...(suite.test?.projects ?? []),
  { test: { name: 'scripts', include: ['scripts/**/*.test.ts'], environment: 'node' } },
  { test: { name: 'e2e-harness', include: ['e2e/**/*.test.ts'], environment: 'node' } },
] } });
