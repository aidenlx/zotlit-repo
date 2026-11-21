// The Pandoc engine as a Managed Binary: the `pandoc.wasm` of the Resource Pack.

import { Context } from "effect";

import { layerPackBinary } from "@zotlit/plugin-services/obsidian/managed-binary/pack-binary.ts";
import type {
  PackBinary,
  PackBinaryApi,
  PackBinaryStatus,
} from "@zotlit/plugin-services/obsidian/managed-binary/pack-binary.ts";

import { createCitationEngine } from "./engine.ts";
import type { CitationEngine } from "./engine.ts";

/**
 * Where the Pandoc engine stands; `null` while the installed Resource Pack is
 * unread, which the first render or export ends.
 */
export type PandocEngineStatus = PackBinaryStatus | null;

/** A status in which the pack gives no engine. */
export type PandocEngineRefusal = Exclude<PackBinaryStatus, { kind: "ready" }>;

/**
 * The status when it gives no engine; `null` for a status in which a render
 * or an export asks for the engine: unread, or ready.
 */
export const engineRefusal = (
  status: PandocEngineStatus,
): PandocEngineRefusal | null =>
  status === null || status.kind === "ready" ? null : status;

/** A render or an export asks for the engine in this status. */
export const engineUsable = (status: PandocEngineStatus): boolean =>
  engineRefusal(status) === null;

/** The Pandoc engine's declaration; its Pack Entry is `pandoc-engine`. */
export const PANDOC_ENGINE: PackBinary<CitationEngine> = {
  id: "pandoc-engine",
  label: "Pandoc engine",
  logCategory: ["pandoc", "engine"],
  createEngine: createCitationEngine,
};

export class PandocEngine extends Context.Service<
  PandocEngine,
  PackBinaryApi<CitationEngine>
>()("zotlit/pandoc/PandocEngine") {}

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    PandocEngine: PandocEngine;
  }
}

export const layerPandocEngine = layerPackBinary(PandocEngine, PANDOC_ENGINE);
