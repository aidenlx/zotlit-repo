import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { Plugin } from "vite";

export const binaryAssets: Plugin = {
  name: "pdf-reader-binary-assets",
  config: () => ({ assetsInclude: ["**/*.bcmap", "**/*.pfb"] }),
};

const require = createRequire(resolve(import.meta.dirname, "../package.json"));

export const readerAlias: Record<string, string> = {
  react: require.resolve("preact/compat"),
};
