import type { Runtime } from "#runtime-table";

import { RELEASE_REPOSITORY } from "@zotlit/config/repositories";

import type { PluginProfile } from "./profiles.ts";
import { bundledPlugin, CONTAINER_PLUGIN } from "./profiles.ts";

import { RUNTIMES } from "#runtime-table";

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
  readonly runtime: Runtime;
  readonly developmentOnly?: readonly string[];
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
      mainJsBytes: 5_720_000,
      stylesCssBytes: 146_143,
      startupDailyMs: 100,
      startupUpdateMs: 100,
    },
    runtime: RUNTIMES.desktopRenderer,
    developmentOnly: [
      "zotlit-zotero-web-api-url",
      "zotlit-online-library-root",
      "A development build sends the online library requests",
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
    runtime: RUNTIMES.obsidianModule,
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
      mainJsBytes: 26_200_000,
      stylesCssBytes: 0,
    },
    runtime: RUNTIMES.obsidianModule,
  },
} as const satisfies Record<string, PublishedPlugin>;

export type PublishedPluginName = keyof typeof PUBLISHED_PLUGINS;

export const BUNDLE_PACKAGE_DIR = "dist/package";

export const MOBILE_HOST_BUNDLE = {
  app: "apps/obsidian",
  file: "dist-mobile/main.js",
  runtime: RUNTIMES.mobileRenderer,
} as const;
