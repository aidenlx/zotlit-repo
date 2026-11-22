import type {
  AnnotationRecord,
  AnnotationSource,
} from "#obsidian/annotation-repository/service.ts";

export interface ExcerptRequest {
  annotation: AnnotationRecord;
  source: AnnotationSource;
  sourceScope: string;
  attachmentKey: string;
  libraryID: number;
  pdfPath: string | null;
  zoteroPngPath: string | null;
}

export const EXCERPT_RENDERER_VERSION = 3;

export function excerptFingerprint(annotation: AnnotationRecord): string {
  const p = annotation.position;
  if (annotation.type === "ink" && p.kind === "pdf-ink")
    return JSON.stringify([
      "ink",
      p.pageIndex,
      p.width,
      p.paths,
      annotation.color?.toLowerCase() ?? null,
    ]);
  if (annotation.type === "image" && p.kind === "pdf-rects")
    return JSON.stringify(["image", p.pageIndex, p.rects[0]]);
  return JSON.stringify([annotation.type, p.kind]);
}

export function excerptSourceIdentity(source: AnnotationSource): unknown[] {
  if (source.kind === "zotero-db")
    return source.database.serverID
      ? ["zotero", source.database.serverID]
      : ["zotero-db", source.database.userID, source.database.localUserKey];
  return source.serverID ? ["zotero", source.serverID] : ["zotero-local-api"];
}

export function excerptSourceIdentities(source: AnnotationSource): unknown[][] {
  return [
    excerptSourceIdentity(source),
    source.kind === "zotero-db"
      ? [
          source.kind,
          source.database.userID,
          source.database.localUserKey,
          source.database.serverID,
          source.libraryID,
        ]
      : [source.kind, source.serverID],
  ];
}

export function excerptAnnotationIdentity(request: ExcerptRequest): unknown[] {
  return [
    request.sourceScope,
    excerptSourceIdentity(request.source),
    request.attachmentKey,
    request.annotation.key,
  ];
}

export function excerptAnnotationRecord(request: ExcerptRequest): string {
  return JSON.stringify(excerptAnnotationIdentity(request));
}

export interface ExcerptSummary {
  zotero: number;
  unchecked: number;
  unavailable: number;
  notRefreshed?: number;
}
