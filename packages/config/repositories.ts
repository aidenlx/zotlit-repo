// The two GitHub repositories of ZotLit, as `owner/name`. Every link,
// download URL and API call that names a repository reads it from here.

/**
 * The source repository: this monorepo, its issues and its pull requests.
 * Root `package.json#repository` names it for npm and `pnpm release`.
 */
export const SOURCE_REPOSITORY = "aidenlx/zotlit-repo";

/**
 * The publish repository: the desktop plugin's releases (`x.y.z`), the
 * Resource Releases (`res-x.y.z`), the Companion's releases (`zt-x.y.z`) and
 * the rolling release of its update manifest, the community directory entry,
 * the discussions, and the issues filed before the source moved.
 */
export const RELEASE_REPOSITORY = "aidenlx/zotlit";
