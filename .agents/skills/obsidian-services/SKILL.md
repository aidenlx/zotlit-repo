---
name: obsidian-services
description: |
  Service architecture for the Obsidian plugin: Effect services, the features that contribute them, and the plugin shell that
  composes them. Use when creating, modifying, or wiring a service or a feature, or editing the plugin lifecycle in
  packages/plugin-shell or apps/obsidian/src/zt-main.ts.
---

# Service Architecture

Every plugin service is an Effect service (see **Effect services**).

Use the source as the canonical reference. Do not copy service/runtime/plugin-shell snippets out of this skill; read the current implementation before editing so examples cannot drift from real code.

## Canonical Files

- `packages/plugin-shell/AGENTS.md`: the shell's layout, what a feature holds, and the order things start.
- `packages/plugin-shell/src/obsidian/feature.ts`: `defineFeature`, `serviceGroup`, `registration`, `protocolHandler`.
- `packages/plugin-shell/src/obsidian/compose.ts`: `defineHost`, `pluginGraph` and `featureServices`, the Effect graph derived from the features.
- `packages/plugin-shell/src/obsidian/runtime.ts`: `createShellRuntime` — builds the runtime over the graph on the caller's stack, awaits acquisition, then binds the runtime's `bridge`, the CLI runner and each feature's `handles`.
- `packages/plugin-shell/src/obsidian/plugin.ts`: `shellPlugin(host)`, the plugin class — `await using`, `stack.move()`, cleanup, and debug service access.
- `apps/obsidian/src/features.ts` and `host.ts`: the host's feature list, tab order, menu order and settings history. `zt-main.ts` extends `shellPlugin(host)`.
- A feature package's `src/desktop/feature.ts` (for example `packages/annotations/src/desktop/feature.ts`): its contribution.
- `packages/plugin-kernel/src/effect-layer.ts` and `effect-scope.ts`: where a runtime or Scope meets an `AsyncDisposableStack`.
- `packages/obsidian-kit/src/disposables.ts`: `Disposable` helpers for `stack.use(...)`.

## Workflow

1. Read `packages/plugin-shell/AGENTS.md`, then the `feature.ts` of the package that owns the service. Treat these as authoritative.
2. For a new service, create `<package>/src/<layer>/<service-name>/service.ts` as an Effect service (see **Effect services**) and add one `serviceGroup` to the owner's feature: its name, the tags it `provides`, and every tag it `requires` beyond the shell base. The type check names a read you left out. The shell places the group in build order from its tags.
3. For a layer that provides nothing (commands, CLI handlers, notices), add a `registration` to the feature.
4. When a view, a start-up hook or the End-to-end Run calls the service, read the tag once in the feature's `handles` (`read(Tag)`) and call it through the runtime's `bridge`. Another feature reads those values through `ctx.handlesOf(feature)`.
5. When a service needs something another feature fills, read a tag the reading package owns, and give the other feature a group that provides it. When no feature fills it, `defineHost` in `apps/obsidian/src/host.ts` fails to type-check and names it under `missingServices`.
6. For a new feature, export it with `defineFeature` from the package's `feature.ts`, add the package to `apps/obsidian/package.json`, and place it in `apps/obsidian/src/features.ts`. Place its tab entries in `host.ts` → `settingTab` and its menu segments in `fileMenu` / `folderMenu`. Vite, Vitest and ESLint read the plugin package list from `@zotlit/scripts/plugin-packages`, which follows the host's dependencies; add the package's `src` to the `@source` lines of `apps/obsidian/src/zt-main.css` and to the `//#review:plugin` inputs in `turbo.json`, which `pnpm lint:plugin-packages` checks.
7. Pass `plugin`, `plugin.app`, and the values a registration needs explicitly through deps objects. Avoid module-global service lookups.
8. Run the typecheck of the package and of `@zotlit/obsidian` after edits (`turbo run typecheck --filter=...`).

## Effect services

New services are Effect services: a `Context.Service` tag and a scoped `Layer`, contributed as a feature's `serviceGroup`. `createShellRuntime` builds the graph as a `ManagedRuntime` from `buildRuntime` (`@zotlit/plugin-kernel/effect-layer.ts`), whose disposal sits under everything the plugin shell puts on the stack, so the graph closes after the last shell registration. Settings and logging build below every other layer, so a service logs from its first line. `UseLedger` (`packages/plugin-services/src/obsidian/use-ledger/`) is the converted example; its `__fixtures__.ts` builds its layer over a fake App for tests.

- Import Effect from `effect`; the `effectEntry` Vite plugin (`packages/plugin-kernel/scripts/effect-entry.ts`) resolves it to `packages/plugin-kernel/src/effect.ts`. Its run entry points carry the browser scheduler and the logger, and no graph service.
- The tag shape is Effect-native: each method with arguments is `Effect.fn("<Tag>.<method>")`, a generator or a body that returns an `Effect` (`Effect.fnUntraced` on a per-message or per-item hot path; a test double stays a plain function). A member with no arguments is a `readonly` `Effect` value traced with `Effect.withSpan("<Tag>.<member>")`, and callers write `yield* service.refresh`, not `service.refresh()` (`effecttsgo/lazy-effect` reports a zero-argument method); its test double is an Effect value too. Events are Streams and state:
  - What others watch is a `SubscriptionRef`, exposed as `SubscriptionRef.changes(ref)`: it replays the current value and ends when the layer's finalizer runs `PubSub.shutdown(ref.pubsub)`. A stream that ends on a terminal state adds `Stream.takeUntil`.
  - A discrete occurrence is a `PubSub` exposed as a Stream.
  - A condition a late subscriber must still see (stopped, failed, finished) is state.
