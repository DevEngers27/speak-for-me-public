import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    typecheck: {
      // Compile-time proofs live in *.test-d.ts and are checked by `vitest run --typecheck`
      // (and again by `npm run typecheck`).
      include: ['test/**/*.test-d.ts'],
      tsconfig: './tsconfig.json',
    },
  },
});
