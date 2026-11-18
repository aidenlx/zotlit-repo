// The Note Feature's change notices: the excerpt image summary and the
// skipped frontmatter expressions, shown through the Notifier.
import { Effect, Layer } from "effect";

import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { eventPayloads, NoteFeature } from "./service.ts";

/**
 * Show a notice for each excerpt image summary and each note write that
 * skipped a failed frontmatter expression. The subscriptions end when the
 * layer's Scope closes.
 */
export const layerNoteFeatureNotices: Layer.Layer<
  never,
  never,
  NoteFeature | Notifier
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const { changes } = yield* NoteFeature;
    const notifier = yield* Notifier;
    yield* forkEach(
      eventPayloads(changes, "excerpt-images-reported"),
      (summary) =>
        notifier.show(
          m.excerpt_image_summary({
            ...summary,
            notRefreshed: summary.notRefreshed ?? 0,
          }),
        ),
    );
    yield* forkEach(
      eventPayloads(changes, "frontmatter-eval-failed"),
      ({ fields }) =>
        notifier.show(
          m.notice_frontmatter_eval_failed({ fields: fields.join(", ") }),
        ),
    );
  }),
);
