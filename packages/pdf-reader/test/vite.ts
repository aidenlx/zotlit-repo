import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { Plugin } from "vite";

import { obsidianSetupFile } from "@zotlit/obsidian-kit/vitest";

export const binaryAssets: Plugin = {
  name: "pdf-reader-binary-assets",
  config: () => ({ assetsInclude: ["**/*.bcmap", "**/*.pfb"] }),
};

const require = createRequire(resolve(import.meta.dirname, "../package.json"));

export const readerAlias: Record<string, string> = {
  react: require.resolve("preact/compat"),
};

export const obsidianStandIn: Record<string, string> = {
  obsidian: resolve(import.meta.dirname, "obsidian.ts"),
};

export function obsidianSetup(entry: string): Plugin {
  return {
    name: "pdf-reader-obsidian-setup",
    transform: (code, id) =>
      id === entry
        ? `import ${JSON.stringify(obsidianSetupFile)};\n${code}`
        : null,
  };
}
