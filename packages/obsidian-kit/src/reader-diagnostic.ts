import type { Diagnostic } from "@zotlit/item-query";
import * as m from "@zotlit/plugin-messages/messages.ts";

export type ReaderDiagnosticSource = Pick<Diagnostic, "message" | "hint"> &
  Partial<Pick<Diagnostic, "excerpt" | "expected" | "suggestions">> & {
    code: string;
  };

export interface ReaderDiagnostic {
  sentence: string;
  corrections: readonly string[];
  excerpt?: { line: string; from: number; length: number };
}

export function readerDiagnostic(
  source: ReaderDiagnosticSource,
): ReaderDiagnostic {
  const { message, hint, excerpt, suggestions = [] } = source;
  const sentence = [message, restates(source) ? "" : hint]
    .filter(Boolean)
    .join(" ");
  const corrections = suggestions.length > 1 ? suggestions : [];
  if (!excerpt) return { sentence, corrections };
  const head = excerpt.before.slice(excerpt.before.lastIndexOf("\n") + 1);
  const [at = ""] = excerpt.at.split("\n");
  const tail = excerpt.at.includes("\n")
    ? ""
    : (excerpt.after.split("\n")[0] ?? "");
  return {
    sentence,
    corrections,
    excerpt: {
      line: head + at + tail,
      // oxlint-disable-next-line typescript/no-misused-spread -- offsets count code points, not grapheme clusters
      from: [...head].length,
      // oxlint-disable-next-line typescript/no-misused-spread -- offsets count code points, not grapheme clusters
      length: Math.max(1, [...at].length),
    },
  };
}

function restates({
  message,
  hint,
  expected = [],
  suggestions = [],
}: ReaderDiagnosticSource): boolean {
  if (suggestions.length > 0 || expected.length === 0) return false;
  const list = `${expected.join(", ")}.`;
  if (!message.endsWith(` ${list}`) || !hint.endsWith(` ${list}`)) return false;
  const lead = hint.slice(0, -list.length - 1);
  return lead !== "" && !/\s/.test(lead);
}

export function readerText(source: ReaderDiagnosticSource): string {
  const { sentence, corrections } = readerDiagnostic(source);
  return [sentence, correctionsText(corrections)].filter(Boolean).join(" ");
}

export function correctionsText(corrections: readonly string[]): string {
  if (corrections.length === 0) return "";
  return m.query_view_diagnostic_corrections({
    suggestions: corrections.join(", "),
  });
}
