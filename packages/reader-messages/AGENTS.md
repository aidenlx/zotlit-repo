# @zotlit/reader-messages

The generated Message facade and Language Packs of ZotLit Reader: the Reader's subset of `messages/{locale}.json`. `@zotlit/reader-feature` imports `m.*` from `@zotlit/reader-messages/messages.ts`.

`generate:language-packs` (`scripts/generate-language-packs.ts`) compiles the subset into `generated/`, which is gitignored. `scripts/language-pack-options.ts` names the subset: the include prefixes and the Included Messages. Turbo runs the task before every Reader build, typecheck and test, and caches it on its declared inputs. The Reader's Vite build regenerates the same folder at build start. Run `/inlang-i18n` for the message format and the runtime.

The shared packages (`plugin-shell`, `plugin-services`, `obsidian-kit`) import `@zotlit/plugin-messages/*` and type-check against ZotLit's facade. The Reader's Vite build and Vitest resolve that specifier to this package's `generated/`, so the Reader's `main.js` holds one runtime and one base pack. When shared code that the Reader bundles calls a Message outside the subset, the Reader's build fails on the missing export: add the Message's prefix or bundle ID to `scripts/language-pack-options.ts`.
