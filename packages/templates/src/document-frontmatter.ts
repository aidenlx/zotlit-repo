import { parseDocument as parseYamlDocument } from "yaml";

export type DocumentSplit =
  | {
      readonly kind: "split";
      readonly manifestSource: string;
      readonly manifestStart: number;
      readonly bodyStart: number;
    }
  | { readonly kind: "no-manifest" }
  | { readonly kind: "unclosed-manifest" };

export function splitDocumentFrontmatter(source: string): DocumentSplit {
  const firstLineEnd = source.indexOf("\n");
  if (
    firstLineEnd === -1 ||
    trimCarriageReturn(source.slice(0, firstLineEnd)) !== "---"
  ) {
    return { kind: "no-manifest" };
  }

  let lineStart = firstLineEnd + 1;
  while (lineStart <= source.length) {
    const lineEnd = source.indexOf("\n", lineStart);
    const end = lineEnd === -1 ? source.length : lineEnd;
    if (trimCarriageReturn(source.slice(lineStart, end)) === "---") {
      return {
        kind: "split",
        manifestSource: source.slice(firstLineEnd + 1, lineStart),
        manifestStart: firstLineEnd + 1,
        bodyStart: lineEnd === -1 ? source.length : lineEnd + 1,
      };
    }
    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
  }

  return { kind: "unclosed-manifest" };
}

export function trimCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

export interface ManifestYamlError {
  readonly message: string;
  readonly offset: number;
  readonly cause: unknown;
}

export function parseManifestYaml(
  source: string,
  start: number,
  onSyntaxError: (error: ManifestYamlError) => Error,
): unknown {
  const document = parseYamlDocument(source, { uniqueKeys: true });
  const error = document.errors[0];
  if (error) {
    throw onSyntaxError({
      message: error.message,
      offset: start + error.pos[0],
      cause: error,
    });
  }
  return document.toJS();
}
