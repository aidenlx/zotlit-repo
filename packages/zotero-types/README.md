# @zotlit/zotero-types

Generated TypeScript shapes of the pinned Zotero schema, the hand-written
Zotero key grammar, date predicate and Web API record shapes that every package
shares:

- `./keys` (`src/keys.ts`) — the item key and the Indexed Key: `isItemKey`,
  `formatIndexedKey`, `parseIndexedKey`, `isIndexedKey`.
- `./uri` (`src/uri.ts`) — the `zotero://select` and `zotero://open` links that
  need only a key, and `parseAnnotationOpenUri`.
- `./date` (`src/date.ts`) — `isMultipartDate`, the test of
  `Zotero.Date.isMultipart` for a stored multipart date value.
- `./vocabulary` (`src/vocabulary.ts`, generated) — the item types, fields,
  base-field mappings, creator types and date fields of the schema, without
  its labels and CSL maps. Regenerate with
  `pnpm --filter @zotlit/zotero-types generate:vocabulary`.
- `./web-api` (`src/web-api.ts`) — the JSON shapes of the Zotero Web API v3
  objects that a read-only client stores.

These modules import no other workspace package, so `@zotlit/db`,
`@zotlit/protocol` and both apps read them without a database layer.

- Source input: `zotero-schema/schema.json`, copied from
  [`zotero/zotero-schema`](https://github.com/zotero/zotero-schema).
  `zotero-schema/provenance.json` records its upstream commit.
- Generated output: `src/fields.ts`, committed to the repo.
- Regenerate with `pnpm --filter @zotlit/zotero-types generate:fields`.
- Do not add runtime dependencies or imports to `src/generated.ts`; it must stay pure shape-only TypeScript.

## Schema Bump

1. From the repository root, copy the schema at the desired upstream commit:
   `node packages/scripts/scripts/vendor-upstream.ts zotero-schema [ref]`.
   `[ref]` is a commit, branch or tag; the default is the upstream default
   branch.
2. Confirm `zotero-schema/schema.json` has the intended `version`.
3. Run `pnpm --filter @zotlit/zotero-types generate`.
4. Run `pnpm exec turbo run typecheck --filter=@zotlit/zotero-types`.

## Item-to-CSL Fixture

`fixtures/item-to-csl.json` pairs Zotero's native item corpus with the CSL-JSON
Zotero produces from it, one case per regular item type. `@zotlit/db` reads it
through the stable export `@zotlit/zotero-types/fixtures/item-to-csl.json` to
prove that `itemToCsl()` agrees with Zotero across the whole schema.

- Source inputs: Zotero's `allTypesAndFields` test data and Zotero utilities'
  `citeProcJSExport` test data, each pinned to a commit and a SHA-256 digest in
  `scripts/generate-fixture.ts`.
- Generated output: `fixtures/item-to-csl.json`, committed to the repo.
- Generation is the one network operation in this package. Builds, tests, and
  CI read the committed artifact.

### Fixture Upgrade

An upgrade is manual, so a Zotero mapping change gets human review. Update these
in one reviewed change:

1. `ZOTERO_VERSION`, `APPLICATION_COMMIT`, `UTILITIES_COMMIT`, `SCHEMA_VERSION`,
   and `MODIFIED` in `scripts/generate-fixture.ts`.
2. The `sha256` digest of each source. Run the generator once to read the
   downloaded digest out of the mismatch error, then pin it.
3. The generated `fixtures/item-to-csl.json`, from
   `pnpm --filter @zotlit/zotero-types generate:fixture`.

The generator stops on a schema-version mismatch, on a digest mismatch, on case
keys that differ between the two sources, on a native case whose `itemType`
differs from its key, and on a fixture item-type set that differs from the
regular item types of the pinned schema.
