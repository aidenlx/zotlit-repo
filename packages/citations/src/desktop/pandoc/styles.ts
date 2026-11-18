// Discovery of the CSL styles Zotero installed, and the Resolved CSL Style each selection renders with.

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

/**
 * Zotero installs styles in `styles/`, and keeps the independent parents that
 * only dependent styles need in `styles/hidden/`.
 *
 * @see https://github.com/zotero/zotero/blob/9.0.3/chrome/content/zotero/xpcom/style.js#L94-L155
 */
export const STYLES_DIR = "styles";
export const HIDDEN_DIR = "hidden";
export const CSL_EXT = ".csl";

/**
 * The Resolved CSL Style of one request, with nothing held between calls. The
 * app's own resolver is {@link InstalledStyleCache}, which answers the same way
 * from the style it already read.
 */
export function resolveInstalledStyle(
  dataDir: string,
  request: CslStyleRequest,
): Effect.Effect<ResolvedCslStyle, never, FileSystem.FileSystem> {
  return new InstalledStyleCache().resolve(dataDir, request);
}

/** One resolution's identity and content, before a Citation Locale applies. */
interface StyleContent {
  styleId: string;
  title: string;
  parentId: string | undefined;
  /** `default-locale` of the requested style, which outlives its parent's. */
  defaultLocale: string | undefined;
  /** The independent style's content, as installed. */
  xml: string;
}

/** A resolved style held in memory, and what a later resolution checks it against. */
interface HeldStyle extends StyleContent {
  dataDir: string;
  /** Files the content was read from, and the content each held. */
  reads: readonly FileRead[];
}

interface FileRead {
  path: string;
  /** The whole file, as the read that produced the held style saw it. */
  xml: string;
}

/**
 * The one installed-style resolver: in-app rendering and the built-in export
 * both read a Resolved CSL Style through it, so a dependent style cannot render
 * one way in Obsidian and another in an export.
 *
 * Resolving a style ID reads every installed `.csl` file, which is far more
 * than a render that only needs the content should pay for. The held copy
 * stands for as long as its own files still hold the content it was read from,
 * so a repeat resolution costs a read of those one or two files. Content is
 * what a resolution answers for, so a style edited in place is picked up
 * whatever timestamp the edit left behind.
 */
export class InstalledStyleCache {
  #held: HeldStyle | undefined;

  /** @returns the Resolved CSL Style, from the held copy where it stands. */
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

      // Every CSL file is one `cs:style` document, a dependent style as much as
      // the independent style it points at, so the requested file answers for its
      // own markup before a parent's formatting stands in for it. A parent stands
      // in for the formatting a dependent file leaves out, never for markup it
      // holds broken.
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
      // The content this resolution stands on, which the next one is checked
      // against: the requested file alone where it is the independent style too.
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

/**
 * The requested style's own Citation Locale survives resolution to its parent:
 * that override is the only thing a dependent style adds to the style it
 * depends on.
 */
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

/** The requested style and the independent style whose formatting it renders with. */
interface StyleSources {
  requested: StyleFile;
  independent: StyleFile;
}

/** Why a lookup found no style to render with, with the provenance it knows. */
interface StyleLookupFailure {
  reason: CslStyleFailure;
  /** CSL ID of the independent parent the requested style names, when it names one. */
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
  // A file discovery could not read may be the very style the lookup wants, so
  // it stands in front of every answer that the install is short a style.
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
  // CSL allows one level of dependency, so a parent that depends on a style of
  // its own leaves nothing to render with.
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

/**
 * Whether the files a held style was read from still hold that very content.
 * A file that changed — or one no longer readable at all — leaves the held
 * style standing for content Zotero no longer installs.
 */
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

/** What one styles directory holds, and whether any of it stayed out of reach. */
interface StyleDirectory {
  files: StyleFile[];
  /**
   * Whether content the lookup may need refused to be read — a `.csl` file, or
   * the directory listing every `.csl` file behind it. Either may hold any
   * style, so a lookup that misses reports a file to repair rather than a
   * missing install.
   */
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

/** A resolver keeps the unreadable-directory diagnostic beside the discovered files. */
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
