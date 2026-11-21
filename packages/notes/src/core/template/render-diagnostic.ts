// What one render failure reads as, in the vocabulary a host words it in, and
// the stamp of the render it came from. The Template Workbench and a refused
// note operation report a failure through the same record.

import type { CitationExampleId } from "#core/template-preview/citation-examples.ts";
import type { PartialContext } from "#core/template-preview/partial-preview.ts";

import type { CitationVariant } from "@zotlit/db";

import type { EngineEvidence, RenderReport } from "./render-report.ts";

/**
 * What went wrong, in the vocabulary a host writes its own wording against. One
 * code is one sentence, so a host reads `code` and its `params` rather than the
 * English this package would otherwise author.
 */
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

/**
 * Where the template engine itself said a failure happened. `template` is the
 * name the engine renders that source under, and a `line` counts lines of that
 * template's own source — never of whichever document the reader has open.
 */
export interface RenderEngineLocation {
  readonly template: string;
  /** 1-based, in the named template's own source. */
  readonly line?: number;
  /** 1-based, in that line. */
  readonly column?: number;
}

/**
 * The failing place inside one pane's own text, named the way the engine that
 * ran it names places: a JSON-e rule reports the keys and indexes it walked,
 * and a Liquid expression reports a span of the text it tokenized. Both carry
 * what the attempt read there, so a host marks a place only where the text it
 * shows now still spells the same thing.
 */
export type SliceSite =
  | {
      readonly kind: "path";
      readonly path: readonly (string | number)[];
      /** The authored value at that path, as the attempt serialized it. */
      readonly source: string;
    }
  | {
      readonly kind: "span";
      readonly from: number;
      readonly to: number;
      readonly source: string;
    };

/** The Template Document whose own call reached the failing template. */
export interface RenderCaller {
  /** Its vault path, when the failure named one. */
  readonly document?: string;
  /** The name the engine renders it under, when the failure named one. */
  readonly template?: string;
}

export interface RenderDiagnostic {
  readonly code: RenderDiagnosticCode;
  /**
   * The wording this package did not author — the template engine's own failure
   * text, or the one a host wrote. Absent when `code` and `params` say the
   * whole thing.
   */
  readonly message?: string;
  /** The values a host's own message for `code` reads. */
  readonly params?: Readonly<Record<string, string | number>>;
  /**
   * The preview surface this failure belongs to, so a host leaves every other
   * one standing. `annotation` names the Annotation Section alone, `filename`
   * the note name alone.
   */
  readonly part?:
    | "annotation"
    | "filename"
    | "profile"
    | "properties"
    | "render";
  /**
   * 1-based position of the Managed Frontmatter entry that caused it, so the
   * responsible row can carry the diagnostic. Absent when nothing names one,
   * which is what sends the reader to Advanced instead.
   */
  readonly position?: number;
  /**
   * What the engine reported, kept apart from {@link RenderDiagnostic.callSite}
   * because the two are different places: a failure inside a called template is
   * reported there and repaired at the call.
   */
  readonly engine?: RenderEngineLocation;
  readonly caller?: RenderCaller;
  /**
   * The call in the source this render read that reached the failing template,
   * which is the one place the reader repairs it. Set only when that source
   * actually holds such a call; absent means the location is unknown, and a
   * host says so rather than sending the reader to a guessed line.
   */
  readonly callSite?: { readonly from: number; readonly to: number };
  /** Stable text for the verified call, independent of its source offset. */
  readonly callIdentity?: string;
  /** A Liquid token verified in this document, with the source used to locate it. */
  readonly sourceSite?: {
    readonly from: number;
    readonly to: number;
    readonly source: string;
    readonly offset: number;
  };
  /**
   * Where inside the failing surface — a Managed Frontmatter entry, the note
   * name — the engine stopped, in that text's own terms rather than the
   * document's. Only the open source knows where the surface sits, so a host
   * resolves this against the text it shows and leaves it unmarked where that
   * text no longer holds it.
   */
  readonly sliceSite?: SliceSite;
  /**
   * What the engine said before this diagnostic reduced it to `message`,
   * captured at the boundary that catches the error. Absent where the failure
   * was composed rather than thrown.
   */
  readonly evidence?: EngineEvidence;
  /**
   * The failed attempt this diagnostic came from, frozen when that attempt
   * landed. The Problems area inspects and copies it, so later edits,
   * selection changes, and other previews leave it as it was captured.
   */
  readonly report?: RenderReport;
}

export interface RenderIdentity {
  readonly previewMode?: "create" | "update";
  readonly sourceRevision: string;
  readonly snapshotRevision: string;
  readonly annotationId?: string;
  readonly annotationRevision?: string;
  /** The Citation Variant a Citation Template render produced its text under. */
  readonly citationVariant?: CitationVariant;
  /** The built-in example set it rendered; absent when the chosen Item supplied one. */
  readonly citationExample?: CitationExampleId;
  /** The caller a Shared Partial render read its root data as. */
  readonly partialContext?: PartialContext;
  /** The Profile that render's bindings came from; absent for the default one. */
  readonly partialProfile?: string;
}

/** FNV-1a over the source, so a result can name the revision it rendered. */
export function templateSourceRevision(source: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
