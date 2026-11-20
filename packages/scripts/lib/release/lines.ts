// The two release lines and the facts that follow from a version's line. A
// pre-release version (`2.3.0-beta.0`) is on the beta line; any other version
// is on the stable line. Both lines ship from version commits on `main`, the
// one trunk; the version alone picks the line (ADR 0097).
//
// This module and `plan.ts` import Node builtins only: the plan job of
// release.yml runs them before any dependency is installed.

export type ReleaseLine = "beta" | "stable";

/**
 * A semver version with a pre-release part, such as `2.3.0-beta.0`, is on
 * the beta line. The pre-release part follows the first `-` before any `+`
 * build metadata.
 */
export function releaseLine(version: string): ReleaseLine {
  return version.split("+")[0]!.includes("-") ? "beta" : "stable";
}

/**
 * The branch of the publish repository that holds each line's shell. The
 * community directory reads `manifest.json` from the default branch, `main`,
 * so a beta stays off it.
 */
export const PUBLISH_BRANCH = {
  beta: "beta",
  stable: "main",
} as const satisfies Record<ReleaseLine, string>;

/** The npm dist-tag of each line's bundle package. */
export const NPM_DIST_TAG = {
  beta: "beta",
  stable: "latest",
} as const satisfies Record<ReleaseLine, string>;

/**
 * The docs site that a build of each line links to: Pre-release Docs for a
 * beta, Stable Docs for a stable release. The build reads it from
 * `DOCS_SITE_URL`.
 */
export const DOCS_SITE_URL = {
  beta: "https://zotlit-beta.aidenlx.site",
  stable: "https://zotlit.aidenlx.site",
} as const satisfies Record<ReleaseLine, string>;

/** The products a release publishes, each from its own app. */
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
} as const satisfies Record<
  string,
  { app: string; tagPrefix: string; plugin?: string; publish: boolean }
>;

export type Product = keyof typeof PRODUCTS;

/**
 * The release tag of a product version in the source repository, on the
 * commit the release was built from: `2.3.0` for ZotLit, `zt-2.3.0` for the
 * Companion, `reader-1.0.0` for ZotLit Reader. A plugin's publish repository
 * tags the bare version, which Obsidian reads as the release name.
 */
export function releaseTag(product: Product, version: string): string {
  return `${PRODUCTS[product].tagPrefix}${version}`;
}
