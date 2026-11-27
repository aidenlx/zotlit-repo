import { join } from "node:path";
import type { ConfigEnv } from "vite";
import { defineConfig } from "vite";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { fluentPlugin } from "./scripts/vite-fluent-plugin.ts";
import { prefsPlugin } from "./scripts/vite-prefs-plugin.ts";
import {
  resolveEnv,
  zoteroBuildPlugin,
  zoteroSandboxConfig,
} from "./scripts/vite-zotero-plugin.ts";
import {
  BOOTSTRAP_BUNDLE_NAME,
  FLUENT_FILE_NAME,
  MAIN_BUNDLE_NAME,
} from "./src/constant.ts";

const packageRoot = import.meta.dirname;
const workspaceRoot = await getWorkspaceRoot(packageRoot);

const FLUENT_PREFIX = "zotlit";
const FLUENT_NAMESPACE = "zotero.";
const FLUENT_LOCALE_ALIASES = { en: "en-US" };
const PREF_PREFIX = "extensions.zotlit.";

const BOOTSTRAP_HOOKS = [
  "install",
  "uninstall",
  "startup",
  "shutdown",
  "onMainWindowLoad",
  "onMainWindowUnload",
] as const;
const BOOTSTRAP_IIFE_NAME = "__zotlitBootstrap";

const MAIN_EXPORTS = ["ZotLitZotero"] as const;
const MAIN_IIFE_NAME = "__zotlitMain";

const bootstrapBundle = {
  entry: "src/bootstrap.ts",
  iifeName: BOOTSTRAP_IIFE_NAME,
  fileName: BOOTSTRAP_BUNDLE_NAME,
  exports: BOOTSTRAP_HOOKS,
} as const;

export function createZoteroViteConfig({ mode }: ConfigEnv) {
  const env = resolveEnv(mode);

  return {
    ...zoteroSandboxConfig(packageRoot, env, {
      entry: "src/main.ts",
      iifeName: MAIN_IIFE_NAME,
      fileName: MAIN_BUNDLE_NAME,
      exports: MAIN_EXPORTS,
      target: "es2023",
    }),
    plugins: [
      fluentPlugin({
        root: packageRoot,
        env,
        project: join(workspaceRoot, "project.inlang"),
        namespace: FLUENT_NAMESPACE,
        prefix: FLUENT_PREFIX,
        localeAliases: FLUENT_LOCALE_ALIASES,
        ftlFileName: FLUENT_FILE_NAME,
        addonDir: "addon",
        typesOutput: "src/types/fluent.ts",
      }),
      prefsPlugin({
        root: packageRoot,
        prefix: PREF_PREFIX,
        prefsFile: "addon/prefs.js",
        addonDir: "addon",
        typesOutput: "src/types/prefs.ts",
      }),
      zoteroBuildPlugin({
        root: packageRoot,
        env,
        bootstrapBundle,
      }),
    ],
  };
}

export default defineConfig(createZoteroViteConfig);
