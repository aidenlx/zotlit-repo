# Locales ship as interpreted data packs, not Paraglide-emitted code

Community-plugin review forbids remote code and bundling every locale grows
`main.js` for all users, yet `project.inlang/` and the Inlang message format
must stay the authoring source of truth. We therefore replace Paraglide's
emitted runtime with a ZotLit-owned build-time compiler (reading the project
through `@inlang/sdk`) that emits typed message wrappers, a bundled English
pack, and one pure-data JSON Language Pack per other locale, executed by a
small eval-free interpreter in the plugin; non-English packs are downloaded
only on explicit user consent from a rolling GitHub release and applied after
restart.

## Considered Options

- **Paraglide locale modules, fetched remotely** — still delivers executable
  JavaScript; fails the review constraint.
- **Bundle every locale** — the `feat/i18n` experiment branch does this with
  an ICU/`use-intl` runtime; rejected as the shipping design because bundle
  size scales with locale count and the authoring model would leave Inlang.
  That branch remains reference material for build integration only.
- **i18next / ICU runtime with dynamic JSON** — loads data fine but migrates
  the message format and authoring workflow.
- **Per-locale plugin builds** — avoids remote anything but multiplies
  distribution artifacts and loses runtime locale selection.

## Consequences

- The compiler and interpreter are owned code, maintained against their own
  contract tests once the one-time Paraglide parity gate is deleted.
- Translations update only with plugin releases; there is no independent
  translation release channel and no version pointer — the pack cache is
  keyed by plugin version, so an update triggers one refetch per device.
- The rolling release named here is superseded by ADR 0019 (via ADR 0018): each
  plugin release now has its own Resource Release carrying the Language Pack
  assets. The rest of this decision — remote, consent-gated, eval-free data
  packs — stands.

## Compiling the Obsidian plugin's Language Packs

The package at `packages/plugin-messages` provides one facade and one set of
Language Packs for the main ZotLit plugin. Generation for local setup, Turbo,
Vitest, and the release uses the same prefix rules as the Vite build. Vitest
also compiles before test imports when invoked directly, so it reads current
Messages after a merge or a catalog edit.

The site's, Companion's, and Reader's namespaces normally go to their own
hosts. The main plugin includes Workbench Messages, exposes those Messages as
a scoped object where the Workbench needs one, and includes the Companion
labels quoted by the live-updates descriptions. It bundles the Language Pack
lifecycle copy because it has to display that copy before a Language Pack
exists.

## Compiler and runtime contract

The checked-in bin entry lets pnpm link the command at install time.
Node runs the TypeScript CLI directly. The command compiles once. The
Vite plugin watches the project settings and discovered catalogs,
excludes the output directory from its watcher, and keeps the loopback
pack server available between watch builds. The watcher owns its close.

The compiler uses installed Inlang plugins and clears CDN module entries
from the in-memory settings. It compiles a shared message representation
before emitting the Obsidian artifacts. The Companion also uses that
representation for Fluent output. The compiler names the ambient plugin
declarations explicitly because consumers check the compiler source
under their own TypeScript configuration.

The base locale alone defines the wrapper's input contract. A translation
can omit a Message or use fewer inputs. Missing translations fall back
per Message. A translation using an undeclared input is dropped and
reported, and a Message absent from the base has no wrapper. The compiler
follows references through local declarations to identify a locale's
inputs. It rejects incompatible declarations that the Inlang plugin
merged under the same name. Numeric selectors and input narrowing use
the runtime's literal rule. Unsafe integers and numeric prefixes outside
the accepted decimal spelling stay literal. Case-specific usage of
number and datetime formatters informs types without narrowing beyond a
safe input contract.

An Included Message overrides prefix selection. Its dotted ID can use a
safe local binding and a literal export name. Namespace files re-export
Messages under their own prefixes. The empty facade keeps a runtime
import so its shape stays consistent. The generator checks identifier
names, and the runtime imports must also have distinct bindings.
[Renderer binding follow-up](https://github.com/aidenlx/zotlit-repo/issues/69)

Locale and artifact ordering uses code point comparison so the emitted
bytes are deterministic across environments. Packs use compact JSON
because they have a byte cap. The runtime rejects schema mismatches
and validates the message grammar within the pack limits. It
distinguishes a newer schema, which needs a plugin update, from an
artifact this build cannot read. Its datetime formatter accepts epoch
milliseconds and ISO 8601 strings. Runtime diagnostics go to the
consumer's logger and fallback logging is limited to one event per
Message ID.

When project loading fails, the compiler rereads source catalogs from
the settings so it can still attach a source position. Normal diagnostics
use the source catalog and shared error-positioning path. Nested catalog
keys become dotted IDs, while arrays stay intact as complex Messages.
The writer skips writes with identical bytes to preserve timestamps.
Cleanup should remove old artifacts that the compiler owns.
[Namespace cleanup follow-up](https://github.com/aidenlx/zotlit-repo/issues/70)

Compiler tests load the generated modules through Vite and assert their
rendered text. Catalog tests bind the generated object to the type used
by the lifecycle. Temporary Inlang projects use installed plugins and
stay outside the repository. Fixtures remove their temporary directories
when the test completes.

## Obsidian build checks

The host integration suite reads the generated runtime artifact, alongside compiler unit tests in the i18n package. The runtime refuses packs above its size cap. When another host adds a group of messages, exclude that prefix from the Obsidian pack if Obsidian never reads it. The bundled lifecycle subset supplies the active locale before a pack is installed, including offline use. Messages outside its configured prefixes use the ordinary fallback ladder.

## Documentation links

Choose the docs edition from Obsidian's current language. Obsidian's `zh`
opens the `/zh-CN` edition even without an installed Language Pack.
Other languages open the English edition. Keep this host lookup out of the
shared constants imported by workers. [Documentation URL builder](../../packages/obsidian-kit/src/docs-url.ts)
