import { Effect, FiberMap, Layer } from "effect";

import { forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import type { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { ExcerptDisplays } from "./display.ts";

import { AnnotationRepository } from "#obsidian/annotation-repository/service.ts";
import { savedExcerptRequestFor } from "#obsidian/excerpt-image/request.ts";

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
