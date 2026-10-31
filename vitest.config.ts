import { defineConfig } from "vitest/config";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
export default defineConfig({
  test: { testTimeout: 30000, hookTimeout: 30000, restoreMocks: true },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
});
