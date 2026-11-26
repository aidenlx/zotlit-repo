---
status: accepted
---

# Runtime zones are checked by the module graph

## Context

ZotLit code loads in runtimes that give different capabilities: a Web Worker gives none, an Obsidian Mobile renderer gives the DOM and the `obsidian` module, the desktop Worker gives Node, and the desktop renderer gives all of them with Electron. A file is correct when its import closure, and the globals and members that the closure uses, need only what its runtime gives.

Lint kept this rule with lists of module names: a host module pattern in the shared configuration and layer lists in each layered package's configuration ([ADR 0109](0109-lint-and-test-tooling-enforces-repository-boundaries.md)). A name pattern blocked a host-free module whose name ended in `obsidian`, and the correction let a real Obsidian module through. The lists read direct imports only, and a new host-bound module was unguarded until a person added its name.

The layers of [ADR 0087](0087-the-plugin-base-is-three-layered-packages.md) are a line: host-free, Obsidian, desktop. Code that needs Node and no Obsidian has no place on a line, so the Worker's query job sat in a desktop layer. The Node-free host of [ADR 0094](0094-a-host-composes-features-on-the-plugin-shell.md) was a type program only. ZotLit Reader and ZotLit will load on Obsidian Mobile, so the Mobile runtimes get real roots.

## Decision

- **Four zones, each a set of capabilities.** Worker (none), host-free (DOM), Obsidian (DOM and `obsidian`), desktop (all). A zone reaches a zone whose capabilities it includes. "Host-free" keeps its meaning: it names no host module and may use the DOM. Only the Worker zone is free of the DOM.
- **A module states its zone one time.** A layer folder (`core`, `obsidian`, `desktop`, `worker`) states it for a layered package. The `zotlit.layer` field of the manifest states it for a package without layer folders, and the `zotlit.layers` field maps other layer folders of one package, such as the Zotero reads package's `contract` and `client`, to their zones. Test support is a test file, a `__fixtures__` folder or file, a `__mocks__` folder, or a package whose `zotlit.layer` is `test-support`. For a file, a test-support path comes first, then a package's `zotlit.layers` entry for its `src/` folder, then the shared layer folder, then the package's `zotlit.layer`. Each workspace file that a zone program reaches has a zone or is test support, and reach to a workspace file without a zone is a violation. A package-level zone is the zone of the files that plugin code loads from that package. A Node tool folder of the package that no zone program reaches is outside the check. A package whose plugin-loaded files and Node tool files sit in the same folder moves the plugin-loaded files into a layer folder. A file above its package's zone moves to a folder that states its zone. The platform modules (`obsidian`, Electron, the Electron remote module, and `@effect/platform-node`, which needs Node) are the only name list, and the runtime table holds it.
- **The runtime check follows resolved imports.** It builds one TypeScript program for each zone and reads the compiler's explanation of each file and its diagnostics. A file of a zone that the checked zone cannot reach, a test-support file or a platform module is a violation, and the explanation gives the import chain. The diagnostics show the reach that adds no file to the program: a platform module that does not resolve from the package, and a module augmentation. Type-only imports and module augmentations count as reach. The Worker zone compiles without the DOM library. The check runs in `pnpm lint` and `pnpm verify`. A second call (`checkRoot`) checks the closure of named root files against a zone: the Node-free host is test support by its path and composes test stubs, so a root check follows test support and fails on reach to a higher zone or a platform module that the zone lacks.
- **Lint rules on the file own Node.** The rule against Node built-in imports stays in each zone without Node, and a restricted-globals rule covers `process`, `Buffer` and `require`. The import rule is a rule of the repository's own lint plugin, because the stock rule cannot carry a message that names the runtime. The Node typings declare the built-ins as ambient modules and enter each program through a dependency, so a file list does not show them.
- **The bundle check owns each built root.** One runtime table gives each runtime its permitted external modules and resolve conditions. One function holds the desktop plugin, ZotLit Reader, the Worker and a Mobile host bundle to it. This is the guard for npm dependencies and for the value edges of the Worker root.
- **A desktop-only capability is a service.** A member of the Obsidian API that exists only on desktop, such as the vault path on disk, is a service tag that only a desktop Layer supplies. A Node-free host lists a stand-in for each one it lacks.

## Considered Options

- **One package for each layer.** The package manager's dependency rules would enforce the layers. Nine packages become 27 and about 4,300 import specifiers change, which reverses ADRs 0088 to 0093. It gives no zone for Node without Obsidian, and it does not see Electron, Node built-ins, globals or members.
- **The bundle check alone.** It reads the real module graph of each root, but it reports after a build and covers only code that a root reaches. The zone check reports for each file, with the chain, before any root exists.
- **A value-edge graph from a parser and a resolver.** It would let type-only imports pass. The Worker and host-free zones had no type-only import of a higher zone, and a signature that names a host type moves the dependency to each caller, so the stricter rule costs nothing and the compiler supplies the graph.

## Consequences

- A new module is guarded from its first commit, and its name has no effect.
- The type closure of the desktop Worker root holds Obsidian-zone files through type-only edges. The zone check on the Worker zone and the bundle check on the Worker root guard the Worker.
- A stand-in for a desktop-only service fails when Mobile code reads it, at run time. The Node-free host's list of stand-ins is the record of what Mobile lacks.
- The host-free layers use helpers that Obsidian installs on DOM globals and that need no import. They stay in host-free code and the Worker zone check keeps them out of Worker code.
- The zone check proves reach, and the Mobile bundle proves that the Obsidian values load without Node. A Mobile Worker root waits for a database client that needs no Node.
