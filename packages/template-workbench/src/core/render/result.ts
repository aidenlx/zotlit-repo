import type { CitationPreviewSelection } from "@zotlit/notes/core/template-preview/citation-examples.ts";
import type { PartialPreviewSelection } from "@zotlit/notes/core/template-preview/partial-preview.ts";
import type { AnnotationExample } from "@zotlit/notes/core/template-preview/sample-annotations.ts";
import type {
  RenderDiagnostic,
  RenderIdentity,
} from "@zotlit/notes/core/template/render-diagnostic.ts";
import { templateSourceRevision } from "@zotlit/notes/core/template/render-diagnostic.ts";

export type {
  RenderDiagnostic,
  RenderIdentity,
  SliceSite,
} from "@zotlit/notes/core/template/render-diagnostic.ts";
export { templateSourceRevision } from "@zotlit/notes/core/template/render-diagnostic.ts";

export interface RenderedProperty {
  readonly key: string;
  readonly value?: unknown;
  readonly missing: boolean;
  readonly position: number;
}

export function renderIdentity({
  source,
  snapshot,
  annotation,
  citation,
  partial,
  mode,
}: {
  readonly source: string;
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
  readonly notePath: string | null;
  readonly properties: readonly RenderedProperty[];
  readonly fold: readonly RenderedProperty[];
  readonly frontmatterBlock: string | null;
  readonly creationBody: string | null;
  readonly managedRegion: string | null;
  readonly annotation: string | null;
  readonly annotationCitation: string | null;
  readonly citation: string | null;
  readonly partial: string | null;
  readonly annotationRanges: readonly RenderedRange[];
  readonly diagnostics: readonly RenderDiagnostic[];
  readonly previewHints?: readonly PreviewHint[];
}

export interface PreviewHint {
  readonly part: "annotation" | "note";
  readonly message: string;
  readonly opensEngineSettings: boolean;
}

export interface RenderedRange {
  readonly from: number;
  readonly to: number;
}

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

export function retainOutputs<R extends TemplateRenderResult>(
  kept: R,
  result: R,
): R {
  if (!sameRenderSelection(kept, result)) return result;
  const surfaces = [
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
  if (surfaces.length === 0) return result;
  return Object.assign({ ...result }, ...surfaces) as R;
}

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