- Export the layer beside the tag as `layer<Name>` (a function when it takes plain inputs).
- The plugin shell and edge handles hold the tag's service and the runtime's `bridge` (`EffectBridge`, `@zotlit/plugin-kernel/effect-bridge.ts`). A feature's `handles` reads the service once (`release: read(Release)`); consumers type their deps as `Pick<Release["Service"], …>` beside `Pick<EffectBridge, …>` and run each call through the bridge: `runSync`, `runPromise`, `runPromiseExit` (interrupted at unload, for a caller with its own closed answer), `subscribe(stream, callback)`. A fire-and-forget `void bridge.runPromise(…)` runs an Effect that cannot fail.
- A state machine with concurrency of its own is Effect code in its layer, not a class: the Zotero Local API session (`zotero-local-api/session.ts`, `makeLocalApiSession`) keeps its state in `Ref`s, shares one request in flight between its callers through a slot, as the Capability Probe does, queues work per key with a `Semaphore`, forks background work on the layer's Scope so that closing the Scope interrupts and awaits it, bounds a request with `Effect.timeoutOrElse`, reads time from the `Clock`, and cancels by interruption. A large state machine that coordinates none of that is Effect functions over one state record that its layer builds: the Annotation Repository core (`annotation-repository/core/`) takes the `CoreState` as its first parameter, `yield*`s the services the record holds (`ZoteroLocalApi["Service"]`, `ZoteroReads["Service"]`, `QueryClients["Service"]`), and publishes its events through a callback the layer turns into Streams. The layer's members `yield*` the core functions. Callbacks that a library calls (TanStack Query read and mutation functions) and the `Disposable` that `hold` answers are its edges, and run through `scopedBridge`, the bridge over the layer's own Scope.
- A layer reads the events of an Obsidian source that has a capability tag from the tag: `forkEach(filterTag(metadata.changes, "changed"), …)` for `MetadataCache` (`@zotlit/obsidian-kit/obsidian-metadata-cache.ts`). A capability tag registers its listeners through `obsidianEventSource` (`@zotlit/obsidian-kit/obsidian-event-source.ts`); the pattern is in `apps/obsidian/policies/events.md` → Capability tags. A layer registers events from a source with no tag yet (`vault`, `workspace`, and one-shots such as `onLayoutReady`) through `obsidianEvents` (`@zotlit/obsidian-kit/effect-obsidian-events.ts`). Any other Obsidian callback a layer registers runs its Effect through a runner made from the layer's context: `const run = Effect.runSyncWith(yield* Effect.context<never>())`. It keeps the layer's services and Clock, which the bare entry points lack.
- Obsidian's `App` is the `ObsidianApp` tag (`@zotlit/obsidian-kit/obsidian-app.ts`). Time is the Effect `Clock`, and dates in Effect code are `DateTime`; `@zotlit/plugin-kernel/effect-clock.ts` converts them to the `Temporal.Instant` of plain code (`toInstant`, `fromInstant`, `instantClock`).
- Resources live on the layer's Scope: `Effect.acquireRelease`, `Effect.addFinalizer`, and `acquireDisposable` / `acquireAsyncDisposable` for a value from outside Effect (root `policies/resource-disposal.md` → Effect code).
- Put a side effect behind a tag of its own when a test must replace it. `LogOutput` is the pattern: `layerLogging` drives LogTape through it, and its test supplies a fake whose work takes `TestClock` time.
- An Effect service has no `ready`: the layer has finished building before anyone holds it.
- `createShellRuntime` awaits the layer graph (`runtime.context()`) before it reads any service, so a service anyone holds has finished acquiring. A layer's acquisition waits for exactly what its first answer needs, and no more. A wait on outside I/O (the Zotero database, a worker) is bounded with `startupBarrier` (`@zotlit/plugin-kernel/effect-startup.ts`), which keeps the read running on the Scope past the bound. Acquisition settles and never fails the layer. A failed read becomes held state, logged with its fallback (`UseLedger`'s saved Uses), because a layer that fails stops the plugin.
- The `zotlit-services` lint rules (`packages/config/oxlint-plugin-services.ts`) enforce the mechanical rules.
- A test fake of a service keeps its type: root `policies/testing-strategy.md` → Service fakes holds the pattern.
- A view reads Effect services through view atoms, and its plain code (an Obsidian callback, a menu item) runs Effects on the leaf's view runner (`packages/obsidian-kit/src/view-runner.ts`), made in the view's constructor and interrupted when the leaf closes: `apps/obsidian/docs/adr/0082-obsidian-views-read-effect-services-through-view-atoms.md` holds the pattern catalogue, the pitfalls and the migration steps. A service a view reads joins `ViewServices` in `packages/obsidian-kit/src/view-atoms.ts`.

## Plugin Shell Notes

- Keep `zt-main.ts` to what differs per host: the preflight check and the installer notice. The lifecycle, the runtime and unload live in `packages/plugin-shell`.
- A feature's `onload` registers views, editor suggests and ribbon icons, and answers its menu segments. Hooks run in host feature order after the graph built.
- Do not treat the plugin `services` getter as normal dependency access. It is an escape hatch/debug surface; services receive deps through their layer, and start-up hooks through the `FeatureContext`.
- Wire Obsidian views by closure-capturing the needed services in the `registerView` factory.
- Compose with plain objects and functions; service wiring takes no Obsidian `Component` subclass, DI library or other runtime dependency.
