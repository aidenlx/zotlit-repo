import { DateTime } from "effect";
// The view's clock and its ledger's Uses, for tests: the view is plain code,
// so it reads Temporal.

import type { Use } from "@/services/use-ledger/service.ts";
import type { UseKind } from "@/services/use-ledger/service.ts";

export { holdNow } from "./__fixtures__/clock.ts";

/** A `kind` Use at `iso`. */
export function useAt(kind: UseKind, iso: string): Use {
  return { kind, instant: DateTime.makeUnsafe(iso) };
}

// The Library embeds the Welcome banner, so its test host supplies the same sources.
import { Effect, Layer, Stream } from "effect";

import { AnnotationRepository } from "@/services/annotation-repository/service.ts";
import { NoteIndex } from "@/services/note-index/service.ts";
import { annotationReads } from "@/services/pdf-annotation-editor/__fixtures__.ts";
import { ZoteroPref } from "@/services/zotero-pref/service.ts";
import { ANNOT_PATHS } from "@/views/annot-view/__fixtures__/host.ts";
import { makeWelcomeHost } from "@/views/welcome/__fixtures__.ts";
import type { WelcomeHostOptions } from "@/views/welcome/__fixtures__.ts";

export const makeLibraryHost = <R = never>(
  options: WelcomeHostOptions<R> = {},
) =>
  makeWelcomeHost({
    ...options,
    services: Layer.mergeAll(
      Layer.mock(AnnotationRepository, annotationReads()),
      Layer.mock(ZoteroPref, {
        current: Effect.succeed(ANNOT_PATHS),
        changes: Stream.succeed(ANNOT_PATHS),
      }),
      Layer.mock(NoteIndex, {
        getIndexedItemKeys: Effect.succeed([]),
        changes: Stream.empty,
        whenIndexed: Effect.void,
      }),
      options.services ?? Layer.empty,
    ),
  });
