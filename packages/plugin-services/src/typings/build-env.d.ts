// The build constants these services read. Every bundler config of a plugin
// host replaces them with `define` (apps/obsidian/vite.config.ts).

let __DEV__: boolean;
let __LANGUAGE_PACK_DEV_SERVER__: string | undefined;
