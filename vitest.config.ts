import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['function/__tests__/**/*.test.ts'],
    coverage: {
      enabled: false
    }
  }
});
