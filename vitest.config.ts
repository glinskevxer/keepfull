import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      // The two process entry points are argv parsing and signal handling
      // around code that is covered on its own. Testing them means spawning a
      // process, which buys a number rather than a guarantee.
      exclude: ['src/index.ts', 'src/api/main.ts', 'src/cli/main.ts'],
      // Set just under where the suite actually sits, so a real regression
      // fails the build and a one line change does not.
      thresholds: {
        lines: 96,
        statements: 96,
        functions: 96,
        branches: 91,
      },
    },
  },
});
