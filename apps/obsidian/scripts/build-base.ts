import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginOption } from "vite";

import { pandocFilterVariants } from "@zotlit/citations/vite";
import { effectEntry, effectEntryCheck } from "@zotlit/plugin-kernel/vite";
import { parseMinElectronVersion } from "@zotlit/scripts/obsidian-manifest";
import { PLUGIN_KERNEL, pluginPackages } from "@zotlit/scripts/plugin-packages";
import type { Runtime } from "@zotlit/scripts/runtime-table";
import { HOST_MODULES } from "@zotlit/scripts/shell/build";

import packageJson from "../package.json" with { type: "json" };
import { rendererSqlCheck } from "./renderer-sql-check.ts";
import { SQLITE_ENGINE_VERSION } from "./sqlite-engine.ts";

const packageRoot = resolve(import.meta.dirname, "..");

export const pluginCode = [
  resolve(packageRoot, "src"),
  resolve(packageRoot, "scripts"),
  ...pluginPackages(packageRoot)
    .filter(({ name }) => name !== PLUGIN_KERNEL)
    .map(({ root }) => join(root, "src")),
];

export const fullContractIRPath = fileURLToPath(
  import.meta.resolve("@zotlit/db/contract/ir.json"),
);

export function pluginBuildBase(mode: string, runtime: Runtime) {
  return {
    resolve: {
      alias: {
        "@zotlit/db/contract/ir.runtime.json": fullContractIRPath,
        fflate: "fflate/browser",
      },
      conditions: [...runtime.conditions],
      tsconfigPaths: true,
    },
    define: {
      __DEV__: JSON.stringify(mode === "development"),
      __PLUGIN_ID__: JSON.stringify(packageJson.obsidian.id),
      __ANNOTATION_SUGGESTER_ENABLED__: JSON.stringify(
        process.env.ANNOTATION_SUGGESTER_ENABLED === "true",
      ),
      __DOCS_SITE_URL__: JSON.stringify(
        parseDocsSiteUrl(process.env.DOCS_SITE_URL),
      ),
      __MIN_ELECTRON_VERSION__: JSON.stringify(
        parseMinElectronVersion(packageJson),
      ),
      __SQLITE_ENGINE_VERSION__: JSON.stringify(SQLITE_ENGINE_VERSION),
      "process.env.NODE_ENV": JSON.stringify(mode),
    },
    external: HOST_MODULES,
    rendererPlugins: [
      effectEntry("renderer", { scopes: pluginCode }),
      effectEntryCheck("renderer"),
      rendererSqlCheck(packageRoot),
      preact(),
      tailwindcss(),
      pandocFilterVariants(),
    ] satisfies PluginOption[],
  };
}

function parseDocsSiteUrl(value: string | undefined): string {
  const fallback = "https://zotlit.aidenlx.site";
  if (!value) return fallback;
  const url = new URL(value);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      `DOCS_SITE_URL must be an origin with no path, got ${JSON.stringify(value)}`,
    );
  }
  return url.origin;
}
