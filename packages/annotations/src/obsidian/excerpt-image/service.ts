import type { ExcerptCacheWriteError } from "#core/excerpt-image/error.ts";
import type { ExcerptImage } from "#core/excerpt-image/format.ts";
import type { ExcerptPdfQueue } from "#core/excerpt-image/pdf-queue.ts";
import type { Cause, Effect, Scope } from "effect";
import { Context } from "effect";

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
  latest?(identity: string): Promise<ExcerptIdentity | undefined>;
  putLatest?(identity: string, reference: ExcerptIdentity): Promise<void>;
  clear?(): Promise<void>;
}
export interface ExcerptIdentity {
  key: string;
  fingerprint: string;
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

export type AvailableExcerpt = Extract<ExcerptOutcome, { kind: "available" }>;

export type ExcerptError = Cause.UnknownError | Cause.TimeoutError;

export interface ExcerptImageOperation {
  resolve(request: ExcerptRequest): Effect.Effect<ExcerptOutcome, ExcerptError>;
}

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

export function supersedes(
  version: number | null,
  previous: number | null,
): boolean {
  if (version === null || previous === null) return true;
  return version >= previous;
}
