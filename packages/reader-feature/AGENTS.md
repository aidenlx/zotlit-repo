# @zotlit/reader-feature

The `reader` feature of ZotLit Reader (`apps/reader`): it mounts the ZotLit PDF Reader (`@zotlit/pdf-reader`) on the plugin shell, registers the view type `zotlit-pdf`, and turns on the PDF takeover. The terms are defined in `apps/reader/GLOSSARY.md`.

## Layer

One layer, `src/obsidian/`: the Obsidian API and the kit, no Node, no Electron, and no Zotero package. `oxlint.config.ts` enforces the boundary, so the feature loads on Obsidian Mobile and in a vault without ZotLit.

## Module resolution

The package exports its TypeScript source as `@zotlit/reader-feature/obsidian/<file>.ts`. Inside the package, import a file of the same folder by a relative path and any other file through the `#` subpath, with its extension.

## Feature

`src/obsidian/feature.ts` exports `reader`, made with `defineFeature` (`packages/plugin-shell/AGENTS.md` → A feature). It owns the settings slice `reader.open-all-pdfs` (`settings.ts`, on by default) and the Reader page with its row (`settings-page.ts`). Its `onload` calls `registerPdfReader` and sets the takeover from each change of that setting; an `"unavailable"` takeover shows the `reader_takeover_unavailable` notice. The reader's strings come from `@zotlit/reader-messages` (`strings.ts`, and `reader_*` Messages for the Reader's own texts).
