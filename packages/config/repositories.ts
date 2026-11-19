// The two GitHub repositories of ZotLit, as `owner/name`, and the trunk of the
// source repository. Every link, download URL and API call that names a
// repository or the trunk reads it from here.

/**
 * The source repository: this monorepo, its issues and its pull requests.
 * Root `package.json#repository` names it for npm, and the bundle package's
 * `repository` names it for npm provenance.
 */
export const SOURCE_REPOSITORY = "aidenlx/zotlit-repo";

/**
 * The one long-lived branch of the source repository, its trunk. Every
 * change lands on it through `pnpm land`, and every release, beta or stable,
 * is a version commit on it (ADR 0097).
 */
export const SOURCE_BRANCH = "main";

/**
 * The publish repository: the desktop plugin's releases (`x.y.z`), the
 * Resource Releases (`res-x.y.z`), the Companion's releases (`zt-x.y.z`) and
 * the rolling release of its update manifest, the community directory entry,
 * the discussions, and the issues filed before the source moved.
 */
export const RELEASE_REPOSITORY = "aidenlx/zotlit";
