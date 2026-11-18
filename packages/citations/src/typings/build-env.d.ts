// The build constants the citations read. Every bundler config of a plugin
// host replaces them with `define` (apps/obsidian/vite.config.ts).

/** The Pandoc Engine download the host's build pinned. */
let __PANDOC_ENGINE__: import("#core/pandoc/pinned-engine.ts").PinnedPandocEngine;
