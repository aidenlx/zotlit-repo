import {
  parseAnnotationData,
  parseCitationData,
  parseEmbeddedCitationItems,
  parseEmbeddedCitationSnapshot,
} from "@zotlit/db";
import type { AnnotationInfo, CitationInfo } from "@zotlit/db";

const MIN_SCHEMA_VERSION = 6;

type NoteSchema =
  | { supported: true; container: HTMLElement; version: number }
  | { supported: false; version: number }
  | {
      supported: false;
      version: null;
      fallbackReason: "missing-schema-marker" | "malformed-schema-marker";
    };

export function parseNoteSchema(root: ParentNode): NoteSchema {
  const container = root.querySelector<HTMLDivElement>(
    "div[data-schema-version]",
  );
  if (!container) {
    return {
      supported: false,
      version: null,
      fallbackReason: "missing-schema-marker",
    };
  }
  const version = Number.parseInt(
    container.getAttribute("data-schema-version") ?? "",
    10,
  );
  if (!Number.isInteger(version)) {
    return {
      supported: false,
      version: null,
      fallbackReason: "malformed-schema-marker",
    };
  }
  if (version < MIN_SCHEMA_VERSION) return { supported: false, version };
  return { supported: true, container, version };
}

export function parseCitation(el: Element): CitationInfo | null {
  return parseCitationData(el.getAttribute("data-citation"));
}

export function parseEmbeddedCitations(
  container: Element,
): Map<string, string> {
  return parseEmbeddedCitationItems(
    container.getAttribute("data-citation-items"),
  );
}

export function parseEmbeddedItemSnapshots(
  container: Element,
): Map<string, Record<string, unknown>> {
  return parseEmbeddedCitationSnapshot(
    container.getAttribute("data-citation-items"),
  );
}

export interface NoteAnnotation extends AnnotationInfo {
  imageAttachmentKey?: string;
}

export function parseAnnotation(el: Element): NoteAnnotation | null {
  const info = parseAnnotationData(el.getAttribute("data-annotation"));
  if (!info) return null;
  const imageAttachmentKey = el.getAttribute("data-attachment-key");
  return imageAttachmentKey ? { ...info, imageAttachmentKey } : info;
}

interface AnnotationParagraph {
  paragraph: HTMLElement;
  annotationKey: string;
}

function isAnnotationLead(el: Element): boolean {
  if (!el.hasAttribute("data-annotation")) return false;
  if (el.nodeName === "IMG") return true;
  return (
    el.nodeName === "SPAN" &&
    (el.classList.contains("highlight") || el.classList.contains("underline"))
  );
}

function isAnnotationTrailing(el: Element): boolean {
  if (el.nodeName === "BR") return true;
  return (
    el.nodeName === "SPAN" &&
    el.classList.contains("citation") &&
    el.hasAttribute("data-citation")
  );
}

function matchAnnotationParagraph(p: Element): AnnotationParagraph | null {
  const [lead, ...trailing] = p.children;
  if (!lead || !isAnnotationLead(lead)) return null;
  if (!trailing.every(isAnnotationTrailing)) return null;
  for (const node of p.childNodes) {
    if (node === lead) break;
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      return null;
    }
  }
  const info = parseAnnotation(lead);
  if (!info) return null;
  return { paragraph: p as HTMLElement, annotationKey: info.annotationKey };
}

export function findAnnotationParagraphs(
  container: Element,
): AnnotationParagraph[] {
  const result: AnnotationParagraph[] = [];
  for (const p of container.querySelectorAll(":scope > p")) {
    const matched = matchAnnotationParagraph(p);
    if (matched) result.push(matched);
  }
  return result;
}
