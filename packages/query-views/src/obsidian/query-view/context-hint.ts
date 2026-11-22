import type { ContextRecord } from "@zotlit/item-query";
import type { ReaderDiagnosticSource } from "@zotlit/obsidian-kit/reader-diagnostic.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

export type ContextMember = ContextRecord;

export type ContextSource = "note" | "sidebar";

const BOUND: Record<
  ContextSource,
  Partial<Record<ContextMember, () => string>>
> = {
  note: { item: m.query_view_context_hint_note_item },
  sidebar: {
    item: m.query_view_context_hint_sidebar_item,
    attachment: m.query_view_context_hint_sidebar_attachment,
  },
};

const RECORDS: Record<ContextSource, readonly ContextMember[]> = {
  note: Object.keys(BOUND.note) as ContextMember[],
  sidebar: Object.keys(BOUND.sidebar) as ContextMember[],
};
const UNBOUND: readonly ContextMember[] = [];

export const boundRecords = (
  source: ContextSource | undefined,
): readonly ContextMember[] =>
  source === undefined ? UNBOUND : RECORDS[source];

const ELSEWHERE: Record<ContextMember, () => string> = {
  item: m.query_view_context_hint_item,
  attachment: m.query_view_context_hint_attachment,
};

export function contextHint(
  diagnostic: ReaderDiagnosticSource,
  source: ContextSource | undefined,
): string | null {
  if (diagnostic.code !== "unbound-context") return null;
  const member = memberAt(diagnostic.excerpt?.at);
  if (member === null) return null;
  const bound = source === undefined ? undefined : BOUND[source][member];
  return (bound ?? ELSEWHERE[member])();
}

function memberAt(at: string | undefined): ContextMember | null {
  const [head, member, ...rest] = (at ?? "").split(".").map((s) => s.trim());
  if (head !== "this" || rest.length > 0) return null;
  return member === "item" || member === "attachment" ? member : null;
}
