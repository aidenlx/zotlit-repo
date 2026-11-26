import { Effect, FileSystem } from "effect";
import type { PlatformError, Scope } from "effect";
import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import { isCaseInsensitivePlatform } from "@zotlit/db/path";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { isErrno, nodeFileSystemCall } from "@zotlit/plugin-kernel/errno.ts";
import type { OperatingSystem } from "@zotlit/shared/platform";

import type { AttachmentCopySource } from "./copy-attachments.ts";

const logged = withLogCategory("attachment-import");

const OPEN_NO_FOLLOW = process.platform !== "win32";

const nativeRealPath = (
  path: string,
): Effect.Effect<string, PlatformError.PlatformError> =>
  nodeFileSystemCall("realPath", path, () => realpath(path));

export type SourceOrigin =
  | "storage"
  | "linked-base"
  | "linked-absolute"
  | "annotation-cache";

const APPROVED_SOURCE_BRAND = Symbol("attachment-source-approved");

export type AttachmentSource =
  | {
      readonly [APPROVED_SOURCE_BRAND]: true;
      approved: true;
      path: string;
      origin: SourceOrigin;
      root: string;
    }
  | BlockedSource;

export type SourceBlock = "no-trusted-root" | "outside-trusted-root";

export interface BlockedSource {
  approved: false;
  path: string;
  origin: SourceOrigin;
  reason: SourceBlock;
}

export interface CanonicalRoot {
  declared: string;
  canonical: string;
}

export interface CanonicalRoots {
  storage: CanonicalRoot | null;
  annotationCache: CanonicalRoot | null;
  base: CanonicalRoot | null;
  approved: readonly CanonicalRoot[];
  caseInsensitive: boolean;
}

export const NO_ROOTS: CanonicalRoots = Object.freeze({
  storage: null,
  annotationCache: null,
  base: null,
  approved: Object.freeze([]),
  caseInsensitive: false,
});

export interface RootSources {
  dataDir: string;
  baseAttachmentPath: string | null;
  approvedFolders: readonly string[];
}

export const buildCanonicalRoots = Effect.fnUntraced(function* (
  sources: RootSources,
  platform: OperatingSystem,
) {
  const [storage, annotationCache, base, approved] = yield* Effect.all(
    [
      trustedRoot(join(sources.dataDir, "storage")),
      trustedRoot(join(sources.dataDir, "cache")),
      sources.baseAttachmentPath === null
        ? Effect.succeed(null)
        : trustedRoot(sources.baseAttachmentPath),
      Effect.forEach(
        sources.approvedFolders,
        (folder) => approvedRoot(folder),
        {
          concurrency: "unbounded",
        },
      ),
    ],
    { concurrency: "unbounded" },
  );
  const roots: CanonicalRoots = {
    storage,
    annotationCache,
    base,
    approved: approved.filter((root) => root !== null),
    caseInsensitive: isCaseInsensitivePlatform(platform),
  };
  return roots;
});

export function decideSource(
  path: string,
  origin: SourceOrigin,
  roots: CanonicalRoots,
): AttachmentSource {
  const trusted = rootsForOrigin(origin, roots);
  for (const root of trusted) {
    if (isInside(root.declared, path, roots.caseInsensitive)) {
      return approve(path, origin, root.canonical);
    }
  }
  return {
    approved: false,
    path,
    origin,
    reason: trusted.length === 0 ? "no-trusted-root" : "outside-trusted-root",
  };
}

export type SourceRefusal = "not-a-regular-file" | "escaped-root";

export type ConfirmedSource =
  | { status: "confirmed"; source: AttachmentCopySource }
  | { status: "missing" }
  | { status: "refused"; reason: SourceRefusal };

