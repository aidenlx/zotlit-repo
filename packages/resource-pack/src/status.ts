// Where a binary of the Resource Pack stands for the plugin that reads it.
// The realm that reads the Pack Entry and starts the binary states it; it
// crosses to another realm as a plain value.
import type { PackFailure } from "#format.ts";

/** Where a binary stands. Each arm but `ready` names the one step that mends it. */
export type PackBinaryStatus =
  /** Obsidian lists no Resource Pack: install it. */
  | { readonly kind: "pack-absent" }
  /** The pack is older than this plugin reads, or lacks the entry: update the pack. */
  | { readonly kind: "pack-outdated" }
  /** The pack is newer than this plugin reads: update the plugin. */
  | { readonly kind: "plugin-outdated" }
  /** The pack file is not what its index states: install the pack again. */
  | { readonly kind: "pack-damaged" }
  /** The pack of `version` holds the verified binary. */
  | { readonly kind: "ready"; readonly version: string }
  /** The verified binary did not start. */
  | { readonly kind: "failed"; readonly detail: string };

/** A status in which the pack gives no binary that runs. */
export type PackBinaryRefusal = Exclude<PackBinaryStatus, { kind: "ready" }>;

/** The status a refused pack read gives. */
export function refusalStatus(failure: PackFailure): PackBinaryRefusal {
  switch (failure.kind) {
    case "pack-absent":
      return { kind: "pack-absent" };
    case "plugin-outdated":
      return { kind: "plugin-outdated" };
    // A pack that this plugin reads and that lacks the entry was built before
    // the entry joined the pack.
    case "pack-outdated":
    case "entry-missing":
      return { kind: "pack-outdated" };
    case "entry-damaged":
    case "pack-unreadable":
      return { kind: "pack-damaged" };
  }
}
