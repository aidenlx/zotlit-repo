import { resolve } from "node:path";
import type { PluginOption } from "vite";

import { packageSource } from "@zotlit/obsidian-kit/vitest";
import { effectEntry } from "@zotlit/plugin-kernel/vite";
import { runInElectron as runBundleInElectron } from "@zotlit/scripts/electron-renderer";
import { getPackageRoot } from "@zotlit/scripts/package-roots";

export { testElectron } from "@zotlit/scripts/electron-renderer";

export function runInElectron(options: {
  entry: string;
  name: string;
  marker: string;
  timeoutMs?: number;
  minimized?: boolean;
  plugins?: PluginOption[];
  alias?: Record<string, string>;
}): Promise<unknown> {
  return runBundleInElectron({
    ...options,
    define: { __PLUGIN_ID__: JSON.stringify("zotlit") },
    plugins: [
      effectEntry("renderer", {
        scopes: [
          resolve(getPackageRoot(options.entry), "src"),
          packageSource(import.meta.resolve("@zotlit/obsidian-kit/package.json")),
          packageSource(import.meta.resolve("@zotlit/obsidian-desktop/package.json")),
          packageSource(import.meta.resolve("@zotlit/zotero-reads/package.json")),
        ],
      }),
      ...(options.plugins ?? []),
    ],
  });
}
