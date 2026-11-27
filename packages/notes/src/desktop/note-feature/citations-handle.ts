import type { Profile } from "#obsidian/profile/service.ts";
import type { Template } from "#obsidian/template/service.ts";
import type { Context } from "effect";
import { Effect } from "effect";

import type { ExcerptPreparation } from "@zotlit/annotations/desktop/excerpt-image/prepare.ts";
import type { AnnotationCitation } from "@zotlit/annotations/obsidian/annot-view/note-actions.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import type { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import type { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import type { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { renderAnnotationCitation } from "./annotation-citation.ts";

import { plainTemplateError } from "#core/template/errors.ts";
import { renderCitation } from "#obsidian/note-feature/citation.ts";

export type NoteCitationServices =
  | ExcerptPreparation
  | Template
  | Profile
  | ZoteroReads
  | ZoteroPref
  | PluginSettings
  | NoteIndex;

export interface NoteCitations {
  renderCitation(...args: Parameters<typeof renderCitation>): string | null;
  renderAnnotationCitation(annotationKey: string): Promise<AnnotationCitation>;
}

export function bindNoteCitations(
  bridge: Pick<EffectBridge, "runSync" | "runPromise">,
  context: Context.Context<NoteCitationServices>,
): NoteCitations {
  const plain = <A, E>(effect: Effect.Effect<A, E, NoteCitationServices>) =>
    Effect.mapError(effect, (error) => plainTemplateError(error));
  const provide = <A, E>(effect: Effect.Effect<A, E, NoteCitationServices>) =>
    Effect.provideContext(plain(effect), context);
  return {
    renderCitation: (items, variant) =>
      bridge.runSync(provide(renderCitation(items, variant))),
    renderAnnotationCitation: (annotationKey) =>
      bridge.runPromise(provide(renderAnnotationCitation(annotationKey))),
  };
}
