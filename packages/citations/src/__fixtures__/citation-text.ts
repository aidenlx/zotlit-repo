import { Context, Effect, Layer, Stream } from "effect";

import { layerHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import type { HostSources } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import { QueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";

import { CitationLookup } from "#obsidian/citation-index/lookup-service.ts";
import { scanNote } from "#core/citation-index/scan-note.ts";
import { CitationIndex } from "#obsidian/citation-index/service.ts";
import type {
  Citation,
  CitationOccurrence,
} from "#obsidian/citation-index/service.ts";
import type { OpenDocuments } from "#core/citation-text/open-documents.ts";
import type { RenderedCitation } from "#obsidian/pandoc/engine.ts";
import { inlineText } from "#obsidian/pandoc/inline-content.tsx";
import { BibliographyRender } from "#obsidian/pandoc/render-cache.ts";
import { ProfileStyles } from "#obsidian/pandoc/profile-styles.ts";
import type { ProfileStyleReader } from "#obsidian/pandoc/profile-styles.ts";

import type { FormattedOccurrence, PresentedCitation } from "#obsidian/citation-text/present.ts";
import { CitationText, layerCitationText } from "#obsidian/citation-text/service.ts";

export const ALPHA_KEY = "ALPHA234";

export function citation(
  citekey: string,
  indexedKey: string | null = ALPHA_KEY,
): Citation {
  return {
    indexedKey,
    linkpath: indexedKey === null ? null : "Zeta 2020",
    refNumber: 1,
    occurrences: [
      {
        kind: "citekey",
        raw: citekey,
        position: {
          start: { line: 0, col: 0, offset: 0 },
          end: { line: 0, col: 0, offset: 0 },
        },
      },
    ],
  };
}

export function literalOccurrences(body: string): CitationOccurrence[] {
  return scanNote(body).citekeys;
}

export function rendered(text: string): RenderedCitation {
  return { content: [{ t: "Str", c: text }], citations: [] };
}

export function presented(text: string): PresentedCitation {
  return { text: rendered(text), serials: [] };
}

export function noted(source: string): RenderedCitation {
  return {
    content: [
      {
        t: "Cite",
        c: [
          [],
          [{ t: "Note", c: [{ t: "Para", c: [{ t: "Str", c: source }] }] }],
        ],
      },
    ],
    citations: scanNote(source).citations.flatMap(({ keys }) =>
      keys.map(({ citekey }) => ({ id: citekey, mode: "normal" as const })),
    ),
  };
}

export function occurrences(
  text: RenderedCitation,
  start = 0,
): FormattedOccurrence[] {
  return [{ start, text, serials: [] }];
}

export function occurrenceTexts(
  held: readonly FormattedOccurrence[] = [],
): string[] {
  return held.map(({ text }) => inlineText(text.content));
}

export function firstText(
  held: readonly FormattedOccurrence[] = [],
): string | undefined {
  return occurrenceTexts(held)[0];
}

export interface CitationTextFixtureDeps {
  host: HostSources;
  citationIndex: Pick<CitationIndex["Service"], "getParsedDocument" | "events">;
  citationLookup: Pick<CitationLookup["Service"], "current" | "changes">;
  noteIndex: Pick<NoteIndex["Service"], "whenIndexed" | "changes">;
  profile: ProfileStyleReader;
  bibliographyRender: Pick<
    BibliographyRender["Service"],
    "readCitations" | "readBibliography" | "state" | "events"
  >;
  queryClient: Pick<
    QueryClients["Service"],
    "client" | "changes" | "ask" | "read" | "peek" | "invalidate" | "watch"
  >;
  openDocuments?: OpenDocuments;
}

export function citationTextFixture(
  deps: CitationTextFixtureDeps,
  context: Context.Context<never> = Context.empty(),
) {
  const stack = new AsyncDisposableStack();

  const queries = deps.queryClient;
  const runtime = buildRuntime(
    layerCitationText(deps.openDocuments).pipe(
      Layer.provide(
        Layer.mergeAll(
          layerHost(deps.host),
          Layer.succeed(
            CitationIndex,
            stubService<CitationIndex["Service"]>("CitationIndex", {
              ...deps.citationIndex,
            }),
          ),
          Layer.succeed(
            CitationLookup,
            stubService<CitationLookup["Service"]>("CitationLookup", {
              ...deps.citationLookup,
            }),
          ),
          Layer.succeed(
            NoteIndex,
            stubService<NoteIndex["Service"]>("NoteIndex", {
              ...deps.noteIndex,
            }),
          ),
          Layer.succeed(
            ProfileStyles,
            stubService<ProfileStyles["Service"]>("ProfileStyles", {
              loaded: Effect.sync(() => deps.profile.loaded),
              profileOf: (...args: Parameters<ProfileStyleReader["profileOf"]>) =>
                Effect.sync(() => deps.profile.profileOf(...args)),
              changes: Stream.empty,
            }),
          ),
          Layer.succeed(
            BibliographyRender,
            stubService<BibliographyRender["Service"]>("BibliographyRender", {
              ...deps.bibliographyRender,
            }),
          ),
          Layer.succeed(
            QueryClients,
            stubService<QueryClients["Service"]>("QueryClients", {
              ...queries,
            }),
          ),
        ),
      ),
      Layer.provideMerge(Layer.succeedContext(context)),
    ),
    stack,
  );
  try {
    return Object.assign(runtime.runSync(CitationText), {
      bridge: effectBridge(runtime),
      runtime,
      [Symbol.asyncDispose]: () => stack.disposeAsync(),
    });
  } catch (error) {
    void stack.disposeAsync();
    throw error;
  }
}

export type CitationTextFixture = ReturnType<typeof citationTextFixture>;
