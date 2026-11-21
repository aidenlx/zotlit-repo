// The Obsidian plugins ZotLit publishes, each from a host app of this
// workspace to its own publish repository. Every fact that differs per plugin
// lives in its entry here or in its host app's package.json.
import { RELEASE_REPOSITORY } from "@zotlit/config/repositories";

/** One published plugin. */
export interface PublishedPlugin {
  /**
   * The host app's folder, relative to the workspace root. Its package.json
   * holds the version and the manifest fields, and its production build
   * writes the bundle package into `dist/package/`.
   */
  readonly app: string;
  /** The npm package that carries the plugin's bundle, versioned as the plugin. */
  readonly bundlePackage: string;
  /** The publish repository, `owner/name`: the plugin's releases and its directory entry. */
  readonly repository: string;
  /** The plugin's `versions.json`, relative to the workspace root. */
  readonly versions: string;
  /** The README the publish repository shows, relative to the workspace root. */
  readonly readme: string;
  /** Whether the publish repository hosts the docs site's Giscus discussions. */
  readonly giscus: boolean;
  readonly resources: string;
  readonly changelog?: string;
  readonly budget: PluginBudget;
  readonly allowedRequires: readonly string[];
}

export interface PluginBudget {
  readonly mainJsBytes: number;
  readonly stylesCssBytes: number;
  readonly startupDailyMs?: number;
  readonly startupUpdateMs?: number;
}

export const PUBLISHED_PLUGINS = {
  desktop: {
    app: "apps/obsidian",
    bundlePackage: "@zotlit/obsidian-plugin",
    repository: RELEASE_REPOSITORY,
    versions: "versions.json",
    readme: "README.md",
    giscus: true,
    resources:
      "Language Packs, template data JSON Schemas, and the Item Query Schema",
    changelog: "https://zotlit.aidenlx.site/changelog/",
    budget: {
      mainJsBytes: 5_000_000,
      stylesCssBytes: 146_143,
      startupDailyMs: 100,
      startupUpdateMs: 190,
    },
    allowedRequires: [
      "obsidian",
      "@codemirror/autocomplete",
      "@codemirror/commands",
      "@codemirror/language",
      "@codemirror/lint",
      "@codemirror/state",
      "@codemirror/view",
      "@lezer/common",
      "@lezer/highlight",
      "@lezer/lr",
      "module",
      "node:async_hooks",
      "node:buffer",
      "node:child_process",
      "node:crypto",
      "node:fs",
      "node:fs/promises",
      "node:http",
      "node:http2",
      "node:https",
      "node:module",
      "node:net",
      "node:os",
      "node:path",
      "node:path/posix",
      "node:sqlite",
      "node:stream",
      "node:stream/consumers",
      "node:string_decoder",
      "node:tls",
      "node:url",
      "node:util",
      "node:zlib",
    ],
  },
  reader: {
    app: "apps/reader",
    bundlePackage: "@zotlit/reader-plugin",
    repository: "aidenlx/zotlit-reader",
    versions: "apps/reader/versions.json",
    readme: "apps/reader/README.md",
    giscus: false,
    resources: "Language Packs",
    budget: {
      mainJsBytes: 1_700_000,
      stylesCssBytes: 291_892,
      startupDailyMs: 30,
      startupUpdateMs: 50,
    },
    allowedRequires: ["obsidian"],
  },
} as const satisfies Record<string, PublishedPlugin>;

export type PublishedPluginName = keyof typeof PUBLISHED_PLUGINS;

/** Where a host app's production build writes the bundle package. */
export const BUNDLE_PACKAGE_DIR = "dist/package";
