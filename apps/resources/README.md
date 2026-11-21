# ZotLit Resource Pack

Data files that [ZotLit](https://github.com/aidenlx/zotlit) uses, in one plugin:

- The Pandoc engine, for the built-in export and for formatted citations and references.
- The Chinese word segmenter, for item search in Chinese.

Install the pack and ZotLit finds it. You do not need to turn it on.

## Licences

The pack redistributes each data file under its own licence. The licence text is in `main.js`.

- Pandoc engine: [Pandoc](https://github.com/jgm/pandoc) 3.10, GPL-2.0-or-later, as built for WebAssembly by [pandoc-wasm](https://github.com/pandoc/pandoc-wasm). The source code of this version is at <https://github.com/jgm/pandoc/tree/3.10>.
- Chinese word segmenter: [jieba-wasm](https://github.com/fengkx/jieba-wasm), MIT.

ZotLit and the plugin class of this pack are licensed under AGPL-3.0-or-later; see `LICENSE` and `NOTICE`.

The source code is in [aidenlx/zotlit-repo](https://github.com/aidenlx/zotlit-repo), under `apps/resources`.
