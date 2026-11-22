import { Context } from "effect";

import { layerPackBinary } from "@zotlit/plugin-services/obsidian/managed-binary/pack-binary.ts";
import type {
  PackBinary,
  PackBinaryApi,
} from "@zotlit/plugin-services/obsidian/managed-binary/pack-binary.ts";
import type {
  PackBinaryRefusal,
  PackBinaryStatus,
} from "@zotlit/resource-pack/status.ts";

import { createCitationEngine } from "./engine.ts";
import type { CitationEngine } from "./engine.ts";

export type PandocEngineStatus = PackBinaryStatus | null;

export const engineRefusal = (
  status: PandocEngineStatus,
): PackBinaryRefusal | null =>
  status === null || status.kind === "ready" ? null : status;

export const engineUsable = (status: PandocEngineStatus): boolean =>
  engineRefusal(status) === null;

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
