import type { ResolvedAnnotationTypeName } from "@zotlit/db";

const TYPE_ICON: Record<string, string> = {
  highlight: "align-left",
  underline: "underline",
  image: "frame",
  ink: "pen-line",
  text: "type",
  note: "sticky-note",
};

export function typeIcon(type: ResolvedAnnotationTypeName): string {
  return TYPE_ICON[type] ?? "file-question";
}
