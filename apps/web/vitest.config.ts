import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("src", import.meta.url)) } },
  test: {
    environment: "node",
    // Browser tests must use jsdom's storage, not Node's experimental Web Storage.
    execArgv: ["--no-experimental-webstorage"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
