import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['core/**/*.test.ts', 'linkedin/**/*.spec.ts', '**/*.spec.ts', '**/*.test.ts'],
  },
});
