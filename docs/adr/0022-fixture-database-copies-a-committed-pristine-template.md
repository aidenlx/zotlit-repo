# The Fixture database copies a committed pristine template

> **Status: accepted.**

The Fixture pairs with a real Zotero 10 instance (the Paired Zotero), so its
`zotero.sqlite` must be a full-fidelity database that survives Zotero's
startup integrity check and writes. Every Fixture build copies a committed
pristine `zotero.sqlite` — created once by first-running an official,
version-pinned Zotero 10 build on an empty data directory — and inserts the
Fixture Spec's rows into the copy. The same managed Zotero install (downloaded
into a per-user cache keyed by version, Playwright-style: macOS DMG, Windows
portable zip) is what `pnpm fixture zotero` launches, so one pinned artifact
serves both the template harvest and the Paired Zotero.

## Considered Options

- **Minimal hand-written DDL** (the previous approach): sufficient for
  ZotLit's read-only queries, ruined the moment a real Zotero opens the
  database.
- **Vendor Zotero's schema sources** (`system.sql`/`userdata.sql`/
  `triggers.sql` + global schema JSON) and reimplement first-run
  initialization: reimplements logic the authoritative code already runs, and
  drifts silently.
- **Build-time dependency on a Zotero source checkout**: couples every
  Fixture build on every machine to an external checkout and its
  submodule/LFS/npm bootstrap.

## Consequences

