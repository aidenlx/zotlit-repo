// What the versions that downloaded the Managed Binaries left on a device:
// host-free, so the End-to-end Run reads the names too.

/** The folder of the origin's private file system that held the binaries. */
export const OLD_STORE_ROOT = "zotlit";

/** The binaries those versions downloaded; each had a folder of its name in the root. */
export const OLD_BINARY_IDS = ["chinese-segmenter", "pandoc-engine"] as const;

/** The vault's record of a dismissed install offer for the binary `id`. */
export const oldDeclinedKey = (id: (typeof OLD_BINARY_IDS)[number]): string =>
  `zotlit-${id}-declined`;

/** The vault's record that the cleanup of the old device data ran. */
export const OLD_STORE_CLEANUP_KEY = "zotlit-binary-download-removed";
