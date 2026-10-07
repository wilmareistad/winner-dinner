import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.js"],
    testTimeout: 20000,
    // One test file at a time. DB tests in different files use the same usernames
    // in uncommitted transactions, so in parallel they wait on each other's
    // unique-key locks and can exhaust the session pooler's connections.
    // Concurrency is tested on purpose with race() inside a file.
    fileParallelism: false,
  },
});