- The committed template is a small binary — `pnpm fixture harvest` stores it
  gzipped, because Zotero's 32 KB page layout makes a first-run database 5 MB
  of mostly empty pages. Regeneration is that one command, needed only when
  Zotero bumps its schema; the [Fixture guide](../fixture.md#regenerate-the-pristine-zotero-template)
  carries the procedure.
- The same harvest captures the CSL styles that first run unpacked, committed
  beside the template as `pristine-styles.json.gz`. Zotero unpacks its bundled
  styles into the data directory seconds after it starts, so a Fixture carrying
  the database alone would offer no Citation and References Style until a Paired
  Zotero had run. Every build lays the styles down itself, which also serves the
  e2e and CLI flows that read the Fixture with no Zotero running.
- The template already holds Zotero's global schema, so the build reads item
  type, field, and creator type ids back by name instead of declaring them,
  and Zotero's own foreign keys and triggers check every inserted row.
- After a Paired Zotero session the database drifts from the Fixture Spec; rebuilding
  the Fixture is the reset. The Fixture is disposable by design, so this is
  accepted.

A Vault Case has its own Development Vault. Its seed can configure the
Companion notification URL and matching vault port together, set the
Zotero Local API port and enable the API, and provide both halves of a
remembered write grant. The upgrader case can replace the built-in field
list. The Fixture can also install a plugin without enabling it.

### Fixture archive, layout, and forks

Keep the disposable Fixture under the workspace scratch root, with
separate Zotero data, profile, and Attachment paths. The profile points
to the data directory, and linked-file rows refer to the generated
assets through native paths. Discard removes that disposable tree.
Fork reserves a new path exclusively, snapshots SQLite with its
committed WAL data, and copies owned assets. A fork can be changed
or removed independently. Tests cover collisions, missing sources,
escaped paths, and cleanup of partial copies.

Assert the pristine database versions written by the pinned Zotero.
Compress the mostly empty SQLite pages in Git. Keep the CSL styles,
including hidden dependency parents, from the same first run so the
Fixture can offer Citation and References Styles before Zotero opens.

Harvest to a throwaway profile and data directory. While Zotero holds
the database lock, observe the style files and the WAL signature.
Wait for styles and consecutive unchanged polls before stopping Zotero.
Give SIGTERM time to finish and use SIGKILL if the process stays live.
Once the lock is gone, fold the WAL into the database and compact it.
Require the expected versions, a successful integrity check, and a
successful foreign-key check before replacing the committed template.
Require a nonempty style archive.

Generate the Fixture reference and Sample Items from the committed
selection. Keep deterministic Stress Build keys scattered across Item
ID order. This exercises the seek cost that ascending keys hid, while
tests verify valid and unique keys and stable seeds.

[Pristine database](../../packages/scripts/lib/fixture/pristine.ts) ·
[Fixture fork](../../packages/scripts/lib/fixture/fork.ts) ·
[Fixture reference](../../docs/fixture.md)

### Fixture Spec coverage

Keep the Fixture Spec as part of the builder's public surface so callers
can use the same import for the build and its expected data. Select a
Library by My Library or stable group ID. Group IDs, local Library IDs,
and their order deliberately differ. A read-only group and missing
group selectors exercise availability and scope. Reuse bare keys across
Libraries to require a Library selector. Nest one Collection so direct
membership and descendants give different answers. Persist a nonempty
explicit scope with My Library first and groups ordered by ID.

Use Item types that exercise native and aliased container and publisher
fields, plus one type with neither. Prefer the container for Venue and
include a competing publisher. Ask Zotero's schema for the field
mappings, including bookSection's bookTitle field, and fail on invalid
fields. Keep the first-run My Library row and update its values. Database
creator and value rows deduplicate across Items. Assign their IDs at first
use in Spec order. Leave equivalent ASCII search normalizations unset
and let search fall back to the original value. Map single-field creators
to lastName. Keep the declared Item relationships reciprocal. Include
one newer modification with an earlier addition and ties within and
across Libraries. Store UTC timestamps in Zotero's format. On the build
connection, pin CURRENT_TIMESTAMP for any unstamped column. Close that
connection so a real Zotero later uses its live clock. Check both the
defaulted timestamps and the presence of stamped rows.

Use titles that cover lexical digits, case, and accents for the Electron
and Node collation check. Include a Chinese title that distinguishes the
Resource Pack segmenter from the platform segmenter. Keep note-import
work in every Library, and file child notes through the parent. Seed
each cited key's expected unique, ambiguous, or unresolved resolution.
Fail a build that changes one of those cases. Keep graph edges in the
literature notes themselves. Test both an Item with no Citation Key and
a seeded note with the compatibility citekey field.

### Vault Cases and generated content

Let the Scope Case select the saved Library Scope and the Vault Case
select the vault state and Item set. Include related child rows and
parents. Rebuild the disposable root before seeding. A fresh vault uses
the default scope, the Default Profile, and no settings file. Remove any
copied plugin settings from that case. For configured cases, write the
promised settings after copying bundles. A Development Vault can carry
old settings in its plugin directory. Add sidebar views only when their
plugin is installed and populate the enabled list only with installed
bundles. Leave native menus off for Windows automated cases. The
workspace layout is a first-open preset.

Use distinct demo and test Items. Keep demo Literature Notes and their
linked PDFs in the corresponding Vault Cases. Leave the demo book
without a note so a walkthrough can create the first one. Seed notes
for My Library's ordinary test Items to exercise update while the
remaining Items exercise create. A committed Literature Note page
replaces the generated note for its Item. Preserve the old Annotation
Query Block in a Managed Region with a Query File embed below it to
exercise both persistence paths. Read the fixed Annotations section
from the shipped content template and fail if it changes to a section
the Fixture cannot reproduce. Encode property lists as YAML lists,
nulls as empty keys, and strings as quoted scalars.

Use the same showcase property values in Bases and Query File tables.
Seed their Obsidian property types in the cases with showcase notes.
Leave them out of the Docs Vault Case, where the related text type
would conflict with a new note's list. The Graph Vault Case has one
Literature Note per My Library Item, one group of cited-only Items,
and research notes below the relevant template content. Its graph
preset distinguishes Literature Notes and research notes. The Docs
Vault Case adds papers to the demo set, files both sets by topic, and
uses Zotero storage for its PDFs. Seed notes as Zotero's editor stores
them, including CSL snapshots and a dragged highlight. Leave their
vault copies absent so a lesson can import them.

Seed the configured Profile with its own document, target folder, and
Shared Partial. The demo Profile has no Match and only applies when
selected. A keyed property writes one name and a keyless JSON-e rule
can select property names. A Managed Block calls the Shared Partial
so its absence refuses both create and update. The import example
needs different Partial bytes to prompt for a choice. Use a visibly
edited alternate Citation Variant and keep the other shipped variant.
Install the numeric zh-CN style beside the bundled CSL styles so the
locale case is visible from first open. The style's rights field records
its CC BY-SA 3.0 license.

### Stress Builds

Fill each selected Library to its requested total after counting its
Spec Items. Keep the two seed ranges disjoint. Permute seven-character
key suffixes with a multiplier coprime to 33 and use BigInt for exact
products. Scramble modification order independently. Generate rare,
common, and dominant values for queries with different selectivity,
an Item with many tagged marks for Parent Record queries, and long
text on some items to exercise variable List row heights. A sparsely
filled group can model an import gap. The generated Fixture reference
lists the exact distributions.

[Fixture Spec](../../packages/scripts/lib/fixture/spec.ts) ·
[Fixture build](../../packages/scripts/lib/fixture/build.ts) ·
[Fixture reference](../../docs/fixture.md)
