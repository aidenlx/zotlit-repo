// The build constants these services read. Every bundler config of a plugin
// host replaces them with `define` (apps/obsidian/vite.config.ts).

let __DEV__: boolean;
let __LANGUAGE_PACK_DEV_SERVER__: string | undefined;
/** The Chinese Segmenter download the host's build pinned. */
let __CHINESE_SEGMENTER__: import("#core/managed-binary/pin.ts").BinaryPin;
