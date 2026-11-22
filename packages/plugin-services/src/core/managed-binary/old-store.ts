export const OLD_STORE_ROOT = "zotlit";

export const OLD_BINARY_IDS = ["chinese-segmenter", "pandoc-engine"] as const;

export const oldDeclinedKey = (id: (typeof OLD_BINARY_IDS)[number]): string =>
  `zotlit-${id}-declined`;

export const OLD_STORE_CLEANUP_KEY = "zotlit-binary-download-removed";
