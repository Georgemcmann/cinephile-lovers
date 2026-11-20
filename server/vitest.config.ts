import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Integration tests spawn the real server and wait for health; the
    // default 5 s is too tight on cold starts.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // The build output (dist/) must never be re-run as a test suite; tests
    // live in src/ and test/ only. This bit us for real: after `npm run
    // build`, Vitest picked up dist/*.test.js and every test ran twice.
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
