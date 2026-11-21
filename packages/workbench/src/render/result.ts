// The render result shape and its identity stamp, shared by the renderer and
// the scheduler that decides which result is still current.

import type { CitationPreviewSelection } from "@zotlit/notes/core/template-preview/citation-examples.ts";
import type { PartialPreviewSelection } from "@zotlit/notes/core/template-preview/partial-preview.ts";
import type { AnnotationExample } from "@zotlit/notes/core/template-preview/sample-annotations.ts";
import type {
  RenderDiagnostic,
  RenderIdentity,
} from "@zotlit/notes/core/template/render-diagnostic.ts";
import { templateSourceRevision } from "@zotlit/notes/core/template/render-diagnostic.ts";

export type {
  RenderCaller,
  RenderDiagnostic,
  RenderDiagnosticCode,
  RenderEngineLocation,
  RenderIdentity,
  SliceSite,
} from "@zotlit/notes/core/template/render-diagnostic.ts";
export { templateSourceRevision } from "@zotlit/notes/core/template/render-diagnostic.ts";

export interface RenderedProperty {
  readonly key: string;
  readonly value?: unknown;
  readonly missing: boolean;
  /** 1-based position of the Managed Frontmatter entry that produced it. */
  readonly position: number;
}

/**
 * The stamp one render is known by. Takes a request, and equally the
 * selections a scheduler composes a result of its own from — a failure the
 * host reports carries the same dimensions, so it is matched the same way.
 */
export function renderIdentity({
  source,
  snapshot,
  annotation,
  citation,
  partial,
  mode,
}: {
  readonly source: string;
  /** `null` where no paper is loaded, which leaves the revision unnamed. */
  readonly snapshot: { readonly revision: string } | null;
  readonly mode?: "create" | "update";
  readonly annotation?: AnnotationExample | null;
  readonly citation?: CitationPreviewSelection | null;
  readonly partial?: PartialPreviewSelection | null;
}): RenderIdentity {
  return {
    ...(mode ? { previewMode: mode } : {}),
    sourceRevision: templateSourceRevision(source),
    snapshotRevision: snapshot?.revision ?? "",
    ...(annotation
      ? { annotationId: annotation.id, annotationRevision: annotation.revision }
      : {}),
    ...(citation
      ? {
          citationVariant: citation.variant,
          ...(citation.example ? { citationExample: citation.example } : {}),
        }
      : {}),
    ...(partial
      ? {
          partialContext: partial.context,
          ...(partial.profile ? { partialProfile: partial.profile } : {}),
        }
      : {}),
  };
}

export interface TemplateRenderResult extends RenderIdentity {
  readonly filename: string | null;
  /**
   * The note name as the relative Note Path that note creation writes under the
   * Literature note folder, without `.md`: a slash makes a subfolder and each
   * segment is made safe for the file system. Null when no note name rendered,
   * and when the note name resolves to empty.
   */
  readonly notePath: string | null;
  /** What each entry produced on its own, in list order. */
  readonly properties: readonly RenderedProperty[];
  /**
   * The final ordered fold — the frontmatter the note gets once every entry has
   * merged. Each row carries the position that fixed its place in the note.
   */
  readonly fold: readonly RenderedProperty[];
  /**
   * The fold as the YAML block the created note carries, so a reader can check
   * the generated text rather than the values behind it. Null when the render
   * produced no frontmatter at all.
   */
  readonly frontmatterBlock: string | null;
  readonly creationBody: string | null;
  readonly managedRegion: string | null;
  readonly annotation: string | null;
  /** The selected example's computed citation, for matching field and completion values. */
  readonly annotationCitation: string | null;
  /** The Citation Template's own output for the selected set; null for a Profile. */
  readonly citation: string | null;
  /** The Shared Partial's own output under the chosen context; null otherwise. */
  readonly partial: string | null;
  /**
   * Where each highlight the format rendered landed in `creationBody`, in
   * reading order, so a host can point at the many outputs of the one format.
   */
  readonly annotationRanges: readonly RenderedRange[];
  readonly diagnostics: readonly RenderDiagnostic[];
  /** What a host suggests beside a preview that rendered; see {@link PreviewHint}. */
  readonly previewHints?: readonly PreviewHint[];
}

/**
 * A suggestion about a preview that rendered correctly, which no change to the
 * template answers, so it stays apart from the diagnostics.
 */
