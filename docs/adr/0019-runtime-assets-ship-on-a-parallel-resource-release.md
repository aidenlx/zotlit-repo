# Runtime assets ship on a parallel Resource Release

The Obsidian community-plugin scanner accepts exactly `main.js`,
`manifest.json`, and `styles.css` on the release it reads, and reports every
other file as an additional file. ZotLit's plugin release also carried the
Language Packs and the template data JSON Schemas, so it failed that check. The
assets now ship on a **Resource Release** — a second release per plugin version,
tagged `res-<version>`, built from the same commit — and the plugin release
carries only the three accepted files.

Version pinning is the reason the assets cannot simply move to one rolling
release: an installed build composes its download URL from its own
`manifest.version`, so it reaches the packs compiled from its own message set
and the schemas its own contract emitted. A single rolling release would hand an
older installed build a newer message set — missing, renamed, or wrong strings —
and the same drift for the contract. This supersedes ADR 0018 in full, including
0018's own supersession of the versioning half of ADR 0012.

The two release tags carry different guarantees, and the ordering is what makes
that safe. The workflow creates and verifies the Resource Release **before** it
creates the plugin release, and the plugin tag remains the single idempotency
gate. While the plugin tag is absent, no installed build can name that version,
so a retry after a partial run may re-upload assets over it (`gh release upload
--clobber`). Once the plugin release exists, nothing rewrites its resources.

## Considered Options

- **One rolling resource release** — a single permanent tag, like the Zotero
  `zotero-release` host. Costs one tag instead of one per version, and
  reintroduces exactly the drift ADR 0018 was written to delete.
- **Separate releases per asset kind** — isolates a pack-upload failure from a
  schema-upload failure, at two extra tags per version to create, verify, and
  attest, for a failure mode that has not occurred.
- **Bundle everything in `main.js`** — removes the download and the second tag
  together, at a bundle size that grows with every locale for every user.
  Rejected in ADR 0012 and again in 0018 for the same reason.
- **Host the assets off GitHub** (docs site, CDN) — decouples them from the
  release entirely, and gives up build provenance, the byte-compare against the
  public URL, and the release commit as the single source of both artifacts.

## Consequences

- Every plugin version produces two releases on both channels, `<version>` and
  `res-<version>`. The Resource Release mirrors the plugin's prerelease flag and
  is never GitHub's "Latest", which stays reserved for the stable plugin release.
- Pack content, schema content, and plugin message keys still cannot diverge:
  all three come from one commit, and the pair of releases is created in one job.
- A verify failure now happens before the plugin release exists, so it needs no
  cleanup decision — the whole run is retried. Under ADR 0018 the release was
  already published at that point.
- A run that fails after the Resource Release is created, and whose fix needs a
  version bump, leaves an orphan `res-<version>` in the release list. Delete it
  by hand.
- Already-published releases are untouched. Their installed builds keep
  resolving assets from their own version tags, which still carry them.
- The reusable `@zotlit/obsidian-i18n` contract is unchanged: the Pack Source
  stays consumer-supplied, and the Locale Catalog still maps a locale to a flat
  file name. The release tag lives only in the base URL ZotLit supplies.
- A source build at an untagged version cannot download a pack or a schema. The
  plugin surfaces the pack failure as a notice; the dev-server override covers
  Language Packs in development, and schemas have no such override.

## Obsidian resource and Managed Binary packaging

Stage non-English Language Packs, the Template Data schemas, and the Item Query schema in the desktop bundle package's Resource Release directory. The base pack stays in the bundle. Development can serve generated Language Packs locally on port 9092 or on an explicitly selected port. The docs base is a build-time origin without a path so UI links can append their routes.

The Vite process resolves Managed Binary pins once. For Pandoc, derive the version and binary hash from the installed WASM package. Select the sole `.wasm.zip` asset by suffix because upstream has used different versioned filenames. Verify the archive against the release digest and compare the enclosed `pandoc.wasm` hash against the installed binary. Use the entry name without its release directory. Pin scripts can reuse a cache entry for the same version and installed hash, which avoids downloading the upstream asset during a repeated build. [Pin cache validation](https://github.com/aidenlx/zotlit-repo/issues/97)

The Pandoc engine uses the device-wide `zotlit/pandoc-engine` Managed Binary cache. Manage install and removal from its settings row. Let cache discovery complete before the layer returns when it finishes within the startup deadline. After five seconds, release startup with the initial status and publish a late cache hit when discovery finishes. Test the Pandoc engine and Chinese Segmenter with a delayed directory listing to cover both startup paths.

Verify the fixture's binary digest independently of the service. Test two vaults installing the same content by letting the other vault publish it first. A failed engine initialization can be retried by re-installing, which can restore installed status from the content-addressed cache. [Pandoc engine service](../../packages/citations/src/obsidian/pandoc/service.ts) · [Managed Binary startup tests](../../packages/citations/src/obsidian/pandoc/managed-binary-startup.test.ts)

## Managed Binary cache and engine lifetime

Keep the pin independent of the build and plugin runtimes so both can use
it. A pin selects the exact upstream asset and contains the lowercase
SHA-256 of the extracted binary. Accept a bare binary without an extractor.
Write each download into a unique partial file. Publish it by atomic
rename under its pinned hash after verification. Remove the partial file
after any outcome, including a write failure. Expose the directory and
filename in the form the ZoteroReads worker accepts.

Share each binary's OPFS directory across vaults on the device. Store a
dismissed install offer in the vault's local storage. Each binary ID owns
its own directory and consent key. Store reads return a blob without reading its bytes, or
an absent result. An already missing entry counts as a successful removal.
If a different vault removes the cached file, return to the install offer
when the engine next tries to open it. A development End-to-end Run can
use an in-memory store to exercise a cold cache without deleting shared
device files.

Serialize discovery, install, uninstall, and engine start within each
service. Check status inside the serialized operation to use the current
state. Concurrent callers of the same pending install share its outcome.
An uninstall separates installs requested before it from requests after
it. Waiting operations can be cancelled, while an install or uninstall
that enters the cache operation runs through completion. Reject engine
borrows immediately when the status is not installed. Complete a shared
engine start even if that borrower is cancelled so a later borrower can
reuse it. Keep the engine across borrows and invalidate it on uninstall.
Its remaining borrowers keep it until they leave their scopes because the
engine finishes reading the blob at startup. Close the service to new
calls before closing its work scope.

Use one status variant at a time so each settings row has one status
sentence and one action. A reinstall exposes the previously installed
location while it runs. A descriptor can request a start immediately
after install to detect an initialization failure before first use.
Use the caller's Effect context and Clock for platform I/O. Carry network
failure details to the progress notice, which handles the install error
at the settings action. [Managed Binary service](../../packages/plugin-services/src/obsidian/managed-binary/service.ts) · [Managed Binary settings](../../packages/plugin-services/src/obsidian/managed-binary/settings-rows.ts)

The Template Workbench schema command lists every contract root with
a Resource Release URL and a versioned local filename. The installed
manifest version identifies the build that emitted the schema.
[Workbench schema discovery](../../packages/template-workbench/src/core/cli/schema.ts)
