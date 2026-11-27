import { logLibrary } from "@zotlit/shared/logging";
import { isItemKey } from "@zotlit/zotero-types/keys";

const LINK_MODE = {
  0: "imported_file",
  1: "imported_url",
  2: "linked_file",
  3: "linked_url",
  4: "embedded_image",
} as const;

export type LinkMode = keyof typeof LINK_MODE;
export type LinkModeName = (typeof LINK_MODE)[LinkMode];

export function linkModeToName(linkMode: LinkMode): LinkModeName | "unknown" {
  const name = LINK_MODE[linkMode];
  if (name) return name;

  logLibrary({
    level: "warn",
    category: ["zotlit", "db", "attachments"],
    message: "Unknown attachment link mode {linkMode}",
    properties: { linkMode },
  });
  return "unknown";
}

export function linkModeFromName(name: string): LinkMode | undefined {
  const found = Object.entries(LINK_MODE).find(
    ([, modeName]) => modeName === name,
  );
  return found ? (Number(found[0]) as LinkMode) : undefined;
}

export interface Attachment {
  itemID: number;
  libraryID: number;
  groupID: number | null;
  key: string;
  indexedKey: string;
  parentItemID: number;
  path: string | null;
  contentType: string | null;
  linkMode: LinkMode | null;
  dateAdded: Temporal.Instant;
  dateModified: Temporal.Instant;
}

const STORAGE_PREFIX = "storage:";

const BASE_PATH_PLACEHOLDER = "attachments:";

export interface StoragePath {
  kind: "storage";
  filename: string;
}

export interface LinkedAbsolutePath {
  kind: "linked-absolute";
  path: string;
}

export interface LinkedBasePath {
  kind: "linked-base";
  relative: string;
}

export interface LinkedUrlPath {
  kind: "linked-url";
  url: string;
}

export interface UnknownPath {
  kind: "unknown";
  raw: string | null;
}

export type AttachmentPath =
  | StoragePath
  | LinkedAbsolutePath
  | LinkedBasePath
  | LinkedUrlPath
  | UnknownPath;

const PATH_SEPARATOR_RE = /[/\\]/;

const DRIVE_PREFIX_RE = /^[A-Za-z]:/;

function isSingleSegment(value: string): boolean {
  return (
    !PATH_SEPARATOR_RE.test(value) &&
    !DRIVE_PREFIX_RE.test(value) &&
    value !== ".."
  );
}

export function parseAttachmentPath(
  path: string | null,
  linkMode: LinkMode | null,
  key: string,
): AttachmentPath {
  if (!path || linkMode === null) return { kind: "unknown", raw: path };
  if (!isItemKey(key)) return { kind: "unknown", raw: path };

  switch (linkModeToName(linkMode)) {
    case "imported_file":
    case "imported_url":
    case "embedded_image": {
      if (!path.startsWith(STORAGE_PREFIX))
        return { kind: "unknown", raw: path };
      const filename = path.slice(STORAGE_PREFIX.length);
      return isSingleSegment(filename)
        ? { kind: "storage", filename }
        : { kind: "unknown", raw: path };
    }
    case "linked_file":
      return path.startsWith(BASE_PATH_PLACEHOLDER)
        ? {
            kind: "linked-base",
            relative: path.slice(BASE_PATH_PLACEHOLDER.length),
          }
        : { kind: "linked-absolute", path };
    case "linked_url":
      return { kind: "linked-url", url: path };
    default:
      return { kind: "unknown", raw: path };
  }
}
