import * as m from "@zotlit/plugin-messages/messages.ts";

const CLAIMED = ["[@", "【@", "[["] as const;

export type AnnotationTriggerProblem = "empty" | "whitespace" | "citation";

export function annotationTriggerProblem(
  trigger: string,
): AnnotationTriggerProblem | null {
  if (trigger === "") return "empty";
  if (/\s/.test(trigger)) return "whitespace";
  if (
    trigger.includes("@") ||
    CLAIMED.some(
      (claimed) => claimed.startsWith(trigger) || trigger.startsWith(claimed),
    )
  )
    return "citation";
  return null;
}

export function annotationTriggerError(trigger: string): string | undefined {
  switch (annotationTriggerProblem(trigger)) {
    case "whitespace":
      return m.settings_citation_annotation_trigger_whitespace();
    case "citation":
      return m.settings_citation_annotation_trigger_citation();
    case "empty":
    case null:
      return undefined;
  }
}

export interface AnnotationTrigger {
  start: number;
  end: number;
  query: string;
}

export function resolveAnnotationTrigger(
  line: string,
  ch: number,
  { trigger }: { trigger: string },
): AnnotationTrigger | null {
  if (annotationTriggerProblem(trigger) !== null) return null;
  const beforeCursor = line.slice(0, ch);
  const start = beforeCursor.lastIndexOf(trigger);
  if (start === -1) return null;
  const query = beforeCursor.slice(start + trigger.length);
  if (/[\]】]/.test(query)) return null;
  const pair = { "[": "]", "【": "】" }[trigger.charAt(0)];
  return {
    start,
    end: pair !== undefined && line.charAt(ch) === pair ? ch + 1 : ch,
    query,
  };
}
