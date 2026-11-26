---
status: accepted
---

# Lint and test tooling enforces repository boundaries

## Formatting and build inputs

- Oxfmt selects the nearest configuration. A nested configuration with its own ignore patterns includes those from `packages/config/oxfmt.base.ts`. The shared list covers agent skills synced from upstream, whose hashes are in `skills-lock.json`. Markdown code blocks keep their original formatting because the docs quote source and output.
- `zotlit-build/no-undeclared-env` parses the workspace imports and re-exports of the Obsidian Vite configuration. It checks environment reads for each Turbo task that builds the plugin so a changed input changes the cache key. An assignment with `=` writes the value. GitHub authentication tokens are also exempt. The rule factory accepts a small module graph and task configuration for its tests.
- `zotlit-build/no-app-path` keeps a package buildable without its host. It checks source imports and stylesheet paths in `@import`, `@reference`, and `@source`. Feature packages read the shared Obsidian Kit theme. Each host names its own sources. [ADR 0094](0094-a-host-composes-features-on-the-plugin-shell.md)
- Shared Oxlint configuration uses absolute plugin paths so a nested configuration can load them from its own directory. An override of `no-restricted-imports` supplies the complete list of applicable restrictions because it replaces the base entry. Test baseline overrides apply to configurations that load the rule's plugin and resolve their paths from the consumer configuration.

## Shared TypeScript rules

- Node runs the workspace TypeScript directly. Relative imports name their extensions so Node can resolve each file. Engine packages also run in Mobile Web Workers, so they take host capabilities as values. Node-only scripts, tests, and named adapters can import Node built-ins.
- Obsidian mounts views, modals, and panes as separate Preact roots. Preact `useId` counts within a root. A window can contain more than one root, so UI code takes ids from the shared `useUniqueId` helper.
- Effect uses `DateTime` and `Clock`. Code outside Effect uses Temporal. A library that takes or supplies a `Date` converts it in its adapter. This keeps the instant, zone, and serialized value consistent at the boundary. The shared configuration disables rules that only support Effect v3. It allows an `unknown` error at Promise boundaries and in helpers that accept any Effect.
- `zotlit-effect-style/no-tacit` requires explicit callback parameters. A direct function reference can receive a value, index, or AbortSignal in an optional parameter that has another meaning. Explicit callbacks also preserve overload inference and stack call sites. The rule's combinator lists follow the installed Effect declarations. Thunks, callable orderings, callback wrappers, and arguments that accept both values and callbacks are outside those lists. The rule recognizes inline options after the callback for listed combinators. [Named options follow-up](https://github.com/aidenlx/zotlit-repo/issues/51)
- The tracker-reference rule keeps tracker ids out of comments and test names. It recognizes ZotLit tracker URLs and qualified ids, plus bare two-to-five-digit numbers that start with a nonzero digit. These limits keep common color values out of the check. It skips code spans so they can show literal examples.

## Obsidian host and UI rules

Tailwind v4 expands `prefix(zt)` into the class prefix. The variant builder and class merger take the bare `zt` prefix so both use the same spelling.

- Oxlint uses the same Obsidian rule names as the release scanner. It reports `no-global-this` without the scanner's autofix because a worker has no `window`. The Obsidian global restrictions use a separate rule so they can run with the repository's `Date` restrictions. [ADR 0020](0020-obsidian-guideline-review-runs-on-eslint-at-release.md)
- A typed optional member in `packages/obsidian-kit/src/typings/obsidian-ex.d.ts` gives consumers one private API declaration. Each consumer can check availability before calling it. An ad hoc cast hides the API from the other consumers and their type checks.
- The layer that opens a popover, menu, or dialog pushes an Obsidian Scope. The innermost Scope handles the key first. Key handlers can still inspect the control that received the event. The check reads static selector lists, including top-level string constants.
- Pop-out windows own their DOM constructors, timers, and observers. A global `instanceof HTMLElement` can reject an element from another window. Obsidian's `instanceOf` uses the element's window. The same window owns cleanup of its timers. The main window's `ResizeObserver` did not report elements from a pop-out in Obsidian 1.14.5.
- A menu's unregistered section follows the registered sections, below Delete. The rule requires a section identifier from the list the menu registered.
- The Workbench uses its shared kit for chrome so a component update reaches every surface. Annotation cards use logical directions, grid reading order, accessible tooltips, and a text scale and line height that keep clamped text readable. Targeted transitions keep layout properties out of the animation. The CSS rule reads declarations with PostCSS so selectors, strings, and comments cannot act as declarations. Its valid fixture includes a real CSS comment to test that boundary.
- Host wrappers own Obsidian's control classes because those classes carry host behavior and change with Obsidian releases. React form rows own their DOM through JSX, so the imperative Obsidian `Setting` builder belongs outside those trees. The lint rules examine ordinary words and widget prefixes only when used as CSS classes.

## Effect services and tests

