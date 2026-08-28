import { defineConfig } from "vitest/config";

// Vendored upstreams ship their own test suites (some for other runners
// entirely); only this package's seam tests belong to `pnpm test`.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
