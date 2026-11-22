import { Effect } from "effect";

import type {
  AnnotationInsertOutcome,
  AnnotationInsertRequest,
  AnnotationSnapshot,
} from "@zotlit/annotations/obsidian/annot-view/note-actions.ts";
import { AnnotationRepository } from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import type { AnnotationRecord } from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import { parseIndexedKey } from "@zotlit/zotero-types/keys";
import { annotationOpenUri } from "@zotlit/zotero-types/uri";

import { prepareAnnotationInsert } from "./insert-annotation.ts";

import { plainTemplateError } from "#core/template/errors.ts";
import { ProfileAnnotationError } from "#obsidian/template/service.ts";

function fallbackText(annotation: AnnotationRecord): string {
  const key = parseIndexedKey(annotation.key);
  const parent = parseIndexedKey(annotation.parentKey);
  return (
    annotation.text ??
    `${m.excerpt_image_unavailable()}${key && parent ? ` [Zotero](${annotationOpenUri({ annotationKey: key.key, attachmentKey: parent.key, groupID: key.groupID, pageLabel: annotation.pageLabel })})` : ""}`
  );
}

export const commitAnnotation = Effect.fn("AnnotationNoteActions.insert")(
  function* (options: AnnotationInsertRequest) {
    const { target, notePath, placement } = options;
    const preparation = Effect.gen(function* () {
      let annotation: AnnotationRecord;
      let snapshot: AnnotationSnapshot;
      if ("hit" in options) {
        const { dataDir } = yield* (yield* ZoteroPref).current;
        const list = yield* (yield* AnnotationRepository).read(
          options.hit.attachmentKey,
        );
        const found = list?.annotations.find(
          ({ key }) => key === options.hit.key,
        );
        if (!list || !found) return null;
        annotation = found;
        snapshot = { source: list.source, sourceScope: dataDir };
      } else {
        ({ annotation, snapshot } = options);
      }
      const result = yield* prepareAnnotationInsert({
        annotation,
        source: snapshot.source!,
        sourceScope: snapshot.sourceScope!,
        notePath,
        valid: target.valid,
      }).pipe(
        Effect.map((insert) => ({ kind: "prepared" as const, insert })),
        Effect.catch((cause) =>
          Effect.succeed({
            kind: "error" as const,
            error: plainTemplateError(cause),
          }),
        ),
      );
      return { annotation, result };
    });
    const prepared = yield* preparation;
    if (!target.valid()) return { kind: "cancelled" } as const;
    if (!prepared) return { kind: "unavailable" } as const;
    const { annotation, result } = prepared;
    let outcome: AnnotationInsertOutcome;
    if (result.kind === "error") {
      const { error } = result;
      if (error instanceof ProfileAnnotationError)
        outcome = {
          kind: "profile-error",
          error,
          landed: target.commit(annotation.text ?? annotation.key, placement),
        };
      else {
        yield* Effect.logWarning("Annotation insert failed").pipe(
          Effect.annotateLogs({ annotationKey: annotation.key, error }),
        );
        outcome = { kind: "failed" };
      }
    } else if (!result.insert) {
      outcome = {
        kind: "fallback",
        landed: target.commit(fallbackText(annotation), placement),
      };
    } else {
      outcome = target.commit(result.insert.text, placement)
        ? { kind: "inserted", summary: result.insert.summary }
        : { kind: "cancelled" };
    }
    if (
      "hit" in options &&
      (outcome.kind === "inserted" ||
        ((outcome.kind === "fallback" || outcome.kind === "profile-error") &&
          outcome.landed))
    )
      yield* (yield* UseLedger).record(options.hit.itemKey, "cited");
    return outcome;
  },
  withLogCategory("views", "annot-view"),
);
