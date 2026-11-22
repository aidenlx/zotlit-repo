import { RELEASE_REPOSITORY } from "@zotlit/config/repositories";

import { bundledPlugin, CONTAINER_PLUGIN } from "./profiles.ts";
import type { PluginProfile } from "./profiles.ts";

export interface PublishedPlugin {
  readonly profile: PluginProfile;
  readonly app: string;
  readonly bundlePackage: string;
  readonly repository: string;
  readonly versions: string;
  readonly readme: string;
  readonly giscus: boolean;
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
    profile: bundledPlugin({
      resources:
        "Language Packs, template data JSON Schemas, and the Item Query Schema",
    }),
    app: "apps/obsidian",
    bundlePackage: "@zotlit/obsidian-plugin",
    repository: RELEASE_REPOSITORY,
    versions: "versions.json",
    readme: "README.md",
    giscus: true,
    changelog: "https://zotlit.aidenlx.site/changelog/",
    budget: {
      mainJsBytes: 5_000_000,
      stylesCssBytes: 146_143,
      startupDailyMs: 100,
      startupUpdateMs: 100,
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
    profile: bundledPlugin({ resources: "Language Packs" }),
    app: "apps/reader",
    bundlePackage: "@zotlit/reader-plugin",
    repository: "aidenlx/zotlit-reader",
    versions: "apps/reader/versions.json",
    readme: "apps/reader/README.md",
    giscus: false,
    budget: {
      mainJsBytes: 1_700_000,
      stylesCssBytes: 291_892,
      startupDailyMs: 30,
      startupUpdateMs: 50,
    },
    allowedRequires: ["obsidian"],
  },
  resources: {
    profile: CONTAINER_PLUGIN,
    app: "apps/resources",
    bundlePackage: "@zotlit/resources-plugin",
    repository: "aidenlx/zotlit-resources",
    versions: "apps/resources/versions.json",
    readme: "apps/resources/README.md",
    giscus: false,
    budget: {
      mainJsBytes: 25_800_000,
      stylesCssBytes: 0,
    },
    allowedRequires: ["obsidian"],
  },
} as const satisfies Record<string, PublishedPlugin>;

export type PublishedPluginName = keyof typeof PUBLISHED_PLUGINS;

export const BUNDLE_PACKAGE_DIR = "dist/package";
