// The tag of the device's excerpt cache and PDF work, and the shapes its
// callers read. The desktop layer that renders and stores lives in layer.ts.

import type { ExcerptCacheWriteError } from "#core/excerpt-image/error.ts";
import type { ExcerptImage } from "#core/excerpt-image/format.ts";
import type { ExcerptPdfQueue } from "#core/excerpt-image/pdf-queue.ts";
import { Context } from "effect";
import type { Cause, Effect, Scope } from "effect";

import type { ExcerptRequest } from "./contract.ts";
import type { ExcerptOutcomeScope } from "./outcome-scope.ts";
import type { ExcerptRendererDiagnostics } from "./renderer.ts";
export {
  EXCERPT_RENDERER_VERSION,
  excerptAnnotationIdentity,
  excerptAnnotationRecord,
  excerptFingerprint,
  excerptSourceIdentity,
} from "./contract.ts";
export type { ExcerptRequest } from "./contract.ts";
export { excerptRequest } from "./request.ts";

/** Size/mtime validation intentionally cannot detect a replacement with identical metadata. */
export interface PdfStamp {
  size: number;
  mtimeMs: number;
}
export interface ExcerptEntry extends ExcerptImage {
  pdf: PdfStamp;
}
export interface ExcerptCache {
  get(key: string, pdf?: PdfStamp): Promise<ExcerptEntry | undefined>;
  put(
    key: string,
    entry: ExcerptEntry,
  ): Effect.Effect<void, ExcerptCacheWriteError>;
  /**
   * The image one verified Annotation last displayed on this device, as the
   * reference that locates it. Absent from a cache that keeps no references.
   *
   * @param identity {@link excerptAnnotationIdentity} of the Annotation.
   */
  latest?(identity: string): Promise<ExcerptIdentity | undefined>;
  /** Replaces one Annotation's latest reference ({@link latest}). */
  putLatest?(identity: string, reference: ExcerptIdentity): Promise<void>;
  clear?(): Promise<void>;
}
/** What an available excerpt was resolved against, for a later latest reference. */
export interface ExcerptIdentity {
  /** Canonical cache key ({@link excerptKey}) of the request that was resolved. */
  key: string;
  /** Canonical pixel fingerprint ({@link excerptFingerprint}) of its snapshot. */
  fingerprint: string;
  /** PDF stamp that proved freshness; `null` when nothing was proven. */
  pdf: PdfStamp | null;
}
export type ExcerptOutcome =
  | ({
      kind: "available";
      provenance: "rendered" | "cache" | "zotero";
      freshness: "checked" | "unchecked" | "uncertain";
      identity: ExcerptIdentity;
    } & ExcerptImage)
  | { kind: "unavailable" };

/**
 * The image an available Excerpt resolved to: what a display paints, what a
 * note embeds, and what the store keeps as one Annotation's latest image.
 */
export type AvailableExcerpt = Extract<ExcerptOutcome, { kind: "available" }>;

export type ExcerptError = Cause.UnknownError | Cause.TimeoutError;

export interface ExcerptImageOperation {
  resolve(request: ExcerptRequest): Effect.Effect<ExcerptOutcome, ExcerptError>;
}

/** The device's excerpt cache and shared, scoped PDF work. */
export class ExcerptImageService extends Context.Service<
  ExcerptImageService,
  {
    resolve(
      request: ExcerptRequest,
    ): Effect.Effect<ExcerptOutcome, ExcerptError>;
    stored(request: ExcerptRequest): Effect.Effect<AvailableExcerpt | null>;
    key(request: ExcerptRequest): Effect.Effect<string>;
    operation(options?: {
      outcomes?: ExcerptOutcomeScope;
    }): Effect.Effect<ExcerptImageOperation, never, Scope.Scope>;
    readonly clear: Effect.Effect<void, Cause.UnknownError>;
    readonly rendererDiagnostics: ExcerptRendererDiagnostics | undefined;
    readonly queueDiagnostics: ExcerptPdfQueue["diagnostics"];
  }
>()("zotlit/excerpt-image/ExcerptImageService") {}

/**
 * Whether a snapshot taken at `version` may stand as an Annotation's newest
 * demand over one already recorded at `previous`.
 *
 * A record version is the saved order of the pixels it describes, so only a
 * snapshot at least as new as the recorded one may replace it: a note or batch
 * request carries the record as it was when the batch started, and admitting it
 * after a later saved edit must not make its older pixels the demand the edit's
 * own answer is measured against. A source that keeps no version — the database
 * partition — leaves no order to keep, so admission order stands there.
 *
 * Shared with the live display, which asks the same question of the demand one
 * of its slots already holds.
 */
export function supersedes(
  version: number | null,
  previous: number | null,
): boolean {
  if (version === null || previous === null) return true;
  return version >= previous;
}