- A type-only bridge import marks an interoperation boundary. Log-only use of Effect also leaves a plain module plain. The checks apply scoped service rules when a module runs Effect workflows beyond logging. A test double and a benchmark can run without the full Obsidian runtime. Benchmarks read wall time to measure actual duration.
- Effect service tag ids name their module and service because the ids also appear in spans and logs. A layer owns its resources and listeners through its Scope. The lint check examines the Effect generator's own body because a nested callback can own a separate lifetime. A plain caller can own an explicit unsubscribe for a per-call observer.
- ZoteroReads establishes the worker transport pattern. Effect RPC supplies typed operations, typed errors, cancellation, and a worker lifetime bound to the layer. Legacy event emitters stay on the conversion backlog so new services and test fakes use streams for occurrences and a SubscriptionRef for changing state.
- Capability errors use tags and codes because error messages can contain platform-specific paths, localized text, or wording that changes between Obsidian versions. An Effect failure boundary uses `hasInterruptsOnly` because a cause with both a failure and an interrupt still needs error handling. The shared Scope helper keeps release checks consistent.
- Plugin Effects run through a runtime or a scoped runner so they get the plugin's services, logger, and lifetime. A captured context alone cannot stop pending work on unload. Each plugin logger applies its own level, annotations, and spans, and writes to its own destinations. The worker log port and logger console sink implement the output boundary. The log port reports a failure to post a record on the console, because it cannot log its own post failure through Effect without recursing, so its file is exempt from the global console rule.
- Use `@effect/vitest` for Effect workflows and TestClock to drive their time. `it.live` covers real external asynchronous work. A Promise boundary can drive its own ManagedRuntime. Typed test fakes let the compiler report shape changes, and stubService identifies a missing member at the read. Test notices through the Notifier so the real producer remains under test. The cast rule reports the outermost cast once.
- Each package's Vitest workers share CPU with other Turbo tasks. The hosted release has a longer test timeout because it runs the package suites on limited CPU. Turbo passes `GITHUB_ACTIONS` to the test task. Test discovery excludes scratch files so temporary probes stay outside the suites. [ADR 0077](0077-desktop-admission-is-an-exclusive-slot-plus-a-memory-gate.md) records Memory Gate admission.
- Markup or class reads reaching a unit assertion can pin presentation. A selection used to act on an element is a valid test input. Fixtures supply data. Tests read the real module and place mocks at process, network, and OS boundaries. External snapshot size uses a separate check because Oxlint sees inline snapshots. The async assertion rule permits a stored rejection expectation that the test awaits later.
- An End-to-end Run serializes its page callback into another window. The callback gets page globals, context, and explicit arguments, so it cannot use bindings from the test module. Type-only references disappear before serialization. The scope visitor uses the TypeScript reference flag when the reference exposes it. A nested normal function can own its receiver. An arrow inherits its receiver.
- A poll timeout includes its description and last value. Let that error fail the test so its diagnostics survive. The typed transport preserves the value returned by the page. Tests compare that value directly. A test can also compare text read from a DOM attribute.

- `useUniqueId` uses a module counter and is client-only. Server rendering and hydration count separately. Prerendered Workbench markup can obtain its container names through `useContainerName` instead.
- The library log sink is local to the JavaScript realm. The host installs it, and records sent before installation are dropped. The worker record supplies a category for the plugin bridge. The DevTools console formatter escapes percent signs in user-controlled fields so those fields cannot consume its format arguments.
- CSS fixture content, third-party attribution, and tool directives stay in the baseline when their presence serves a tool or test. The Reader's DOM integration tests select happy-dom only for those files. The PDF Reader's file-level JSX directives select Preact for consumers that compile its source. The reader feature's lint directive permits an empty interface body because declaration merging extends the shared settings registry with the slice.

