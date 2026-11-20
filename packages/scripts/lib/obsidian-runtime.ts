export const OBSIDIAN_RUNTIME_VERSION = "1.15.1";

export const missingObsidianRuntime = (path: string) =>
  `No extracted Obsidian ${OBSIDIAN_RUNTIME_VERSION} runtime at ${path}. Run: mise run init`;
