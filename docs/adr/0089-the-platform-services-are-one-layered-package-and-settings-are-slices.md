---
status: accepted
---

# The platform services are one layered package, and settings are slices

## Context

The shared base of the Obsidian plugin is three layered packages (ADR 0087), and ZoteroReads is its own package (ADR 0088). The services that every feature stands on still lived in `apps/obsidian`: settings, logging, the Language Pack, the Zotero preferences, the Local Server and Zotero Local API, the database actions, the Held Read client, Library Scope, the item search, the Note Index, the Use Ledger, the Managed Binaries, the Chinese Segmenter, the attachment resolver and Attachment Import. A package cannot import the app. The settings schema named the keys of every feature, so the settings service could not move without its features.

## Decision

- **One package, `@zotlit/plugin-services`, with three layer folders.** `core/` is host-free, `obsidian/` loads on Obsidian Mobile, `desktop/` reads Node and Electron. A layer imports only the layers below it. Lint (`no-restricted-imports`) holds each boundary.
- **A unit moves only when everything it imports is in a package.** A service that reads a feature stays in the app until that feature has its package (Item Query, the Local Bridge, attachment-open, the batch helpers).
- **Split a service whose tag and Node implementation share a file.** The tag goes to `core/`, the layer to `desktop/` (ZoteroPref, LocalServer).
- **Settings are slices.** Each owner keeps its keys, schemas and defaults beside its code (`settingsSlice`). `SettingsRegistry` types every key: the package registers its slices, and a host registers its feature slices by declaration merging. `PluginSettings` takes the composed `SettingsDefinition` and the migration hooks from the host. The host keeps the composition and the `data.json` migrations.
- **A helper that names feature keys is a function of that feature.** `updateDefaultLiteratureNoteProfileBindings` is a function of the Profile slice over `update`.
- **Each service registers itself in `ViewServiceRegistry`** in its own tag or atoms file.

## Considered options

- **One package per service.** Rejected: many small packages with the same boundaries; layer folders give the same lint with less configuration.
- **The full settings schema in the package.** Rejected: the package would name every feature key, and a feature could not own its settings.
- **A compatibility re-export in the app.** Rejected: two import paths for one module, and the app keeps its old shape.

## Consequences

- The largest folder-level value cycle drops from 46 units to 35. Eleven units leave it.
- A new feature key goes in the feature's slice and in the host's composition, not in the package.
- Every consumer that bundles plugin code passes the package source to `effectEntry` and to Tailwind `@source`.
