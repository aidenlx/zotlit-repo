import type { Pos } from "obsidian";

export type CitationSyntax = "citekey" | "wikilink" | "annotation";

export interface CitationOccurrence {
  kind: CitationSyntax;
  raw: string;
  fragment?: string;
  position: Pos;
  pageLabel?: string | null;
}

export interface MalformedWikilinkCitation {
  occurrence: CitationOccurrence;
}

export function occurrencesEqual(
  prev: readonly CitationOccurrence[],
  next: readonly CitationOccurrence[],
): boolean {
  if (prev.length !== next.length) return false;
  return prev.every((occurrence, index) => {
    const other = next[index]!;
    return (
      occurrence.kind === other.kind &&
      occurrence.raw === other.raw &&
      occurrence.fragment === other.fragment &&
      occurrence.pageLabel === other.pageLabel &&
      occurrence.position.start.offset === other.position.start.offset &&
      occurrence.position.end.offset === other.position.end.offset
    );
  });
}

export function maskWikilinks(text: string): string {
  const body = text.split("");
  for (let at = 0; at < body.length; at += 1) {
    if (body[at] === "\\") {
      at += 1;
    } else if (body[at] === "[" && body[at + 1] === "[") {
      at = maskWikilink(body, at);
    }
  }
  return body.join("");
}

function mask(body: string[], from: number, to: number): void {
  for (let at = from; at < to; at += 1) {
    if (body[at] !== "\n") body[at] = " ";
  }
}

function maskWikilink(body: string[], open: number): number {
  for (let at = open + 2; at < body.length - 1 && body[at] !== "\n"; at += 1) {
    if (body[at] !== "]" || body[at + 1] !== "]") continue;
    mask(body, open, at + 2);
    return at + 1;
  }
  return open + 1;
}
