# @zotlit/annotations

Reading and annotating in Obsidian: the Annotation Repository and the annotation model, the surfaces in the ZotLit PDF Reader (Annotation Marks, the Mark Popup, the Creation Toolbar, Mark Landing), Excerpt Images, the Annotation View's cards and the Annotations Layout, Reader Sessions, and Open Targets with File Link Capture. The desktop plugin composes it. ZotLit Reader ships the ZotLit PDF Reader; this package adds its surfaces to the Reader's view through `@zotlit/reader-api`, and opens a PDF in Obsidian's own PDF view while no compatible Reader is connected. The terms are defined in the Obsidian Plugin glossary (`apps/obsidian/GLOSSARY.md`, "Annotation view").

The package imports no other feature. A capability of another feature comes in as a port that the host fills: `AnnotationNoteActions` (`obsidian/annot-view/note-actions.ts`) inserts an Annotation into a note and renders its citation, and the notes feature provides its layer. `@zotlit/query-views` holds the sidebar Annotation View, which shows the cards in a Query View (`desktop/annot-view/`).

## Layers

Each layer has one folder of `src/` and one lint boundary (`oxlint.config.ts`). A file sits in the layer of what it needs from its host; a layer imports the layers below it: core ← obsidian ← desktop.

- `core/` — host-free: no Node built-in, `obsidian`, `electron`, Obsidian kit, or client and desktop layers of ZoteroReads and the platform services. Pure models and helpers: the Reader Session, lock rules, card selection, comment formatting, the excerpt pixel formats.
- `obsidian/` — loads on Obsidian Mobile: the Obsidian API, the kit, the ZoteroReads client and the platform services' Obsidian layer, and no Node or Electron. The Annotation Repository (`annotation-repository/`) and its model, the connection to ZotLit Reader (`reader-connection/`: the handshake and the connection state, connected, absent or incompatible), the open through it (`pdf-reader/service.ts`) and the viewer policy that chooses the view for each PDF open (`pdf-reader/viewer.ts`, ADR 0117), the PDF reader surfaces (`pdf-annotation-editor/`, a ReaderExtension that the Reader's `addExtension` takes), the reader settings slice, the excerpt tags and shapes, and the card primitives of the Annotation View.
- `desktop/` — Node and Electron: the excerpt cache key (`excerpt-image/key.ts`, SHA-256), the excerpt renderer's service layer and cache files, the Excerpt Image display, note excerpts, Open Targets (`attachment-open/`, `file://` links), and the card actions and Annotations Layout, which copy through Electron's clipboard.
- `__fixtures__/` — test support, one folder or file per unit. `settings.ts` and `view-atoms.ts` hold this package's own slices and view services; a fixture that a host's tests also use takes the host's view services from its caller (`annot-view/host.ts`).

Each unit registers itself: a service tag adds itself to `ViewServiceRegistry`, the reader slice (`obsidian/pdf-annotation-editor/settings.ts`) adds its keys to `SettingsRegistry`, and a file that raises a menu adds its event to `ZotLitMenuEvents` (`@zotlit/obsidian-kit/menu-events.ts`). The host composes the reader slice into its settings definition.

## Build integration

The Annotation View card stylesheet (`src/desktop/annot-view/style.css`) is imported by the host that registers the view.

## Tests

From this package directory, `pnpm exec vitest run src/<layer>/<unit>/<file>.test.ts` runs one file. The suites run in Node, with `obsidian` resolved to the mock of `@zotlit/obsidian-kit/vitest`. The browser trials of the excerpt images (`*.browser-test.ts`) run in an Electron renderer when `ZOTLIT_TEST_ELECTRON_PATH` names one, and skip otherwise. The minimized-window queue trial (`queue-chromium.test.ts`) also asks the Paint Check (`@zotlit/scripts/desktop-paint`, `packages/e2e/AGENTS.md`) and skips, naming the cause, while the desktop cannot paint a window, such as a locked screen.

## Feature

`src/obsidian/feature.ts` exports `annotations`, the part of the package's contribution that loads on every Obsidian: the service groups, registrations, settings slices, setting rows and `obsidian://` handlers whose code is in `core/` and `obsidian/`. `src/desktop/feature.ts` extends it (`extendFeature`) with the desktop parts, and a desktop host lists that value (`packages/plugin-shell/AGENTS.md` → A feature). Add a service, a registration, a settings page or a link to the value of the layer its code is in. It reads ports that other features fill: `AnnotationNoteActions` (notes), `AnnotationViewReveal` and `PdfTargetReader` (query views), and `ShowInLibrary` (library view). `desktop/__fixtures__/reader-host.ts` composes it with the platform alone, over stubs for those ports, and `desktop/reader-host.test.ts` builds that graph.
