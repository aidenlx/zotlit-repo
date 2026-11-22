import type { CitationExampleId } from "#core/template-preview/citation-examples.ts";
import type { PartialContext } from "#core/template-preview/partial-preview.ts";

import type { CitationVariant } from "@zotlit/db";

import type { EngineEvidence, RenderReport } from "./render-report.ts";

export type RenderDiagnosticCode =
  | "citation-data-mismatch"
  | "citation-style-error"
  | "contract-version-mismatch"
  | "invalid-profile"
  | "liquid-syntax-error"
  | "missing-partial"
  | "property-append-conflict"
  | "property-error"
  | "property-javascript"
  | "render-error";

export interface RenderEngineLocation {
  readonly template: string;
  readonly line?: number;
  readonly column?: number;
}

export type SliceSite =
  | {
      readonly kind: "path";
      readonly path: readonly (string | number)[];
      readonly source: string;
    }
  | {
      readonly kind: "span";
      readonly from: number;
      readonly to: number;
      readonly source: string;
    };

export interface RenderCaller {
  readonly document?: string;
  readonly template?: string;
}

export interface RenderDiagnostic {
  readonly code: RenderDiagnosticCode;
  readonly message?: string;
  readonly params?: Readonly<Record<string, string | number>>;
  readonly part?:
    | "annotation"
    | "filename"
    | "profile"
    | "properties"
    | "render";
  readonly position?: number;
  readonly engine?: RenderEngineLocation;
  readonly caller?: RenderCaller;
  readonly callSite?: { readonly from: number; readonly to: number };
  readonly callIdentity?: string;
  readonly sourceSite?: {
    readonly from: number;
    readonly to: number;
    readonly source: string;
    readonly offset: number;
  };
  readonly sliceSite?: SliceSite;
  readonly evidence?: EngineEvidence;
  readonly report?: RenderReport;
}

export interface RenderIdentity {
  readonly previewMode?: "create" | "update";
  readonly sourceRevision: string;
  readonly snapshotRevision: string;
  readonly annotationId?: string;
  readonly annotationRevision?: string;
  readonly citationVariant?: CitationVariant;
  readonly citationExample?: CitationExampleId;
  readonly partialContext?: PartialContext;
  readonly partialProfile?: string;
}

export function templateSourceRevision(source: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
