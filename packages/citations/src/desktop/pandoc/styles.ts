import type {
  CslStyleFailure,
  CslStyleRequest,
  ResolvedCslStyle,
  StyleFile,
} from "#core/pandoc/csl-style.ts";
import { Effect, FileSystem } from "effect";
import type { PlatformError } from "effect";
import { join } from "node:path";

import { withLogCategory } from "@zotlit/plugin-kernel/effect-log-category.ts";

import {
  cslStyleRoot,
  indexById,
  isStandaloneCslStyle,
  styleFileOf,
  withDefaultLocale,
} from "#core/pandoc/csl-style.ts";

export const STYLES_DIR = "styles";
export const HIDDEN_DIR = "hidden";
export const CSL_EXT = ".csl";

export function resolveInstalledStyle(
  dataDir: string,
  request: CslStyleRequest,
): Effect.Effect<ResolvedCslStyle, never, FileSystem.FileSystem> {
  return new InstalledStyleCache().resolve(dataDir, request);
}

interface StyleContent {
  styleId: string;
  title: string;
  parentId: string | undefined;
  defaultLocale: string | undefined;
  xml: string;
}

interface HeldStyle extends StyleContent {
  dataDir: string;
  reads: readonly FileRead[];
}

interface FileRead {
  path: string;
  xml: string;
}

export class InstalledStyleCache {
  #held: HeldStyle | undefined;

  resolve = Effect.fn("InstalledStyleCache.resolve")(
    function* (
      this: InstalledStyleCache,
      dataDir: string,
      { styleId, locale }: CslStyleRequest,
    ): Effect.fn.Return<ResolvedCslStyle, never, FileSystem.FileSystem> {
      if (!styleId) return { kind: "default", locale: locale ?? undefined };

      const held = this.#held;
      if (held && held.dataDir === dataDir && held.styleId === styleId) {
        if (yield* contentUnchanged(held.reads)) {
          yield* Effect.logTrace("CSL style cache hit").pipe(
            Effect.annotateLogs({ styleId }),
          );
          return resolvedUnderLocale(held, locale);
        }
      }
      this.#held = undefined;

      const located = yield* locateStyle(dataDir, styleId);
      if ("reason" in located) {
        return {
          kind: "failed",
          styleId,
          parentId: located.parentId,
          reason: located.reason,
        };
      }
      const { requested, independent } = located;
      const failed = (reason: CslStyleFailure): ResolvedCslStyle => ({
        kind: "failed",
        styleId,
        parentId: requested.parentId,
        reason,
      });

      const requestedXml = yield* readStyleXml(requested.path);
      if (requestedXml === undefined) return failed("unreadable");
      if (cslStyleRoot(requestedXml) === null) {
        yield* Effect.logWarning(
          "The installed CSL file is no readable CSL style",
        ).pipe(
          Effect.annotateLogs({
            styleId,
            path: requested.path,
          }),
        );
        return failed("invalid");
      }

      const xml =
        requested.path === independent.path
          ? requestedXml
          : yield* readStyleXml(independent.path);
      if (xml === undefined) return failed("unreadable");
      if (!isStandaloneCslStyle(xml)) {
        yield* Effect.logWarning(
          "The installed CSL style renders nothing on its own",
        ).pipe(
          Effect.annotateLogs({
            styleId,
            path: independent.path,
          }),
        );
        return failed("invalid");
      }

      const content: StyleContent = {
        styleId,
        title: requested.title,
        parentId: requested.parentId,
        defaultLocale: requested.defaultLocale,
        xml,
      };
      this.#held = {
        ...content,
        dataDir,
        reads:
          requested.path === independent.path
            ? [{ path: requested.path, xml: requestedXml }]
            : [
                { path: requested.path, xml: requestedXml },
                { path: independent.path, xml },
              ],
      };
      yield* Effect.logDebug("CSL style resolved").pipe(
        Effect.annotateLogs({
          styleId,
          parentId: requested.parentId,
          path: independent.path,
        }),
      );
      return resolvedUnderLocale(content, locale);
    },
    withLogCategory("pandoc", "styles"),
  );
}

function resolvedUnderLocale(
  content: StyleContent,
  locale: string | null | undefined,
): ResolvedCslStyle {
  return {
    kind: "installed",
    styleId: content.styleId,
    title: content.title,
    parentId: content.parentId,
    xml: withDefaultLocale(content.xml, locale ?? content.defaultLocale),
  };
}

interface StyleSources {
  requested: StyleFile;
  independent: StyleFile;
}

