import type { PackFailure } from "#format.ts";
// Where a binary of the Resource Pack stands for the plugin that reads it, as one Schema that each realm and each wire format reads.
import { Schema } from "effect";

/** A status in which the pack gives no binary that runs. Each arm names the one step that mends it. */
export const PackBinaryRefusalSchema = Schema.Union([
  /** Obsidian lists no Resource Pack: install it. */
  Schema.Struct({ kind: Schema.Literal("pack-absent") }),
  /** The pack is older than this plugin reads, or lacks the entry: update the pack. */
  Schema.Struct({ kind: Schema.Literal("pack-outdated") }),
  /** The pack is newer than this plugin reads: update the plugin. */
  Schema.Struct({ kind: Schema.Literal("plugin-outdated") }),
  /** The pack file is not what its index states: install the pack again. */
  Schema.Struct({ kind: Schema.Literal("pack-damaged") }),
  /** The verified binary did not start. */
  Schema.Struct({ kind: Schema.Literal("failed"), detail: Schema.String }),
]);
export type PackBinaryRefusal = typeof PackBinaryRefusalSchema.Type;

/**
 * Where a binary stands: a refusal, or `ready` with the version of the pack
 * whose verified binary runs or starts at the next use. The realm that reads
 * the Pack Entry and starts the binary states it.
 */
export const PackBinaryStatusSchema = Schema.Union([
  ...PackBinaryRefusalSchema.members,
  Schema.Struct({ kind: Schema.Literal("ready"), version: Schema.String }),
]);
export type PackBinaryStatus = typeof PackBinaryStatusSchema.Type;

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
