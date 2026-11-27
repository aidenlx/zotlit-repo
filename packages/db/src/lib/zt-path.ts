import type { OperatingSystem } from "@zotlit/shared/platform";

import type { AnnotationType, ResolvedAnnotationTypeName } from "./zt-annot.ts";
import { annotationHasCacheImage } from "./zt-annot.ts";
import type { Attachment } from "./zt-attach.ts";
import { parseAttachmentPath } from "./zt-attach.ts";

export { parseAttachmentPath, type AttachmentPath } from "./zt-attach.ts";

const POSIX_SEPARATOR_RE = /\/+/;
const WINDOWS_SEPARATOR_RE = /[\\/]+/;
const WINDOWS_DRIVE_RE = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_RE = /^\\\\([^\\/]+)[\\/]+([^\\/]+)/;

function foldSegments(
  rest: string,
  separatorRe: RegExp,
  rooted: boolean,
): string[] {
  const segments: string[] = [];
  for (const segment of rest.split(separatorRe)) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") segments.push(segment);
    else if (segments.length > 0 && segments.at(-1) !== "..") segments.pop();
    else if (!rooted) segments.push("..");
  }
  return segments;
}

function normalizePosix(path: string): string {
  const rooted = path.startsWith("/");
  const joined = foldSegments(path, POSIX_SEPARATOR_RE, rooted).join("/");
  if (rooted) return `/${joined}`;
  return joined === "" ? "." : joined;
}

function normalizeWindows(root: string, rest: string): string {
  return root + foldSegments(rest, WINDOWS_SEPARATOR_RE, true).join("\\");
}

function join(...parts: string[]): string {
  const joined = parts.filter((part) => part !== "").join("/");
  const unc = WINDOWS_UNC_RE.exec(joined);
  if (unc !== null)
    return normalizeWindows(
      `\\\\${unc[1]}\\${unc[2]}\\`,
      joined.slice(unc[0].length),
    );
  if (WINDOWS_DRIVE_RE.test(joined))
    return normalizeWindows(`${joined.slice(0, 2)}\\`, joined.slice(3));
  return normalizePosix(joined);
}

export interface AttachmentPathContext {
  dataDir: string | null;
  baseAttachmentPath: string | null;
}

export interface AnnotCachePathContext {
  dataDir: string | null;
  groupID: number | null;
}

export function resolveAnnotCachePath(
  annotation: {
    key: string;
    type: AnnotationType | ResolvedAnnotationTypeName;
  },
  { dataDir, groupID }: AnnotCachePathContext,
): string | null {
  if (dataDir === null || !annotationHasCacheImage(annotation.type))
    return null;
  const libraryPath =
    groupID === null ? "library" : join("groups", String(groupID));
  return join(dataDir, "cache", libraryPath, `${annotation.key}.png`);
}

export function attachmentAbsPath(
  attachment: Attachment,
  ctx: AttachmentPathContext,
): string | null {
  if (ctx.dataDir === null) return null;
  const parsed = parseAttachmentPath(
    attachment.path,
    attachment.linkMode,
    attachment.key,
  );
  switch (parsed.kind) {
    case "storage":
      return join(ctx.dataDir, "storage", attachment.key, parsed.filename);
    case "linked-absolute":
      return parsed.path;
    case "linked-base":
      return ctx.baseAttachmentPath
        ? join(ctx.baseAttachmentPath, parsed.relative)
        : null;
    case "linked-url":
    case "unknown":
      return null;
  }
}

const CASE_INSENSITIVE_PLATFORMS: ReadonlySet<OperatingSystem> = new Set([
  "darwin",
  "win32",
]);

export function isCaseInsensitivePlatform(platform: OperatingSystem): boolean {
  return CASE_INSENSITIVE_PLATFORMS.has(platform);
}

const SEPARATOR_RUN_RE = /[\\/]+/g;
const TRAILING_SEPARATOR_RE = /(?<=.)\/+$/;

export function normalizeAbsolutePath(path: string): string {
  return normalizePosix(path.replaceAll(SEPARATOR_RUN_RE, "/")).replace(
    TRAILING_SEPARATOR_RE,
    "",
  );
}

export function attachmentPathKey(
  path: string,
  platform: OperatingSystem,
): string {
  const normalized = normalizeAbsolutePath(path);
  return isCaseInsensitivePlatform(platform)
    ? normalized.toLowerCase()
    : normalized;
}
