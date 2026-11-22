---
status: accepted
---

# The Companion build stages two sandbox bundles

Zotero loads one bootstrap script and the Companion loads its main script through the sandbox script loader. Build each as its own IIFE since the IIFE library format produces one entry. The footer exposes the bootstrap hooks and the main constructor as top-level bindings. One Vite invocation runs the bootstrap build inside the main build's start hook, so both source trees can share a watcher. The inner build does not run in watch mode. [Bootstrap scope](0023-companion-hand-injects-chrome-only-where-zotero-offers-no-registry.md)

Clear staging at the start of each rebuild so removed assets and stale bundle files leave the XPI. Both bundles write after this cleanup. Register the static watch paths before the inner build so a save retries a failed bootstrap build. Add its emitted modules to the same watch graph and watch the canonical icon at its declared path outside the addon folder. Copy the addon assets and the icon into staging after the bundles write. The icon's staged path and manifest path share one builder so they agree.

The sandbox uses Firefox 140 ESR. The Companion's main bundle targets ES2023 so the bundler lowers explicit resource management for that host. The shared sandbox builder defaults to ES2022. Node scripts can use Temporal, and sandbox code is allowed to use Date. Add declarations for asset imports locally so the sandbox type project does not need the Vite client types.

Zotero reads literal default preferences from the XPI root. The build parses them as pref calls, checks key prefixes and duplicates, checks XHTML references, and generates `src/types/prefs.ts` from the declared keys. The generator sorts the keys so its result is stable. A production build reports a stale generated file after regenerating it. Fluent uses the same freshness check for its own type file. [Fluent generation](0053-companion-fluent-files-derive-from-the-inlang-project.md)
