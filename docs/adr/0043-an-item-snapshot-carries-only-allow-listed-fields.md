# An Item Snapshot carries only allow-listed fields

The Item Snapshot exporter spreads every Zotero field and custom field of the selected Item, its related Items, and each annotation's parent Item into the snapshot, and the personal-library `weblink` embeds the user's Zotero account username. The page then stored the whole snapshot in `localStorage` on the docs origin. Decided in the Local Bridge redaction review on map [#835](https://github.com/aidenlx/zotlit/issues/835): the exporter emits only fields declared in the generated Zotero field schema plus the Item's custom fields, and a test diffs the exported shape against that declaration so a new field is redacted until someone declares it. The personal-library `weblink` is emitted as unavailable with a reason; the group-library form, which carries only the public group id, stays. Annotation text and comments, tag and collection names, attachment file names, the Extra field, and vault-relative link targets stay in, because a template renders them and the page runs on the user's own machine. Absolute paths, attachment contents, child-note bodies, annotation image bytes, and Zotero cache paths never leave, as before. A connected snapshot lives in `sessionStorage` only; drafts keep `localStorage`.

## Consequences

- Sample Items are regenerated from the allow-listed exporter; the snapshot test that fails on a contract bump also fails on an undeclared field.
- The `unavailable` list covers every root in the snapshot, including standalone annotation roots, and a citation style whose CSL carries no title falls back to its id rather than its file name.
- A template that prints `zt.weblink` previews it as unavailable for a personal library; the note written in Obsidian is unchanged.

## Snapshot export boundary

Use the generated contract to identify roots and Item-shaped records.
Fail export when the root is unknown so a snapshot cannot pass through
unpruned. Preserve serializer markers as their own shapes. When a field
can be one of several object shapes, combine their declared properties
and still prune the record. On Item-shaped records, also keep the
Zotero fields for the actual Item type, their base-field aliases, and
fields declared by the user's Custom Item Fields. Include declarations
from related Items because they can contribute fields to the note root.

Suppress personal-library web links because the account name is part of
the public URL. A group link uses its public group ID and remains. Report
redacted values as unavailable. A Child Note without a vault target
still links to Zotero. Reject disallowed provenance and vault paths.

Share browser-safe snapshot schemas between hosts. Keep the Item's
filter row optional so older exports and Items outside the live
top-level dataset can still load.
[Allowlist](../../packages/workbench/src/snapshot/allowlist.ts) · [Snapshot schema](../../packages/workbench/src/snapshot/schema.ts)

When serializing a selected field, keep helper metadata at its original
path. A missing contract entry reports a stale build artifact
separately from an error while evaluating data.
[Field serialization](../../packages/workbench/src/explorer/serialize.ts)