The shared Nano Events port uses dash-case event names to match DOM conventions
and distinguish names from methods. The emitter returns an unsubscribe handle.
Its one-shot listener removes itself before invoking the callback to handle
emission from inside that callback. Other nested dispatches can still visit the
wrapper from an earlier listener array. [One-shot listener follow-up](https://github.com/aidenlx/zotlit-repo/issues/53)

The plugin shell's Vitest configuration runs plugin modules through the renderer wrappers. It aliases the types-only Obsidian import to the runtime test stand-in and supplies the plugin build constants. The cards load React through the Preact alias. Load `@effect/atom-react` through Vite too so it uses the same alias and the same runtime as the cards.

The kernel exercises the Effect run entry points directly to catch missing renderer redirection, lost AbortSignals, and lost context overrides. Its Vitest wrapper provides the runtime references to ordinary, parameterized, modified, and nested layer tests while keeping the upstream test services. Native wrapper modules have a matching lint exception. The clock adapter has an exception at the boundary between Effect's Clock and plain Temporal code.

Controlled event fixtures flush runnable deliveries when they publish. Tests wait for a separate completion signal if a handler does asynchronous work. Bounded assertion polls yield to a fiber or a browser task and keep the last assertion failure. The fetch fixture gives Effect's HTTP client a test transport, so a thrown exception simulates failure to connect and any returned status simulates a server response. The service stub returns undefined for symbols and `then` so probing it for an iterator or Promise does not look like a missing service member.

## Workspace install constraints

Obsidian and both Workbench hosts need the same CodeMirror class
identities, so the workspace overrides the shared CodeMirror versions.
The opt-in video clone is a workspace member when present. Its empty
lockfile importer allows frozen installs with or without the clone.

The workspace holds new registry versions for three days to reduce
exposure to a compromised release. Two transitive overrides force
patched fast-uri under ajv and patched nanoid under postcss.
The Hono exemption allowed an immediate security update. The
Obsidian scanner exemption lets a release apply new review rules
the day they ship. The scanner is release tooling and is outside
the published plugin.

[fast-uri advisory](https://github.com/advisories/GHSA-7p8r-x3mc-p8w7)
[nanoid advisory](https://github.com/advisories/GHSA-2v37-7h3g-55p8)
[Hono advisory](https://github.com/advisories/GHSA-8j4g-w8fx-2239)

## TypeScript host programs

The application, test, and tooling programs configure Effect lint at
the file's own tsconfig. The Obsidian app and test programs use the same
Effect options and allow the unstable platform APIs used for worker RPC,
HTTP, file sweeps, and tests. The inferred span option lets
`effect-fn-opportunity` suggest a span name derived from the service
tag and method. Workbench Local Bridge clients and tests allow Effect
HTTP because the bridge uses that client. Obsidian lint tests load the
TypeScript rule sources through their file extensions.

The mobile host program checks the Mobile entry point separately and
includes its asset and host declarations. Some dependency declarations
still bring Node types into that program. The mobile check therefore
examines the compiler's source list for desktop code.

The Obsidian program targets the Electron and Chromium host, and the
Companion targets the Firefox 140 ESR host used by Zotero 9 and 10,
with a disposable polyfill. The Companion's checker also needs Temporal declarations
for the DB source it reads. Its own runtime does not use Temporal.
The PDF structure parity test needs those declarations for the Fixture
Spec. The docs program includes the regular expression API for
`RegExp.escape`, Temporal for Managed Frontmatter, and `Error.isError`
for the Workbench code it reads. The Workbench page supplies a Temporal
polyfill when the browser lacks it. The docs build's Node program
supports JSX for Takumi's Open Graph rendering.

The comment ratchet reads JSON scanner token identifiers at runtime.
The parser's TypeScript declaration exposes them as an ambient const
enum, which the workspace's verbatim module syntax cannot import.

## Pinned maintenance templates

The Diagnosing Bugs and Wizard shell templates match the v1.3.1 upstream skill blobs recorded by `skills-lock.json`. Keep the pinned copies reproducible when auditing local comments. Make changes to a working copy of a template when using it, and take fixes to the pinned template through a source update. The same rule covers every upstream skill copy that `skills-lock.json` records by hash, such as Skill Creator, as the amendment "lock-recorded upstream skills are fixed upstream" states.

The diagnostic loop pauses for a human action and then prints captured observations as key-value pairs for the agent. Use the action prompt for sign-in and reserve printed captures for observations. The Wizard keeps a reusable helper section above the authoring marker. It avoids clearing piped output, offers previously saved values as defaults, and separates visible from hidden entry. It lets a human configure values during the procedure and reports actions that still need manual work. The 2026-11-23 amendment records two upstream Wizard defects. [Environment update defect](https://github.com/aidenlx/zotlit-repo/issues/77) · [GitHub write message](https://github.com/aidenlx/zotlit-repo/issues/78)

The template engine's Date lint exceptions cover conversions at the LiquidJS date filter and template output boundary. A template can return a JavaScript Date from its data or from user-authored code. Coerce it at the adapter before writing its output.

The ZoteroReads worker, launch, and client transport adapters own RPC worker creation, shutdown, and log transport. The package grants these entry points the low-level worker exception. The desktop integrity checker still has a transport migration open. The worker's citation budget clock and three legacy Effect suites also retain temporary lint exceptions. [Integrity transport](https://github.com/aidenlx/zotlit-repo/issues/88) · [Citation clock](https://github.com/aidenlx/zotlit-repo/issues/89) · [Effect tests](https://github.com/aidenlx/zotlit-repo/issues/90)

## Desktop build and test boundaries

Node runs the host build scripts straight from source, so those scripts avoid the app's alias and runtime imports. The host and scripts share Managed Binary pin types through the dependency-free core contract. The mobile compiler program has a separate file-set check to detect imports from a desktop layer or Node-only host package. The lint rule tests can import the local rules they exercise. The desktop Item Query RPC tests still have a scoped Effect Vitest migration. [Item Query test runtime](https://github.com/aidenlx/zotlit-repo/issues/99)

The test config replaces the types-only Obsidian package at runtime and stubs the canvas-based Pretext measurement. Host tests supply worker ports through service layers rather than fetching embedded scripts. Pin fixtures prevent the config from fetching binaries online. Keep suite selection on the Vitest projects because array fields from the shared Vite config are concatenated. Project selection also gives the citation suites their custom DOM environment. Inline the listed React dependencies so Vite applies its Preact alias.

The citation tests that run the real Pandoc WASM restore Node's Response, Blob, and File in their happy-dom environment. Streaming WASM checks the native Response brand. A DOM Blob passed into the Node response can be coerced to text. Use a separate benchmark config so the Vitest project includes do not bring ordinary tests into long-running benchmark grids.

## Lint rule fixtures

The date tests invoke the Oxlint binary because the date restrictions include built-in rules. RuleTester runs plugin rules. Effect combinator rules classify callback positions by the imported combinator and call shape, including an optional options object, data-first calls, and names imported through aliases or namespaces. Tests keep value arguments, such as a context tag or a data-first receiver, distinct from callbacks. A zero-argument thunk has no parameter binding to inspect.

Time restrictions apply to virtual Effect cases. Fixture setup and live tests own real time. The runtime rule recognizes Effect's own run functions and accepts a test that drives a Promise boundary through its runtime. The Notifier mocking rule targets the legacy notice module and permits the Notifier seam. The literal-cast rule leaves service assembly to the service-stub rule when both could report the same cast.

A release callback owns its own body. Plain callers can return a disposal stack or an unsubscribe, while putting cleanup in an Effect generator does not execute it. Synchronous runners finish before plugin unload can interrupt them. A type-only import of an Effect API still marks an Effect module, with a specific exception for a type-only import of the bridge. The rules also recognize the plugin packages' Effect helper modules. In Effect code, use Clock for the current time and DateTime for Effect time values. Plain code uses Temporal. The clock-option check resolves local options types and applies the layer restriction in service source. Consumers and fixtures read the same retained service contract.

## Repository entry points and exclusions

Knip checks exports, types, and enum members against the baseline in `packages/scripts/unused-code.json`. An internal reference suffices to keep the symbol. The plugin source exports map does not make every export a consumer, so check entry exports in those workspaces. Mark embedded workers, Effect entry wrappers, and the standalone docs walk and clip programs as entry points because their consumers load them dynamically or through build configuration. The copied shadcn components retain their full APIs. The excerpt renderer's host stubs stand in for modules aliased by browser trials. The test wrapper mirrors the upstream Effect Vitest exports, and generated message facades expose the full catalog. Disable automatic loading of the Zotero Vite serve config and the database Drizzle config because each needs a machine-local environment file.

The closest Oxfmt config owns its subtree. Keep Fixture vault notes out of formatting because end-to-end tests read them verbatim. Allow the lint rule's own fixtures to contain the patterns they test. Root release scripts can import manifest helpers across workspace boundaries while remaining subject to the date restriction. Walkthrough tests should use a behavioral or semantic assertion before the whole-file CSS class waiver can be removed. [Walkthrough waiver follow-up](https://github.com/aidenlx/zotlit-repo/issues/102)

## Local reference tools

The screenshot helper constrains encoded WebP output to the 512 KiB prefix the docs image-size reader can inspect. The CSS reference checker defaults to the latest extracted build with `app.css` and scans `app.js` as well because the runtime can set custom properties from script.

The archive tools take an explicit runtime ASAR and use repository dependencies. The version probe reads the internal package manifest into memory to avoid overwriting a file in the current directory. For extraction, require the runtime's `app.js` to distinguish the runtime archive from the launcher. Derive the default destination from the version in that archive so a formatted build can be traced to its source. Format top-level bundles for line-based inspection and keep vendored libraries unformatted. Write only the destination to stdout so callers can read it as a path. A force refresh is intended to replace a prior extraction. The current `app.js` ownership test can also match an unrelated directory. [Extraction follow-up](https://github.com/aidenlx/zotlit-repo/issues/101)

## Docs app tooling

The docs lint keeps the framework-neutral image restriction from the Next.js rule set. React's `useId` is permitted because its server and client ids agree during hydration. TanStack Router uses thrown objects for redirects and missing routes, so source permits those signals. Native Date is confined to the publication helpers and interfaces that take Date, including the feed and Fumadocs timestamps. The installed Workerd runtime with the site's compatibility settings has no global Temporal. Node code generators read TypeScript source directly and use import paths that do not rely on the app's bundler alias.

Docs unit tests load the collection macro and compile-time metadata in a separate Vite config because they do not need the Cloudflare or Start plugins. The test runtime uses same-origin recording paths like the development server.

Media tests use Happy DOM for DOM rendering and substitute the missing viewport and playback timing at the browser boundary. The observer fake sends its initial and threshold-crossing entries in queued tasks and models vertical root margins, including percentage margins. Positions exercise the playback band and the still-visible edge outside it. The media fixture defers play and pause events after updating the element state, since the Happy DOM calls emit synchronously. To exercise non-looping playback it supplies the terminal pause and ended events and clears ended on replay. Wait for the queued tasks before asserting on playback.

Test the locale controls in a URL locale and with an English fallback body. The missing-translation test hydrates fragment-free server HTML while the browser retains a cold navigation's hash. It checks that the offered action preserves query and hash, bypasses outgoing locale rewriting, and does not navigate on render. Test Markdown flow children with their source line breaks because the block renderer receives those breaks around the action label.

The lesson and recording suites reset modules between cases because the playback turn is module state. They mount the real views while using the browser media and observer boundary for placement, media events, and ended playback. The lesson suite controls viewport width, saved ticks, reduced motion, and StrictMode to exercise the production paths, including a scroll that moves the outcome through the playback band while an opened row starts below it. Check the media handoff when a step ends and the player focus when its Replay button disappears. Check that pausing the waiting table demo keeps it rested after a manually paused clip leaves view. Parse the prerendered lesson to verify that the outcome still gets priority and later step stills stay lazy.

Locale tests compare the native prerender list to the public route loaders, exercise the default search index, and read the compiled table of contents to check that original incoming fragments still work. The tree's root name supplies the first breadcrumb in search. Verify reciprocal native alternates and the English fallback across HTML and Markdown aliases, head tags, and structured breadcrumb output. Missing Chinese files must remain searchable through their English bodies without becoming native Chinese assets. Run the actual head script in the DOM test to check Chinese-first detection, including Traditional Chinese, and the effect of an explicit English choice. Confusable language prefixes and Chinese listed after English do not trigger a suggestion.

The docs collection tests wait for Vite to register its watched paths before delivering a fixture event. The Chinese inventory test adds a second translation while the first restart compiles, so it checks that the inventory eventually includes both changes. Catalog tests check names in authored MDX directly because those component calls need a docs build for ordinary generated-message validation. The first-commit test isolates Git from machine configuration such as signing and checks that edits and moves retain the original publication day.

The content title and description checks apply the site's 60 and 160 limits and keep reader-facing titles distinct. Approximate CJK width as two Latin glyphs, including CJK punctuation and full-width forms. FAQ structured data must match the visible Questions section, identified by its stable anchor in translation. Compare the heading and plain answer text with inline formatting removed. The Markdown index checks its docs prefix and the following lessons independently. Check that a page's search title replaces its short sidebar title in its own edition and inventory, that related guide titles come from the locale edition, and that old empty anchors remain an HTML-only compatibility aid.

Check that Chinese lessons retain the original course order, media, and numbered steps with one check per step. Related docs destinations must exist and linked how-to guides link back to their lesson before the first section. Answer pages have no reciprocal-guide requirement. Media tests build disposable input folders and use binary fixture headers so they check parsing independently of the actual recordings, including the version 0 MP4 track dimensions in 16.16 form.

Media-store tests use two known video hashes calculated independently of the uploader. The S3 stub reports presence for HEAD and stores PUT bodies. Build a minimal client entry that exposes the media URL map, then check those URLs against the keys the uploader generates.

## Web Workbench host tests

Mount the actual Workbench in the test harness so its page effects run. Supply the bridge transport, tab storage, and optional rendering and clock layers at their service boundaries. Replace storage and reset the viewport between cases because they share a browser environment. Happy DOM has no layout engine, so supply the Workbench frame dimensions through its ResizeObserver boundary and let the real page measure and place the panels.

Advance fake timers and settle dynamic imports inside React's `act` so the debounce callbacks and their React updates finish together. Check the assertion before advancing time, then double each time step up to the remaining timeout to limit the number of flushes. Use a static annotation fixture that calls the format for every annotation to exercise grouped annotation output.

Simulate pointer presses in the panel tests with pointer and mouse events, the focus transfer, then release and click in a later task. Check the expanded state for a field list row because the row previews list values in both states. Run concurrent server renders in separate locales to verify shared controls use each request's locale.

### Library View tests

Build the Library View settings fixtures from the slices that the tests read. A test supplies its own migrations when it exercises old plugin data. Layer the unread service stubs first so a controlled service can replace one. The stub fails if the test starts reading an unprovided member.

Use an in-memory query fixture to isolate Library View behavior. It delegates ordinary predicates to the Item seed evaluator and supplies explicit fixture answers for Attachment and Annotation conditions because a seed has no children. The fake returns bounded Annotation previews and leaves the live Annotation Card query to engine and integration coverage. Keep the worker search's fixture rank different from the list order so the test detects a missed reorder. Inline the React dependencies that must pass through Vite's Preact alias, and provide a Pretext stand-in for the test DOM without canvas.

The Library View's lint-waiver follow-up tracks the direct workspace accesses and Nano Events fixtures that still trigger reports. [Issue 148](https://github.com/aidenlx/zotlit-repo/issues/148)

The Annotation View's own More options button creates the same menu sections and emits the same leaf-menu event as the Obsidian header. The section order was checked against `ItemView.onMoreOptions` in Obsidian 1.14.4.

### Query Views

Enforce the import direction from desktop code to Obsidian code to host-free code. Core owns Query File data and planning. The Obsidian layer can load on mobile. Desktop owns the Item Query adapter, CLI, and desktop surfaces. Check casts at the private Obsidian API boundary and let its tests supply fake Apps. The Query Views lint follow-up records the confirmed capability, clock, event, and styling reports. [Issue 152](https://github.com/aidenlx/zotlit-repo/issues/152)

The Query View fixture uses the real query layer over controlled worker reads. Decode CLI fixtures at the renderer, then pass them through the worker codec. Cut fake results to the requested Projection Paths so a missing request field produces a test failure. Supply unread service stubs first to fill the view registry, then merge the services a test uses.

Alias the types-only Obsidian package to the test host. Inline the React dependencies that need the same Preact transform as the view. Use placeholder Managed Binary metadata for tests that do not exercise pin resolution. Replace Pretext's canvas measurement in the test DOM with fixed character widths so tests can check line wrapping. The long-list End-to-end Run checks real heights in Obsidian. Run the multi-minute Query Views benchmarks with their own config.

Drive the Query View tests through the host. Simulate performance-independent events such as the repository reporting an Annotation before the database can query it, the host returning the saved text, and a menu loading its key Scope on a later task. Dispatch `focusout` for a React blur test. Exercise both `isComposing` and Chromium's key code 229 so the editor leaves the input method's keys alone. Replace ResizeObserver from the destination window when testing a pop-out. A fake with an infallible Effect signature can use a defect to exercise the host's failure notice.

Restore changed Template settings through Effect finalization in a test. The generator's JavaScript finally block can be skipped when a yielded Effect fails.

## Obsidian Kit lint and Vitest setup

Let capability adapters read the App members they expose. Let the shared
control wrappers apply native Obsidian classes so consumers can use the
wrappers. The popover adapter alone wraps the native popover. The Vitest setup
implements the cross-window instance helper and can use `instanceof` there.
Background disposal can use the main window's timers because it follows the
plugin lifetime. Window-local work follows the element's own window.
[Obsidian Kit lint config](../../packages/obsidian-kit/oxlint.config.ts)

Use the runtime stand-in for the types-only Obsidian package, and supply the
build constants from the plugin tests. Inline the Effect React integration so
Vite applies the Preact alias. Resolve each workspace source directory from
the package manifest URL in the caller's resolution context.
[Vitest config](../../packages/obsidian-kit/vitest.config.ts) · [Vitest preset](../../packages/obsidian-kit/vitest.preset.ts)

Give Node tests the browser-style window alias so window-qualified timers
work. Start the active window and document on the main window, and install
prototype helpers only when the DOM exists. The helpers model Obsidian's
`enhance.js` from 1.13.4, with the option keys ZotLit uses. Window migration
tests supply their own event source. Approximate visibility through ancestor
display because happy-dom does not perform layout. Model the idle callback
with a macrotask for the Page Label pass and supply a font event target where
the test DOM has no FontFaceSet. [Vitest setup](../../packages/obsidian-kit/vitest.setup.js)

### Obsidian runtime stand-in

Use the stand-in for the host behavior a test needs. Search uses
case-insensitive terms or ordered characters, with contiguous and earlier
matches ranked higher in the fuzzy mock. Keep the native tooltip attributes
and timer helpers. Expose the CodeMirror fields and extensions so tests can
exercise their presence, and use ordinary missing-field results in editorless
tests. Stub only the element methods a notice needs when no DOM is present.
The view and Component classes support native type checks, listener release,
and unloading a post-processor's render child. The external file convention
uses an absolute path after `file:`. Keep WorkspaceLeaf prototype methods
available for the production state hooks.

The TextFileView stand-in models callback and saved-baseline ordering. Use a
real app to verify native three-way merging. Properties scanning follows
Obsidian's opening and closing fence rules and keeps the last line break of
the YAML text. Use a DOM environment for markup and highlighted search
matches. The mock parses HTML into a fragment without sanitizing it. Check
sanitization in the native runtime, which applies DOMPurify. The suggestion
shell can use a minimal element stand-in for tests without a DOM.

Record commands by ID so tests can invoke their handlers. Desktop is the
default Platform. Change flags through the fixture setter to mirror the
host's read-only flags. Version checks pass so tests can exercise the
current surface. Use an explicit debouncer flush instead of timers so a
Settings write can proceed without fake time.

Record dialogs and their rows so a test can inspect a native control without
a production return value. Use native elements in DOM tests and row stubs
elsewhere. Support both grouped settings rows and directly built controls.
Dispose a rendered row with its native cleanup callback. Drive controls
through fixture actions. Disabled entries refuse selection. Text-input
focus and key helpers are inert because a test enters values through
`type()`. Graph option listeners read the stored value and publish changes
when called with a value. An icon action exposes its identity through its
tooltip. [Obsidian runtime mock](../../packages/obsidian-kit/src/__mocks__/obsidian.ts)

### Plugin Services lint and test edges

Allow the frontmatter date adapter to read Date because Obsidian's YAML
parser can supply one. Permit the Settings runner to start fibers directly
because it registers every fiber with the tab layer's Scope through
`onFiberStart`. The tab Scope then owns their cleanup. [Plugin Services lint config](../../packages/plugin-services/oxlint.config.ts)

The plugin hosts inject the pinned Chinese Segmenter download as a build
constant. Supply the matching constants in tests and resolve host values
through the Obsidian mock. Apply the Preact alias to the view atom runtime.
Keep benchmark discovery in a separate Vitest configuration and let the
benchmark set its case timeout. [Vitest config](../../packages/plugin-services/vitest.config.ts) · [Benchmark config](../../packages/plugin-services/vitest.bench.config.ts)

Workbench panes access their document controller through `controller`
or a property by that name. The Workbench rule checks both call shapes
for direct source slicing. The document positions count CRLF as one
character, so use the controller's slice or the normalized document.
[Workbench lint rule](../../packages/workbench/src/lint/oxlint-plugin.ts)

Run Workbench UI tests under both React and Preact. The Preact project
uses the plugin's import aliases and inlines the atom adapter so its
React import follows the alias. Declare each project's inclusion pattern
on that project because a root pattern merges in and widens the scan.
Direct Vitest runs regenerate the shared catalog artifacts when their
inputs are newer. The English fixture uses the production pack
interpreter. The catalog generator and message files supply the types.

Apply the keyboard lint policy to Workbench because its Obsidian
adapter owns the native key scope. The document source slicing rule
exempts tests that read their own LF fixtures.
[Workbench Vitest config](../../packages/workbench/vitest.config.ts) · [Message setup](../../packages/workbench/scripts/message-types-setup.ts) · [Workbench lint config](../../packages/workbench/oxlint.config.ts)

The shared Workbench test host records adapter calls, holds render
responses until the test chooses when they land, and can hold other
host requests to observe cancellation. Its disposable mount owns the
editor and registry. Simulated nested Fields popovers preserve the
outside-click boundary and record focus restoration.
[Workbench test host](../../packages/workbench/src/ui/test-host.tsx)

For Properties drag tests, supply the drag event properties the
browser exposes because Preact checks them before it binds handlers.
Provide row dimensions for the drop position because happy-dom does
not perform layout. Workbench form tests mount panes as separate
roots and verify label targeting without relying on simulated focus.
[Properties tests](../../packages/workbench/src/ui/properties-tab.test.tsx) · [Form tests](../../packages/workbench/src/ui/name-folder.test.tsx)

The Template Workbench CLI fixture supplies real service tags and
defaults to stubs that throw when a test reads an unprovided member.
Individual tests can replace those ports. The Template Data handle
uses the test's Vault and FileManager and closes with its stack.
[CLI fixture](../../packages/template-workbench/src/__fixtures__/cli.ts)

### Workbench CLI fixtures

Run inspection cases that drive Template reconciliation with Vitest fake
timers at the Promise boundary. The window debounce uses those timers, and
Effect cases use the Effect test clock. In check fixtures, keep the Template
root non-iterable while retaining strict access for other values. In the data
fixture, close the service before the database and supply the FileManager
attachment-folder lookup when a resolved note requires it. Cover configured
attachment folders without a note path to verify that earlier excerpt-image
imports can still resolve.

[Inspection tests](../../packages/template-workbench/src/desktop/cli/inspect.test.ts) ·
[Data tests](../../packages/template-workbench/src/desktop/cli/data.test.ts)

In the Workbench editor extension tests, close the attached code pane
before restoring the window-migration stub.

[Editor tests](../../packages/template-workbench/src/obsidian/editor/editor-extension.test.ts)

### End-to-end callback and bundle boundaries

Preserve native syntax for page functions serialized with `toString()`.
Lowering `await using` can inject module helpers that are absent in the
receiving window. Test the function with the same transform used by the
desktop run and verify that type stripping leaves it executable on its
own. Use a type-only import for callback context and pass JSON arguments.
Allow undefined for a side-effect-only callback. Use compile-time cases
to verify invalid inputs. A service stub that returns an Effect uses the
plugin's own Effect module. Drive Node promise timers explicitly in
transport tests because they retain their original timer when globals
are faked.

Use the shared bounded CLI client and put the vault token first to route
each call. Allow a longer deadline for a single measurement. Read the
last eval-prefixed response because console logs share the stream. Wrap
thrown values with the application stack, which Obsidian's CLI does not
supply by itself. Registered command output is raw text. During polling,
retry a missing reply or a malformed response from a window that is
still starting. Report the last answer and the requested condition on
exhaustion. Read services from the current plugin after a reload.

Reject a missing or stale dev bundle on a direct Vitest run. Root
`pnpm e2e` builds first. Check Git-visible, existing source files of the
plugin and its bundled workspace dependencies. Exclude benchmark and
test files because they do not enter the bundle. Ordinary unit tests
use the shared Memory Gate and run without Obsidian.

Use handwritten Match trees to exercise the same document boundary as
an external edit. In the picker, wait for rows or the slow-answer
loading row before showing the list and backdrop, so no empty frame
appears.

[Page transform](../../packages/e2e/page-transform.ts) ·
[Transport](../../packages/e2e/src/obsidian-cli.ts) ·
[Bundle freshness](../../packages/e2e/src/bundle-freshness.ts)

The held Annotation Card preparation probe uses the installed Effect
module to create a compatible value for the plugin.

[Preparation probe](../../packages/e2e/src/annotation-preparation.ts)

The pre-commit tree guard runs before format and lint. Type-aware lint reads workspace source and message catalogs from disk. Lefthook hides unstaged hunks of staged files, but files with only unstaged changes and untracked files can still affect lint. The guard checks Git status once and reports those inputs so the lint result describes the commit.

### Verification tool inputs

Count both marker lines in the 600-line limit for each external snapshot entry. This limit accommodates deliberate contract snapshots such as the documentation package-swap tree while rejecting full catalog dumps. Whole-output snapshots pin the structure of unrelated data and make test changes harder to review.

The test gate discovers package Vitest and Node runs plus the desktop End-to-end Run and the root runtime evaluation. Resolve each Vite configuration without starting a Vitest server. Load a project's separate extends file and merge the inline fields over it. Match files with Vitest's installed glob engine, including dotfiles, configured roots, and include and exclude sets. The test-policy baseline carries exemptions across Git renames and still reads the former flat format. Seed a rule once and compare later entries with the merge base. A clone or branch without a prior baseline can only run the current-tree checks. The directive check drops optional suppression reasons, and the configuration check replaces comment spans with whitespace to preserve token boundaries. Use the parser from the shared lint configuration so both checks see the same syntax.

Check that the root Oxlint and Obsidian review task plans schedule the generators required by their typecheck scopes. The dry-run plan includes file inputs, so the test allocates a larger output buffer. Use GitHub's Oxlint formatter for CI annotations. The separate End-to-end Run stays outside the ordinary typecheck selection.

Scan production source and documentation for catalog message keys to limit translation work for unused copy. Catalogs, tests, generated output, and the End-to-end Run are outside that search. Match top-level keys directly and Companion keys by their Fluent IDs or their qualified catalog names. Check complete dotted tokens and their components to handle calls on the Message facade and Fluent attributes. The message and Knip baselines report new unused entries and entries that can be retired because code or catalogs changed. Read Knip's final JSON report line because the Vite configurations it loads can also write to stdout.

Workbench unit tests map the types-only Obsidian module to the runtime
stand-in. Route React imports through the Preact alias, including those
from Effect Atom React, which Vite must inline to use the same alias.
Permit raw source slices in tests that read their LF fixtures and set
the state they later check.

The remaining Workbench exceptions for direct Obsidian capability access
and raw Effect calls in tests have separate follow-ups.
[Capability access](https://github.com/aidenlx/zotlit-repo/issues/185) ·
[Effect Vitest](https://github.com/aidenlx/zotlit-repo/issues/186)

Two Plugin Services modules have a broad capability exemption for raw
Vault adapter access. Follow-up work covers their distinct uses.
[File logging](https://github.com/aidenlx/zotlit-repo/issues/176) ·
[Resource Pack URL](https://github.com/aidenlx/zotlit-repo/issues/187)

Keep Obsidian's Node tooling separate from plugin runtime imports.
Allow type-only imports across that seam. Put executable plugin
checks under src as Vitest tests.

Parse CSS declarations so selectors, comment bodies and string values
cannot produce design-rule findings. Select Effect service folders
within Notes, Template Workbench, Query Views and Library View, and
include the Customize service file. Knip excludes generated Lezer
term exports and recognizes Resource Pack browser cases as entries
because the Electron renderer suite bundles them.

The host import patterns are a proxy for the actual module graph.
A basename-style pattern matched host-free imports and an exception
could let real host modules through. The current pattern anchors
module names, while the follow-up covers dependency graph enforcement.
[Issue 121](https://github.com/aidenlx/zotlit-repo/issues/121)

## Amendment (2026-11-23): Wizard defects are fixed upstream

Two Wizard defects occur in the pinned template (v1.3.1) and on upstream main (v1.3.2). `write_env` can replace `.env` with only the new key when it cannot read the file. `set_secret` and `set_var` report "gh not ready" when GitHub refuses the write. The pinned copy stays identical to the blob that `skills-lock.json` records, and the fixes arrive with a source update.

Rejected: a local patch. It makes the lock hash wrong and moves the copy away from its pinned source.

The maintainer decided on 2026-11-23 that these defects belong upstream and closed both issues with no change. [Issue 77](https://github.com/aidenlx/zotlit-repo/issues/77) · [Issue 78](https://github.com/aidenlx/zotlit-repo/issues/78)

## Amendment (2026-11-23): lock-recorded upstream skills are fixed upstream

Skill Creator is an upstream copy that `skills-lock.json` records by hash. It tracks the main branch of `anthropics/skills`, and its files are identical to upstream main. The pinned-template rule of this ADR covers it, as it covers Diagnosing Bugs and Wizard: the copy stays identical to the source that the lock records, and fixes arrive with a source update. Three defects occur in the copy and on upstream main, and upstream has no fix for them:

- The review viewer sends SIGTERM to every process that holds its port before it binds, also to a process that is not a viewer.
- The description optimizer returns a rewrite longer than 1,024 characters after its one shorten call.
- The viewer shows "Saved" or the completion screen when the server answers a feedback save with an error, and offers no download.

Accepted limit: the review viewer can stop another local service that uses its port (3117 by default, or the `--port` value). Choose a free port when another service runs on it.

Rejected: a local patch. It makes the lock hash wrong and moves the copy away from its source.

The maintainer closed the three issues with no change on 2026-11-23, by the rule of the Wizard amendment above. These are maintainer tools, so researchers are not affected. [Issue 62](https://github.com/aidenlx/zotlit-repo/issues/62) · [Issue 63](https://github.com/aidenlx/zotlit-repo/issues/63) · [Issue 65](https://github.com/aidenlx/zotlit-repo/issues/65)
