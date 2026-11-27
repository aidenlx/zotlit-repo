export function attachmentPath(
  linkMode: string | undefined,
  { path, filename }: { readonly path?: string; readonly filename?: string },
): string | null {
  if (linkMode === "linked_file") return path || null;
  if (linkMode !== "linked_url" && filename) return `storage:${filename}`;
  return null;
}

export function attachmentLastRead(value: unknown): number | null {
  if (!value) return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const lastRead = Number.parseInt(String(value), 10);
  return Number.isInteger(lastRead) ? lastRead : null;
}
