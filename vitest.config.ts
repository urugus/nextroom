import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@main": resolve("src/main"),
      "@renderer": resolve("src/renderer/src"),
      "@shared": resolve("src/shared"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["tests/setup.ts"],
  },
});
