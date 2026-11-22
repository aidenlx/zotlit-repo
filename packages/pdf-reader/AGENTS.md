# @zotlit/pdf-reader

The PDF reader engine and UI, with an Obsidian adapter. ZotLit Reader bundles this package; ZotLit adds annotation features through `@zotlit/reader-api` instead of making the reader depend on Zotero.

## Boundaries and owners

- `src/core/` uses `ReaderHost` (`src/core/host.ts`) for host capabilities. Keep Obsidian and ZotLit domain imports in their adapters; `oxlint.config.ts` enforces the core boundary.
- `src/obsidian/register.ts` owns registration, view opening, takeover and extension attachment. `@zotlit/reader-feature` connects that registration to the plugin shell.
- `@zotlit/reader-api` owns the contract shared by separately bundled plugins. Change that contract there when an extension needs a new capability.
- `@zotlit/pdfjs` owns the vendored engine and its provenance. Change the fork and vendor it there before regenerating this package's embedded assets.

## Generated files and checks

`src/generated/` comes from the scripts in `build/`: embedded assets, strings, pdf.js build data and CSS. Edit their inputs. `turbo.json` wires generation before tests and typechecks; use the root scoped commands so those dependencies run.

The `*.test.ts` files include Node tests and hosts for the shared `*.browser-test.ts` cases. Read the host test before selecting a browser case: a browser-test file is not a standalone Vitest entry.