interface StyleLookupFailure {
  reason: CslStyleFailure;
  parentId?: string | undefined;
}

const locateStyle = Effect.fnUntraced(function* (
  dataDir: string,
  styleId: string,
): Effect.fn.Return<
  StyleSources | StyleLookupFailure,
  never,
  FileSystem.FileSystem
> {
  const root = join(dataDir, STYLES_DIR);
  const [visible, hidden] = yield* Effect.all(
    [readStyleDirOrEmpty(root), readStyleDirOrEmpty(join(root, HIDDEN_DIR))],
    { concurrency: "unbounded" },
  );
  const styles = indexById([...visible.files, ...hidden.files]);
  const unreadable = visible.unreadable || hidden.unreadable;

  const requested = styles.get(styleId);
  if (!requested) {
    if (unreadable) {
      yield* Effect.logWarning(
        "A CSL style file the request may name refuses to be read",
      ).pipe(
        Effect.annotateLogs({
          styleId,
          dataDir,
        }),
      );
      return { reason: "unreadable" };
    }
    yield* Effect.logDebug("The requested CSL style is not installed").pipe(
      Effect.annotateLogs({
        styleId,
        dataDir,
      }),
    );
    return { reason: "style-missing" };
  }
  if (requested.parentId === undefined) {
    return { requested, independent: requested };
  }

  const { parentId } = requested;
  const independent = styles.get(parentId);
  if (!independent) {
    if (unreadable) {
      yield* Effect.logWarning(
        "The independent parent of a CSL style refuses to be read",
      ).pipe(
        Effect.annotateLogs({
          styleId,
          parentId,
        }),
      );
      return { reason: "unreadable", parentId };
    }
    yield* Effect.logDebug(
      "The independent parent of a CSL style is not installed",
    ).pipe(
      Effect.annotateLogs({
        styleId,
        parentId,
      }),
    );
    return { reason: "parent-missing", parentId };
  }
  if (independent.parentId !== undefined) {
    yield* Effect.logWarning(
      "The independent parent of a CSL style is itself dependent",
    ).pipe(
      Effect.annotateLogs({
        styleId,
        parentId,
      }),
    );
    return { reason: "invalid", parentId };
  }
  return { requested, independent };
});

const contentUnchanged = Effect.fnUntraced(function* (
  reads: readonly FileRead[],
) {
  const current = yield* Effect.forEach(
    reads,
    ({ path }) => readStyleXml(path),
    {
      concurrency: "unbounded",
    },
  );
  return reads.every((read, index) => read.xml === current[index]);
});

interface StyleDirectory {
  files: StyleFile[];
  unreadable: boolean;
}

export const readStyleDir = Effect.fnUntraced(function* (
  dir: string,
): Effect.fn.Return<
  StyleDirectory,
  PlatformError.PlatformError,
  FileSystem.FileSystem
> {
  const fs = yield* FileSystem.FileSystem;
  const names = yield* fs
    .readDirectory(dir)
    .pipe(
      Effect.catchReason("PlatformError", "NotFound", () =>
        Effect.succeed<string[]>([]),
      ),
    );
  const contents = yield* Effect.forEach(
    names.filter((name) => name.endsWith(CSL_EXT)),
    Effect.fnUntraced(function* (name) {
      const path = join(dir, name);
      return { path, xml: yield* readStyleXml(path) };
    }),
    { concurrency: "unbounded" },
  );
  const files: StyleFile[] = [];
  let unreadable = false;
  for (const { path, xml } of contents) {
    if (xml === undefined) {
      unreadable = true;
      continue;
    }
    const file = styleFileOf(path, xml);
    if (file) files.push(file);
    else
      yield* Effect.logWarning(
        "Skipped a CSL file that declares no style ID",
      ).pipe(
        Effect.annotateLogs({
          path,
        }),
      );
  }
  return { files, unreadable };
});

export const readStyleDirOrEmpty = (dir: string) =>
  readStyleDir(dir).pipe(
    Effect.catchTag("PlatformError", (error) =>
      Effect.as(
        Effect.logWarning("Cannot read the Zotero styles directory").pipe(
          Effect.annotateLogs({ dir, error }),
        ),
        { files: [], unreadable: true } satisfies StyleDirectory,
      ),
    ),
  );

const readStyleXml = Effect.fnUntraced(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs
    .readFileString(path)
    .pipe(
      Effect.catchTag("PlatformError", (error) =>
        Effect.as(
          Effect.logWarning("Cannot read a CSL style file").pipe(
            Effect.annotateLogs({ path, error }),
          ),
          undefined,
        ),
      ),
    );
});
