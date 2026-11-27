import type { Effect } from "effect";
import { Context, Schema, Stream } from "effect";

import type { CslItemData } from "@zotlit/db";
import type { Held } from "@zotlit/plugin-services/core/query-client/service.ts";

import type { EffectivePresentation } from "./document-presentation.ts";
import type { BibliographyEntry, RenderedCitation } from "./engine.ts";

export class BibliographyRenderError extends Schema.TaggedError<
  BibliographyRenderError,
  { readonly brand: unique symbol }
>()("BibliographyRenderError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export type BibliographyRenderEvent =
  | { readonly _tag: "changed"; readonly key: string }
  | {
      readonly _tag: "settled";
      readonly key: string;
      readonly held: Held<unknown> | null;
    }
  | { readonly _tag: "invalidated" };
export interface BibliographyRenderState {
  readonly vaultPresentation: EffectivePresentation;
  readonly missingStyle: string | null;
}
export interface RenderPresentation {
  styleId?: string | null;
  locale?: string | null;
}

export interface BibliographyRenderResult {
  entries: readonly BibliographyEntry[];
  hasEntryMarkers: boolean;
}

export type RenderUnavailableReason =
  | "engine-absent"
  | "style-missing"
  | "failed";

export type HeldRenderOutcome<T> =
  | { kind: "unavailable"; reason: RenderUnavailableReason }
  | { kind: "held"; key: string; record: Held<T> };

export type BibliographyRenderOutcome =
  HeldRenderOutcome<BibliographyRenderResult>;

export type CitationRenderOutcome = HeldRenderOutcome<
  readonly RenderedCitation[]
>;

export class BibliographyRender extends Context.Service<
  BibliographyRender,
  {
    readonly state: Effect.Effect<BibliographyRenderState>;
    readonly changes: Stream.Stream<BibliographyRenderState>;
    readonly events: Stream.Stream<BibliographyRenderEvent>;
    render(
      items: readonly CslItemData[],
      presentation?: RenderPresentation,
    ): Effect.Effect<BibliographyRenderOutcome, unknown>;
    renderCitations(
      citations: readonly string[],
      items: readonly CslItemData[],
      presentation?: RenderPresentation,
    ): Effect.Effect<CitationRenderOutcome, unknown>;
    readBibliography(
      items: readonly CslItemData[],
      options?: ReadOptions,
    ): Effect.Effect<BibliographyRenderResult | null, unknown>;
    readCitations(
      citations: readonly string[],
      items: readonly CslItemData[],
      options?: ReadOptions,
    ): Effect.Effect<readonly RenderedCitation[] | null, unknown>;
  }
>()("zotlit/pandoc/BibliographyRender") {}

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    BibliographyRender: BibliographyRender;
  }
}

export interface ReadOptions {
  presentation?: RenderPresentation;
}

export function renderInvalidated(
  render: Pick<BibliographyRender["Service"], "events">,
): Stream.Stream<void> {
  return render.events.pipe(
    Stream.filter((event) => event._tag === "invalidated"),
    Stream.map(() => undefined),
  );
}

export function missingStyleChanges(
  changes: Stream.Stream<BibliographyRenderState>,
): Stream.Stream<string> {
  return changes.pipe(
    Stream.map((state) => state.missingStyle),
    Stream.changes,
    Stream.filter((style): style is string => style !== null),
  );
}
