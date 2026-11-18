# @zotlit/plugin-messages

The generated Message facade and Language Packs of the Obsidian plugin. Any package imports `m.*` from `@zotlit/plugin-messages/messages.ts` and the Language Pack runtime from `@zotlit/plugin-messages/runtime.ts`, with no import of the app.

`generate:language-packs` (`scripts/generate-language-packs.ts`) compiles `messages/{locale}.json` into `generated/`, which is gitignored. Turbo runs it before every typecheck and test that reads the facade, and caches it on its declared inputs. The app's Vite build regenerates the same folder at build start. Run `/inlang-i18n` for the message format and the runtime.
