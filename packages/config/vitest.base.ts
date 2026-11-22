import { fileURLToPath } from "node:url";

export const testDefaults = {
  maxWorkers: 4,
  testTimeout: process.env.GITHUB_ACTIONS ? 15_000 : 5_000,
  exclude: ["**/node_modules/**", "**/.git/**", "**/.scratch/**"],
  globalSetup: [
    fileURLToPath(new URL("./vitest-memory-gate.ts", import.meta.url)),
  ],
};
