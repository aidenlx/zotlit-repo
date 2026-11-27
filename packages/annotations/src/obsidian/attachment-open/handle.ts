import type { OpenablePdfs } from "#core/attachment-open/openable.ts";
import type { Context } from "effect";

import { exitOver, valueOr } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";

import { literatureNoteAttachments } from "./literature-note.ts";
import type { LiteratureNoteServices } from "./literature-note.ts";

export interface LiteratureNoteAttachmentsHandle {
  literatureNoteAttachments(
    indexedKey: string,
  ): Promise<OpenablePdfs | undefined>;
}

export function bindLiteratureNoteAttachments(
  bridge: Pick<EffectBridge, "runPromiseExit">,
  context: Context.Context<LiteratureNoteServices>,
): LiteratureNoteAttachmentsHandle {
  const runExit = exitOver(bridge, context);
  return {
    literatureNoteAttachments: async (indexedKey) =>
      valueOr<OpenablePdfs | undefined, never>(
        await runExit(literatureNoteAttachments(indexedKey)),
        undefined,
      ),
  };
}
