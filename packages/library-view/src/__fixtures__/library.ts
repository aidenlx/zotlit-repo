import { DateTime } from "effect";

import type { Use } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import type { UseKind } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";

export { holdNow } from "#__fixtures__/library/clock.ts";

export function useAt(kind: UseKind, iso: string): Use {
  return { kind, instant: DateTime.makeUnsafe(iso) };
}

import { Effect, Layer, Stream } from "effect";

import { ANNOT_PATHS } from "@zotlit/annotations/__fixtures__/annot-view/host.ts";
import { annotationReads } from "@zotlit/annotations/__fixtures__/pdf-annotation-editor.ts";
import { AnnotationRepository } from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";

import { makeWelcomeHost } from "./welcome.ts";
import type { WelcomeHostOptions } from "./welcome.ts";

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