export interface PreviewHint {
  /** The preview surface it sits above. */
  readonly part: "annotation" | "note";
  readonly message: string;
  /** Whether the host's Citation Engine settings are the next step. */
  readonly opensEngineSettings: boolean;
}

/** A span of rendered Markdown, as offsets into the body it belongs to. */
export interface RenderedRange {
  readonly from: number;
  readonly to: number;
}

/**
 * A result that produced nothing, which every partial result fills in from: a
 * render that failed outright, and one whose document produces a single part.
 */
export function emptyRender(identity: RenderIdentity): TemplateRenderResult {
  return {
    ...identity,
    filename: null,
    notePath: null,
    properties: [],
    fold: [],
    frontmatterBlock: null,
    creationBody: null,
    managedRegion: null,
    annotation: null,
    annotationCitation: null,
    citation: null,
    partial: null,
    annotationRanges: [],
    diagnostics: [],
  };
}

export function failedRender(
  identity: RenderIdentity,
  diagnostic: RenderDiagnostic,
): TemplateRenderResult {
  return { ...emptyRender(identity), diagnostics: [diagnostic] };
}

/**
 * Whether two results describe the same paper, example, caller, and mode. The
 * source is left out: an edit makes a result stale without making it another
 * preview's, which is what keeps a retained output readable through a repair.
 */
export function sameRenderSelection(
  kept: RenderIdentity,
  result: RenderIdentity,
): boolean {
  return (
    kept.previewMode === result.previewMode &&
    kept.snapshotRevision === result.snapshotRevision &&
    kept.annotationId === result.annotationId &&
    kept.annotationRevision === result.annotationRevision &&
    kept.citationVariant === result.citationVariant &&
    kept.citationExample === result.citationExample &&
    kept.partialContext === result.partialContext &&
    kept.partialProfile === result.partialProfile
  );
}

/**
 * `result` with the outputs it produced none of taken from `kept`, so an
 * attempt where one preview surface failed and another succeeded leaves each
 * reader the newest output their own surface has. The note's properties and
 * marks travel with the body they describe; a surface whose output is null
 * either failed or is not this document's to produce, and either way the last
 * one that worked is what a reader compares against.
 *
 * A result for another paper, example, caller, or mode replaces what was kept
 * rather than filling in from it: another preview's output is no comparison.
 */
export function retainOutputs<R extends TemplateRenderResult>(
  kept: R,
  result: R,
): R {
  if (!sameRenderSelection(kept, result)) return result;
  const surfaces = [
    // The note name renders apart from the note body, so it keeps its own
    // newest output: a name that worked while the body failed stands, and a
    // name that failed beside a body that worked shows the last that worked.
    result.filename === null && kept.filename !== null
      ? { filename: kept.filename, notePath: kept.notePath }
      : null,
    result.creationBody === null && kept.creationBody !== null
      ? {
          properties: kept.properties,
          fold: kept.fold,
          frontmatterBlock: kept.frontmatterBlock,
          creationBody: kept.creationBody,
          managedRegion: kept.managedRegion,
          annotationRanges: kept.annotationRanges,
        }
      : null,
    result.annotation === null && kept.annotation !== null
      ? {
          annotation: kept.annotation,
          annotationCitation: kept.annotationCitation,
        }
      : null,
    result.citation === null && kept.citation !== null
      ? { citation: kept.citation }
      : null,
    result.partial === null && kept.partial !== null
      ? { partial: kept.partial }
      : null,
  ].filter((outputs) => outputs !== null);
  // A result that produced every surface is the whole of what is kept, and it
  // is kept as itself: a copy would read as a new result to everything
  // comparing what this scheduler published last.
  if (surfaces.length === 0) return result;
  return Object.assign({ ...result }, ...surfaces) as R;
}

/**
 * Whether an attempt produced nothing at all. A template that renders empty
 * text still produced it, so a valid empty result stays apart from a failure,
 * and only a failure sends a reader to the last preview that worked.
 */
export function renderFailed(result: TemplateRenderResult): boolean {
  return (
    result.diagnostics.length > 0 &&
    result.filename === null &&
    result.creationBody === null &&
    result.managedRegion === null &&
    result.annotation === null &&
    result.citation === null &&
    result.partial === null
  );
}
