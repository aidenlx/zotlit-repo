---
status: accepted
---

# The shared base of the Obsidian plugin is three layered packages

## Context

`apps/obsidian` is being divided into packages, so that three plugins (desktop ZotLit, ZotLit Reader, ZotLit Mobile) can be thin hosts over one code base. A package cannot import the app, so the division starts at the bottom: `src/lib` (121 files), `src/components` (16 files) and the generated Message facade, which 385 imports read. 59 of the app's 66 units formed one folder-level dependency cycle, and most of them met in `lib`. Six `lib`/`components` files imported services by value, and eight imported service types. A mobile host has no Node and no Electron.

## Decision

- **Three layers, by what the host provides.** A layer imports only the layers below it.
  - `@zotlit/plugin-kernel`: code that imports no `obsidian`, `electron` or `node:*` (the Effect wrappers and helpers, the log, pure utilities, constants). It also holds the `effectEntry` Vite plugin (`@zotlit/plugin-kernel/vite`), because the wrappers it resolves to live there.
  - `@zotlit/obsidian-kit`: code over the `obsidian` API that loads on Obsidian Mobile (the capability tags, the shared components, view atoms and runners, notices, menus). It also holds the Obsidian test mock, the Vitest setup and a Vitest preset, which every package that tests Obsidian code reads.
  - `@zotlit/obsidian-desktop`: code that needs `node:*` or `electron` and that more than one unit uses. It is a package, not a folder of the app, because the desktop and Reader plugins both need it and a mobile host leaves it out.
- **The Message facade is `@zotlit/plugin-messages`.** Its `generate:language-packs` task writes `generated/` with declared Turbo inputs and outputs. The app's Vite build writes the same folder.
- **A file that one unit uses lives in that unit.** 52 of the 137 files moved into an app unit, not into a package.
- **No upward import.** A file that read a service moved to the unit that owns the concept, or was split so the shared part moved down. `ViewServiceRegistry` is an open interface in the kit; the app adds its services by declaration merging.
- **Lint holds the layers.** The kernel takes the engine boundary rules (`engineBoundaryRules`, `import/no-nodejs-modules`) and refuses the two upper layers. The kit refuses `node:*`, `electron`, `@zotlit/db/client/node` and the desktop layer. The app's custom lint plugins moved to `@zotlit/config`, and one preset (`oxlint-plugin-code.ts`) gives the app and the three packages the same plugin rules. `pnpm review` covers the three package sources, because their code ships in the plugin.
- **Names.** "Kernel" and "kit" name no domain concept, so they do not collide with the Obsidian Plugin glossary. The packages use that glossary's vocabulary and have no glossary of their own.

## Considered options

- **One package for the kernel and the Obsidian layer.** Rejected: a mobile or worker consumer of the host-free code would load the `obsidian` module, and lint could not hold the host-free boundary.
- **The facade inside the kit.** Rejected: the kernel reads messages too, and it sits below the kit.
- **Desktop-only code stays in the app.** Rejected for the shared files: the Reader plugin needs them without the app.

## Consequences

- The folder-level cycle drops from 59 units to 51. `lib` and `components` leave it, and six services that only met it through `lib` leave it too.
- A file whose top level reads an Obsidian global (`activeWindow`, `activeDocument`, `createEl`) belongs in the kit, even when it imports no `obsidian` module.
- Every package that bundles plugin code passes its source folder to `effectEntry` as a scope; code outside the scopes gets the real `effect` package.
