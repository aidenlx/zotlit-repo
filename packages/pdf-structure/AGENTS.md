# @zotlit/pdf-structure

The pinned port of Zotero's PDF text structure and the golden parity test that
keeps it honest. `README.md` describes the public surface.

## The port is upstream code

`src/vendor/*.js` is copied **verbatim** under a provenance header: three files
from `zotero/pdf.js`, and `native-text-selection-map.js` from `zotero/reader`.
Every line after the `// === verbatim upstream copy starts here ===` marker
belongs to upstream, and `src/parity.test.ts` asserts it is byte-identical to
the checkout. Leave those four files as the linter finds them;
`oxlint.config.ts` ignores them for exactly that reason.

The one way to change them is a whole-body refresh from a newer checkout, when
the parity test fails against a newer Zotero. Move the pinned commits in every
file header and in `PINNED_COMMITS` in the parity test in the same change.
Parity means parity with one fork; drift across Zotero versions is accepted,
because Zotero's own import worker already produces it.

The hand-written `.d.ts` files are ours: `structure.js`, `page-label.js` and
`native-text-selection-map.js` have one each, because the port imports them; `util.js` has none, because only
`page-label.js` reaches it and TypeScript never sees that edge.
`tsconfig.lib.json` keeps `allowJs` off, so TypeScript reads the declaration and
the bundler reads the JS.

## Running the golden parity test

The oracle is Zotero's own code, run from a local checkout, and only from there.
It needs `zotero/zotero` with its submodules initialised and pinned to the
commits `src/parity.test.ts` names:

```sh
ZOTLIT_ZOTERO_CHECKOUT=/path/to/zotero pnpm --filter @zotlit/pdf-structure test
```

Without the variable the test looks for `zotero-10` beside the repository — the
repository itself, so the default still resolves from a worktree. A checkout
that is missing, at another revision, or carrying uncommitted changes skips the
suite and reports which, rather than passing on nothing.

`oracle/extract.mjs` loads Zotero's pdf.js source directly: `oracle/register.mjs`
supplies the three module aliases its webpack build would, and the extractor
stubs the browser globals its rendering modules touch. No pdf.js build step is
involved. `oracle/fingerprint.mjs` prints a Structured Character for comparison
and both sides import it, so one field can never be compared under two
spellings. The page-label document shim stays duplicated between the extractor
and `src/page-label.ts` on purpose: a shared shim would put the port on both
sides of the comparison.

## Two oracles, not one

- **Zotero's modules** decide the Page Labels, which the test compares page
  for page. The Structured Characters come from the checkout's own
  extraction and are the input of both sides, so the test does not compare
  them.
  The reader's own `selection.js` decides the text ranges: `src/text-selection.ts`
  gets the same Structured Characters, and the test compares the rectangles,
  the text and the highlight-to-characters lookup range for range. Vitest loads
  that module straight from the checkout.
- **The Fixture's own `sortIndex` strings** on Attachment `RGRPDF24` are what
  Zotero's reader wrote for real Annotations of all six types. They check the
  line grouping and the offset against output this package took no part in
  producing. The Annotations on the other Attachments
  carry reviewed anchors instead, so they are not an oracle.

## Where the characters come from

pdf.js-zotlit carries Zotero's per-glyph extraction, so a host hands the port
its characters in Zotero's shape, and the parity test feeds Zotero's own
records to the line grouping. The byte-identity case proves the vendored
`structure.js`. ZotLit reads the fork's records through
`readerPageSource` in `packages/annotations/src/obsidian/pdf-annotation-editor/text-structure.ts`.
The End-to-end Run case E-1 in `packages/e2e/src/paired-run.e2e.ts` checks the
result against Zotero: a highlight made in the ZotLit PDF Reader gets the Sort
Index and Page Label that Zotero's own reader computes for it.
