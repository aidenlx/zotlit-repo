import { Effect } from "effect";
import { parseLinktext } from "obsidian";
import type { LinkCache } from "obsidian";

const CITE_FRAGMENT_PREFIX = "#cite:";

const PERCENT_RUN = /(?:%[0-9A-Fa-f]{2})+/g;

export type ResolveErrorCode =
  | "file-not-found"
  | "database-unavailable"
  | "item-not-found"
  | "citation-key-missing"
  | "duplicate-citation-key"
  | "unresolved-citation-intent"
  | "flags-invalid";

export interface ResolveError {
  code: ResolveErrorCode;
  linkpath?: string;
  indexedKey?: string;
  message: string;
}

export type ResolveResponse =
  | { citations: Record<string, string> }
  | { errors: ResolveError[] };

export interface ResolveDocument {
  sourcePath: string;
  links: readonly LinkCache[];
}

export interface ResolvedItem {
  citationKey: string | null;
  title: string;
}

export interface DatabaseDescription {
  dataDir: string;
  readMode: string | null;
}

export interface ResolvePorts {
  readDocument: (absolutePath: string) => Effect.Effect<ResolveDocument | null>;
  resolveIndexedKey: (
    linkpath: string,
    sourcePath: string,
  ) => Effect.Effect<string | null>;
  database: {
    describe: () => Effect.Effect<DatabaseDescription>;
    read: (
      indexedKeys: readonly string[],
    ) => Effect.Effect<ReadonlyMap<string, ResolvedItem> | null>;
  };
}

export interface CitationLink {
  linkpath: string;
  indexedKey: string;
}

export const resolveCitations = Effect.fn("Pandoc.resolveCitations")(function* (
  absolutePath: string,
  ports: ResolvePorts,
): Effect.fn.Return<ResolveResponse> {
  const document = yield* ports.readDocument(absolutePath);
  if (!document) {
    return {
      errors: [
        {
          code: "file-not-found",
          message: `No vault file at "${absolutePath}".`,
        },
      ],
    };
  }

  const { links, errors } = yield* collectCitationLinks(
    document,
    ports.resolveIndexedKey,
  );
  if (links.length === 0) {
    return errors.length > 0 ? { errors } : { citations: {} };
  }

  const items = yield* ports.database.read(
    links.map((link) => link.indexedKey),
  );
  if (!items) {
    const { dataDir, readMode } = yield* ports.database.describe();
    errors.push({
      code: "database-unavailable",
      message: `Cannot read the Zotero database in data directory "${dataDir}" (read mode: ${readMode ?? "unavailable"}).`,
    });
    return { errors };
  }

  const citations: Record<string, string> = {};
  const owners = new Map<string, CitationLink>();
  for (const link of links) {
    const { linkpath, indexedKey } = link;
    const item = items.get(indexedKey);
    if (!item) {
      errors.push({
        code: "item-not-found",
        linkpath,
        indexedKey,
        message: `No live Item matches Indexed Key "${indexedKey}" — the Item may have been deleted from Zotero.`,
      });
      continue;
    }
    if (item.citationKey === null) {
      errors.push({
        code: "citation-key-missing",
        linkpath,
        indexedKey,
        message: `The Item "${item.title}" (Indexed Key "${indexedKey}") has no citation key.`,
      });
      continue;
    }
    const owner = owners.get(item.citationKey);
    if (owner && owner.indexedKey !== indexedKey) {
      errors.push({
        code: "duplicate-citation-key",
        linkpath,
        indexedKey,
        message: `Citation key "${item.citationKey}" belongs to two Items: "${owner.linkpath}" (Indexed Key "${owner.indexedKey}") and "${linkpath}" (Indexed Key "${indexedKey}").`,
      });
      continue;
    }
    owners.set(item.citationKey, link);
    citations[linkpath] = item.citationKey;
  }

  return errors.length > 0 ? { errors } : { citations };
});

export const collectCitationLinks = Effect.fn("Pandoc.collectCitationLinks")(
  function* (
    document: ResolveDocument,
    resolveIndexedKey: ResolvePorts["resolveIndexedKey"],
  ): Effect.fn.Return<{ links: CitationLink[]; errors: ResolveError[] }> {
    const links: CitationLink[] = [];
    const errors: ResolveError[] = [];
    const resolved = new Map<string, string | null>();
    const reported = new Set<string>();

    for (const link of document.links) {
      const { path, subpath } = parseLinktext(link.link);
      if (path === "") continue;
      const linkpath = decodeLinkpath(path);

      let indexedKey = resolved.get(linkpath);
      if (indexedKey === undefined) {
        indexedKey = yield* resolveIndexedKey(linkpath, document.sourcePath);
        resolved.set(linkpath, indexedKey);
        if (indexedKey !== null) links.push({ linkpath, indexedKey });
      }
      if (indexedKey !== null) continue;

      if (!subpath.startsWith(CITE_FRAGMENT_PREFIX)) continue;
      if (reported.has(linkpath)) continue;
      reported.add(linkpath);
      errors.push({
        code: "unresolved-citation-intent",
        linkpath,
        message: `The "${subpath}" fragment declares a Citation, but "${linkpath}" does not resolve to a Literature Note.`,
      });
    }

    return { links, errors };
  },
);

function decodeLinkpath(path: string): string {
  return path.replaceAll(PERCENT_RUN, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}
