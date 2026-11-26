# @zotlit/obsidian-i18n

The Language Pack runtime and Message compiler. The package root is the runtime entry; `./compiler` and `./vite` are build-time entries. Keep Node filesystem and Inlang compiler dependencies behind those build entries so plugin runtime imports stay portable.

When changing the generated facade or pack format, read `src/compiler.ts`, `src/core/language-pack.ts`, `src/core/validation.ts` and their tests together. The compiler produces what the runtime validates and loads. Plugin catalog selection belongs to `@zotlit/plugin-messages` and `@zotlit/reader-messages`.

For authoring messages, use `/inlang-i18n`. This package compiles the Obsidian Language Packs; `@zotlit/paraglide-vite` owns the separate Paraglide/Vite lifecycle.
