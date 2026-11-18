declare module "*.css" {}

declare module "@zotlit/templates/defaults/*?raw" {
  const source: string;
  export default source;
}

/** The canonical logo SVGs of `assets/logo/`, as text. */
declare module "*.svg?raw" {
  const source: string;
  export default source;
}

declare module "*.yaml?raw" {
  const source: string;
  export default source;
}

/** Built by the `pandoc-filter-variants` Vite plugin, one variant per query. */
declare module "*.lua?raw" {
  const source: string;
  export default source;
}

declare module "*.lua?variant=cli" {
  const source: string;
  export default source;
}

declare module "*.lua?variant=sandbox" {
  const source: string;
  export default source;
}

/** The ZoteroReads worker bundle, built and embedded by the `embedded-worker` Vite plugin. */
declare module "virtual:zotero-reads-worker" {
  const source: string;
  export default source;
}

declare module "virtual:citation-parse-worker" {
  const source: string;
  export default source;
}

let __DEV__: boolean;
let __MIN_ELECTRON_VERSION__: string;
let __LANGUAGE_PACK_DEV_SERVER__: string | undefined;
let __PANDOC_ENGINE__: import("@/services/pandoc/pinned-engine.ts").PinnedPandocEngine;
/** The Chinese Segmenter download this build pinned; see `scripts/chinese-segmenter.ts`. */
let __CHINESE_SEGMENTER__: import("@zotlit/plugin-services/obsidian/managed-binary/service.ts").BinaryPin;
