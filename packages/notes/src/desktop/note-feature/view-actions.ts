import { Effect, Layer } from "effect";

import { AnnotationNoteActions } from "@zotlit/annotations/obsidian/annot-view/note-actions.ts";
import type { InertCitationTemplate } from "@zotlit/annotations/obsidian/annot-view/note-actions.ts";
import type { AnnotationRepository } from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import type { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";

import { renderAnnotationCitation } from "./annotation-citation.ts";
import type { NoteCitationServices } from "./citations-handle.ts";
import { commitAnnotation } from "./insert-action.ts";

import {
  InertTemplateError,
  plainTemplateError,
} from "#core/template/errors.ts";

export const layerAnnotationNoteActions: Layer.Layer<
  AnnotationNoteActions,
  never,
  NoteCitationServices | AnnotationRepository | UseLedger
> = Layer.effect(
  AnnotationNoteActions,
  Effect.gen(function* () {
    const context = yield* Effect.context<
      NoteCitationServices | AnnotationRepository | UseLedger
    >();
    return AnnotationNoteActions.of({
      citation: Effect.fn("AnnotationNoteActions.citation")((key) =>
        renderAnnotationCitation(key).pipe(
          Effect.catch((cause) => {
            const error = plainTemplateError(cause);
            return error instanceof InertTemplateError
              ? Effect.succeed<InertCitationTemplate>({
                  kind: "inert-template",
                  message: error.message,
                })
              : Effect.fail(error);
          }),
          Effect.provideContext(context),
        ),
      ),
      insert: Effect.fn("AnnotationNoteActions.insert")((options) =>
        commitAnnotation(options).pipe(Effect.provideContext(context)),
      ),
    });
  }),
);