export const confirmSource = Effect.fnUntraced(function* (
  source: { path: string; root: string; origin: SourceOrigin },
  caseInsensitive: boolean,
): Effect.fn.Return<
  ConfirmedSource,
  PlatformError.PlatformError,
  FileSystem.FileSystem | Scope.Scope
> {
  const fs = yield* FileSystem.FileSystem;
  const located = yield* Effect.gen(function* () {
    const canonical = yield* nativeRealPath(source.path);
    const { type } = yield* fs.stat(canonical);
    return { canonical, type };
  }).pipe(
    Effect.catchReason("PlatformError", "NotFound", () =>
      Effect.succeed(MISSING),
    ),
    Effect.catchReason("PlatformError", "BadResource", (reason) =>
      Effect.succeed(isErrno(reason.cause, "ELOOP") ? ESCAPED : MISSING),
    ),
  );
  if ("status" in located) return located;
  const { canonical, type } = located;
  if (type !== "File") {
    return { status: "refused", reason: "not-a-regular-file" };
  }
  if (!isInside(source.root, canonical, caseInsensitive)) return ESCAPED;
  if (!readsFromDescriptor(source.origin)) {
    return { status: "confirmed", source: { kind: "path", path: canonical } };
  }
  return yield* fs.open(canonical, { noFollow: OPEN_NO_FOLLOW }).pipe(
    Effect.map((handle): ConfirmedSource => ({
      status: "confirmed",
      source: { kind: "handle", handle },
    })),
    Effect.catchReason("PlatformError", "NotFound", () =>
      Effect.succeed(MISSING),
    ),
    Effect.catchReason("PlatformError", "BadResource", (reason, error) => {
      if (isErrno(reason.cause, "ELOOP")) return Effect.succeed(ESCAPED);
      if (isErrno(reason.cause, "ENOTDIR")) return Effect.succeed(MISSING);
      return Effect.fail(error);
    }),
  );
});

const MISSING: ConfirmedSource = { status: "missing" };
const ESCAPED: ConfirmedSource = { status: "refused", reason: "escaped-root" };

function readsFromDescriptor(origin: SourceOrigin): boolean {
  switch (origin) {
    case "storage":
    case "annotation-cache":
      return false;
    case "linked-base":
    case "linked-absolute":
      return true;
  }
}

function isInside(
  root: string,
  candidate: string,
  caseInsensitive: boolean,
): boolean {
  const rel = relative(
    fold(root, caseInsensitive),
    fold(candidate, caseInsensitive),
  );
  return (
    rel !== "" &&
    rel !== ".." &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel)
  );
}

function rootsForOrigin(
  origin: SourceOrigin,
  roots: CanonicalRoots,
): readonly CanonicalRoot[] {
  switch (origin) {
    case "storage":
      return roots.storage ? [roots.storage] : [];
    case "annotation-cache":
      return roots.annotationCache ? [roots.annotationCache] : [];
    case "linked-base":
      return roots.base ? [roots.base] : [];
    case "linked-absolute":
      return roots.approved;
  }
}

function approve(
  path: string,
  origin: SourceOrigin,
  root: string,
): AttachmentSource {
  const source = { approved: true, path, origin, root } as AttachmentSource;
  Object.defineProperty(source, APPROVED_SOURCE_BRAND, {
    value: true,
    enumerable: false,
  });
  return source;
}

const trustedRoot = (declared: string) =>
  canonicalize(declared).pipe(
    Effect.map((canonical): CanonicalRoot | null =>
      canonical === null ? null : { declared, canonical },
    ),
    dropUnreadable,
  );

const dropUnreadable = <A>(
  root: Effect.Effect<A | null, PlatformError.PlatformError>,
): Effect.Effect<A | null> =>
  root.pipe(
    Effect.catchTag("PlatformError", (error) =>
      Effect.logWarning("Dropped an attachment root that cannot be read").pipe(
        Effect.annotateLogs({ reason: error.reason._tag }),
        logged,
        Effect.as(null),
      ),
    ),
  );

const approvedRoot = (folder: string) =>
  canonicalize(folder).pipe(
    Effect.map((canonical): CanonicalRoot | null =>
      canonical === folder ? { declared: folder, canonical: folder } : null,
    ),
    dropUnreadable,
  );

export const canonicalize = (
  path: string,
): Effect.Effect<string | null, PlatformError.PlatformError> =>
  nativeRealPath(path).pipe(
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)),
    Effect.catchReason("PlatformError", "BadResource", () =>
      Effect.succeed(null),
    ),
  );

function fold(path: string, caseInsensitive: boolean): string {
  return caseInsensitive ? path.toLowerCase() : path;
}
