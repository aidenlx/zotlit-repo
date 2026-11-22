export type ReleaseLine = "beta" | "stable";

export function releaseLine(version: string): ReleaseLine {
  return version.split("+")[0]!.includes("-") ? "beta" : "stable";
}

export const PUBLISH_BRANCH = {
  beta: "beta",
  stable: "main",
} as const satisfies Record<ReleaseLine, string>;

export const NPM_DIST_TAG = {
  beta: "beta",
  stable: "latest",
} as const satisfies Record<ReleaseLine, string>;

export const DOCS_SITE_URL = {
  beta: "https://zotlit-beta.aidenlx.site",
  stable: "https://zotlit.aidenlx.site",
} as const satisfies Record<ReleaseLine, string>;

export const PRODUCTS = {
  obsidian: {
    app: "apps/obsidian",
    tagPrefix: "",
    plugin: "desktop",
    publish: true,
  },
  zotero: { app: "apps/zotero", tagPrefix: "zt-", publish: true },
  reader: {
    app: "apps/reader",
    tagPrefix: "reader-",
    plugin: "reader",
    publish: true,
  },
  resources: {
    app: "apps/resources",
    tagPrefix: "resources-",
    plugin: "resources",
    publish: true,
  },
} as const satisfies Record<
  string,
  { app: string; tagPrefix: string; plugin?: string; publish: boolean }
>;

export type Product = keyof typeof PRODUCTS;

export function releaseTag(product: Product, version: string): string {
  return `${PRODUCTS[product].tagPrefix}${version}`;
}
