import type { SnapshotUnavailableValue } from "#contract/snapshot/types.ts";

const REDACTED_FIELDS = new Map([
  ["filePath", "Attachment paths are not included in Item Snapshots."],
  [
    "weblink",
    "A personal-library web link carries the Zotero account name, so it is not included in Item Snapshots.",
  ],
]);

export function collectUnavailable(
  root: Record<string, unknown>,
  rootPath: string,
): SnapshotUnavailableValue[] {
  const unavailable: SnapshotUnavailableValue[] = [];
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;

    const record = value as Record<string, unknown>;
    if (typeof record.$inert === "string") {
      unavailable.push({ path, reason: record.$inert });
      return;
    }
    if (record.$helper === "fileLink" && record.value === null) {
      unavailable.push({
        path,
        reason: "The Attachment has no permitted vault-relative target.",
      });
      return;
    }
    for (const [key, entry] of Object.entries(record)) {
      const childPath = `${path}.${key}`;
      const reason = entry === null ? REDACTED_FIELDS.get(key) : undefined;
      if (reason === undefined) visit(entry, childPath);
      else unavailable.push({ path: childPath, reason });
    }
  };
  visit(root, rootPath);
  return unavailable;
}
