# @zotlit/reader-api

The interop contract between ZotLit Reader (the provider) and a plugin that extends its PDF view (the client, ZotLit). Both plugins build against this package; each bundles its own copy of the two helpers. Spec: `@zotlit/reader-api` v1.

## What the package holds

- `src/index.ts`: the constants `READER_API` and `READER_CSS_PARTS`, the `ReaderApi` and `ConnectRequest` members, and the structural types that the members name.
- `src/connect.ts`: the event names `CONNECT_EVENT` and `READY_EVENT`, `connectReader` for the client and `answerConnect` for the Reader. Each returns its unsubscribe function.

## Boundary

The contract crosses between two plugins, each with its own Effect and Preact copy. Lint keeps `src/` to type imports of `obsidian` and relative files: no Effect, Node, Electron, Zotero or ZotLit module. `tsconfig.lib.json` has `types: []`, and `obsidian` is the only peer dependency. Values that cross are plain: functions, promises, plain objects, DOM nodes and Obsidian objects. A failure is a rejected promise whose error has a `reason` string.

## Structural types

Each type declares the members that a client reads today, in the shape that `@zotlit/pdf-reader` and the pdf.js fork declare them, so the Reader's own objects conform with no cast. A pdf.js member keeps the fork's declared type (`render` takes `canvas`). `RenderTask.onContinue` is `unknown`: a client writes it, pdf.js reads it.

## The handshake

1. The Reader calls `answerConnect(workspace, apiByMajor)` at load. It listens for `CONNECT_EVENT`, then triggers `READY_EVENT` once.
2. The client calls `connectReader(workspace, { client, major, minor }, handlers)`. It listens for `READY_EVENT`, then triggers `CONNECT_EVENT` with a `ConnectRequest`, and again on each `READY_EVENT`.
3. The Reader answers in the same call: `accept(api)` with the entry of `apiByMajor` for the request's major, else `refuse({ supported, readerVersion })`. Before a refusal it calls the `onRefuse(request)` option of `answerConnect`, so the Reader can log the request it refused.
4. The client calls `onAccept(api)` when `api.major` is its major and `api.minor` is at least its minor. Else it calls `onRefuse`, with `supported: [api.major]` for a minor that is too low. No answer when the trigger returns calls `onAbsent`.

A listener that throws does not stop the other side: Obsidian's `Events` calls each listener in turn and throws the error again from a timer.

## Versioning

- Major: a member goes or changes meaning, or a name in `READER_CSS_PARTS` is renamed or goes. Minor: a member is added.
- A new name in `READER_CSS_PARTS` is a minor change; a rename is a major change.
- Minor 1 adds the `onRefuse` option of `answerConnect`.
- Minor 2 adds the `root` part: the Reader's root element in every kind (tab, embed, hover, canvas).
- `apiByMajor` maps each supported major to an adapter of the current implementation. It holds N and N-1 for one release after a major change.
- `onRefuse` names the plugin to update: when `supported` holds the client's major, or only majors below it, update ZotLit Reader; when it holds only majors above it, update the client.

## Tests

`src/connect.test.ts` runs both helpers on one `Events` object of the obsidian stand-in (`@zotlit/obsidian-kit/vitest`).
