import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The original integration suite resets shared tables between cases.
    // Unit tests remain parallel; database suites must not race that reset.
    fileParallelism: process.env.RUN_DB_TESTS !== 'true',
  },
});
