import { defineConfig } from 'vitest/config';
import skeleton from '../vitest.config.ts';
export default defineConfig({
  ...skeleton,
  test: {
    ...skeleton.test,
    projects: [
      ...(skeleton.test?.projects ?? []),
      {test: {name: 'foundation-backend', include: ['tests/foundation/**/*.test.ts'], environment: 'edge-runtime'}},
    ],
  },
});
