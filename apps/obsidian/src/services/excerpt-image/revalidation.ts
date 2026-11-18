// A saved pixel edit revalidates its Excerpt Image wherever the image stands.
import { Effect, FiberMap, Layer } from "effect";

import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import type { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { AnnotationRepository } from "@/services/annotation-repository/service.ts";
import type { ZoteroPref } from "@/services/zotero-pref/service.ts";

import { ExcerptDisplays } from "./display.ts";
import { savedExcerptRequestFor } from "./request.ts";

/**
 * Revalidate the Excerpt Image of each saved pixel edit: the card that shows
 * the Annotation, and — with no card on screen — the device-local image the
 * store already holds for it. One subscriber covers every surface that can
 * save an edit. Each revalidation reads the database first, so a newer edit
 * of the same Annotation interrupts the older read: an older read that lands
 * late would cancel the newer replacement. The reads stop when the layer's
 * Scope closes.
 */
export const layerExcerptRevalidation: Layer.Layer<
  never,
  never,
  AnnotationRepository | ExcerptDisplays | ZoteroReads | ZoteroPref
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const repository = yield* AnnotationRepository;
    const displays = yield* ExcerptDisplays;
    const revalidations = yield* FiberMap.make<string>();
    yield* forkEach(repository.excerptPixelsChanged, ({ record, source }) =>
      FiberMap.run(
        revalidations,
        record.key,
        savedExcerptRequestFor({ annotation: record, source }).pipe(
          Effect.tap((request) =>
            request ? displays.revalidate(request) : Effect.void,
          ),
        ),
      ),
    );
  }),
);
