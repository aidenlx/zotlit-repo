import type {
  ParseFailed,
  ParseWorkerDied,
} from "#core/citation-parse/client.ts";
import type { CitationLookup } from "#obsidian/citation-index/lookup-service.ts";
import type {
  CitationEngine,
  DocumentFormat,
} from "#obsidian/pandoc/engine.ts";
import type {
  ResolveDocument,
  ResolvePorts,
} from "#obsidian/pandoc/resolve.ts";
import { Effect, Result } from "effect";

import type { CslItemData } from "@zotlit/db";

import type {
  BibliographyFailure,
  BibliographyItemRef,
  BibliographyResult,
  BibliographySource,
} from "./bibliography.ts";

import {
  PANDOC_RESOLVE_MAP_FILENAME,
  pandocSandboxFilter,
} from "#core/pandoc/filter/index.ts";
import { ParsedNote } from "#obsidian/citation-index/parsed-note.ts";
import { CitationParse } from "#obsidian/citation-parse/service.ts";
import { collectCitationLinks } from "#obsidian/pandoc/resolve.ts";

export { type BibliographySource } from "./bibliography.ts";

export interface ExportRequest {
  document: ResolveDocument;
  markdown: string;
  format: DocumentFormat;
  styleXml?: string;
  locale?: string;
}

export interface ExportPorts {
  resolveIndexedKey: ResolvePorts["resolveIndexedKey"];
  readLookup: (request: {
    citekeys: readonly string[];
  }) => ReturnType<CitationLookup["Service"]["read"]>;
  readItemRefs: (
    indexedKeys: readonly string[],
  ) => Effect.Effect<ReadonlyMap<string, BibliographyItemRef> | null>;
  dataDir: () => string;
  fetchBibliography: (
    refs: readonly BibliographyItemRef[],
  ) => Effect.Effect<BibliographyResult>;
  engine: Pick<CitationEngine, "prepareDocument" | "renderPrepared">;
}

export type ExportFailure =
  | { kind: "citation-intent"; linkpaths: string[] }
  | { kind: "database-unavailable"; dataDir: string }
  | { kind: "items-missing"; sources: string[] }
  | { kind: "citation-keys-missing"; sources: string[] }
  | { kind: "citation-keys-unknown"; citekeys: string[] }
  | { kind: "citation-keys-ambiguous"; citekeys: string[] }
  | { kind: "zotero-port-automatic"; pref: string }
  | { kind: "zotero-unreachable"; port: number }
  | { kind: "zotero-timeout"; seconds: number }
  | { kind: "local-api-disabled"; pref: string }
  | { kind: "source-failed"; source: BibliographySource; detail: string }
  | { kind: "engine"; detail: string };

export type ExportResult = { output: Uint8Array } | { error: ExportFailure };

export const exportCitedDocument = Effect.fn("exportCitedDocument")(function* (
  request: ExportRequest,
  ports: ExportPorts,
): Effect.fn.Return<
  ExportResult,
  ParseWorkerDied | ParseFailed,
  CitationParse
> {
  const parser = yield* CitationParse;
  const { record } = yield* parser.parse({
    path: request.document.sourcePath,
    generation: 0,
    text: request.markdown,
  });
  const { links, errors } = yield* collectCitationLinks(
    {
      sourcePath: request.document.sourcePath,
      links: record.links
        .filter((link) => !link.embedded)
        .map((link) => ({
          link: link.target,
          original: request.markdown.slice(
            link.position.start.offset,
            link.position.end.offset,
          ),
          position: link.position,
        })),
    },
    ports.resolveIndexedKey,
  );
  if (errors.length > 0) {
    return {
      error: {
        kind: "citation-intent",
        linkpaths: errors.map((error) => error.linkpath!),
      },
    };
  }

  const wikilinked = new Map(
    links.map(({ linkpath, indexedKey }) => [linkpath, injectedId(indexedKey)]),
  );

  const input = new ParsedNote(request.markdown, record).exportInput();
  const preparing = yield* engineCall(() =>
    ports.engine.prepareDocument({
      markdown: input.markdown,
      luaFilters: [pandocSandboxFilter],
      files: {
        [PANDOC_RESOLVE_MAP_FILENAME]: JSON.stringify({
          citations: Object.fromEntries(wikilinked),
          selectedLiterals: Object.fromEntries(input.literalKeys),
          literalMarker: input.literalMarker,
        }),
      },
    }),
  );
  if (Result.isFailure(preparing)) return { error: preparing.failure };

  const prepared = preparing.success.withCitedIds(input.literalKeys);

  const spelled = yield* readCitations(prepared.citedIds, wikilinked, ports);
  if ("error" in spelled) return spelled;

  const cited = yield* citeItems(spelled.itemsByKey(), spelled.describe, ports);
  if ("error" in cited) return cited;

  const canonical = spelled.canonicalIds(cited.items);
  const bibliography = [...cited.items].map(([indexedKey, item]) => ({
    ...item,
    id: canonical.byIndexedKey.get(indexedKey)!,
  }));
  const document = prepared.withCitedIds(canonical.bySpelling);

  const covered = new Set(bibliography.map((item) => item.id));
  const uncovered = document.citedIds.filter((id) => !covered.has(id));
  if (uncovered.length > 0) {
    return {
      error: {
        kind: "engine",
        detail: `The bibliography covers no data for ${uncovered.join(", ")}`,
      },
    };
  }

  const rendering = yield* engineCall(() =>
    ports.engine.renderPrepared({
      document,
      format: request.format,
      bibliography,
      styleXml: request.styleXml,
      locale: request.locale,
    }),
  );
  return Result.isFailure(rendering)
    ? { error: rendering.failure }
    : { output: rendering.success };
});

function engineCall<A>(
  call: () => Promise<A>,
): Effect.Effect<Result.Result<A, ExportFailure>> {
  return Effect.tryPromise({
    try: call,
    catch: (error): ExportFailure => ({
      kind: "engine",
      detail: describeError(error),
    }),
  }).pipe(Effect.result);
}

interface SpelledCitations {
  itemsByKey: () => string[];
  describe: (indexedKey: string) => string;
  canonicalIds: (items: ReadonlyMap<string, CslItemData>) => {
    byIndexedKey: ReadonlyMap<string, string>;
    bySpelling: ReadonlyMap<string, string>;
  };
}

function injectedId(indexedKey: string): string {
  return `#${indexedKey}`;
}

const readCitations = Effect.fn("readCitations")(function* (
  citedIds: readonly string[],
  wikilinked: ReadonlyMap<string, string>,
  ports: ExportPorts,
): Effect.fn.Return<SpelledCitations | { error: ExportFailure }> {
  const injected = new Map(
    [...wikilinked.values()].map((id) => [id, id.slice(1)]),
  );
  const literal = new Map<string, string>();
  const cited = new Set<string>();
  const unknown: string[] = [];
  const ambiguous: string[] = [];

  const citekeys = citedIds.filter((id) => !injected.has(id));
  const reading = yield* (
    citekeys.length > 0 ? ports.readLookup({ citekeys }) : Effect.succeed(null)
  ).pipe(Effect.result);
  if (Result.isFailure(reading)) {
    return {
      error: { kind: "database-unavailable", dataDir: ports.dataDir() },
    };
  }
  const lookup = reading.success;
  for (const id of citedIds) {
    const wikilinkedKey = injected.get(id);
    if (wikilinkedKey !== undefined) {
      cited.add(wikilinkedKey);
      continue;
    }
    const resolution = lookup!.resolve(id);
    switch (resolution.kind) {
      case "missing":
        unknown.push(id);
        break;
      case "ambiguous":
        ambiguous.push(id);
        break;
      case "unique":
        literal.set(id, resolution.item.indexedKey);
        cited.add(resolution.item.indexedKey);
        break;
    }
  }
  if (unknown.length > 0) {
    return { error: { kind: "citation-keys-unknown", citekeys: unknown } };
  }
  if (ambiguous.length > 0) {
    return { error: { kind: "citation-keys-ambiguous", citekeys: ambiguous } };
  }

  const citekeyOf = new Map<string, string>();
  for (const [citekey, indexedKey] of literal) {
    if (!citekeyOf.has(indexedKey)) citekeyOf.set(indexedKey, citekey);
  }
  const linkpathOf = new Map<string, string>();
  for (const [linkpath, id] of wikilinked) {
    const indexedKey = injected.get(id)!;
    if (!linkpathOf.has(indexedKey)) linkpathOf.set(indexedKey, linkpath);
  }

  return {
    itemsByKey: () => [...cited],
    describe: (indexedKey) => {
      const citekey = citekeyOf.get(indexedKey);
      return citekey === undefined
        ? (linkpathOf.get(indexedKey) ?? indexedKey)
        : `@${citekey}`;
    },
    canonicalIds: (items) => {
      const byIndexedKey = new Map<string, string>();
      for (const [indexedKey, item] of items) {
        byIndexedKey.set(indexedKey, citekeyOf.get(indexedKey) ?? item.id);
      }
      const bySpelling = new Map<string, string>();
      for (const [spelling, indexedKey] of injected) {
        const id = byIndexedKey.get(indexedKey);
        if (id !== undefined) bySpelling.set(spelling, id);
      }
      for (const [citekey, indexedKey] of literal) {
        const id = byIndexedKey.get(indexedKey);
        if (id !== undefined) bySpelling.set(citekey, id);
      }
      return { byIndexedKey, bySpelling };
    },
  };
});

const citeItems = Effect.fn("citeItems")(function* (
  indexedKeys: readonly string[],
  describe: (indexedKey: string) => string,
  ports: ExportPorts,
): Effect.fn.Return<
  { items: ReadonlyMap<string, CslItemData> } | { error: ExportFailure }
> {
  if (indexedKeys.length === 0) return { items: new Map() };

  const placed = yield* ports.readItemRefs(indexedKeys);
  if (!placed) {
    return {
      error: { kind: "database-unavailable", dataDir: ports.dataDir() },
    };
  }

  const unplaced: string[] = [];
  const refs: BibliographyItemRef[] = [];
  for (const indexedKey of indexedKeys) {
    const ref = placed.get(indexedKey);
    if (ref) refs.push(ref);
    else unplaced.push(describe(indexedKey));
  }
  if (unplaced.length > 0) {
    return { error: { kind: "items-missing", sources: unplaced } };
  }

  const bibliography = yield* ports.fetchBibliography(refs);
  return "error" in bibliography
    ? { error: toExportFailure(bibliography.error, describe) }
    : { items: bibliography.items };
});

function toExportFailure(
  failure: BibliographyFailure,
  describe: (indexedKey: string) => string,
): ExportFailure {
  switch (failure.code) {
    case "items-missing":
      return {
        kind: "items-missing",
        sources: failure.indexedKeys.map(describe),
      };
    case "citation-key-missing":
      return {
        kind: "citation-keys-missing",
        sources: failure.indexedKeys.map(describe),
      };
    case "zotero-port-automatic":
      return { kind: "zotero-port-automatic", pref: failure.pref };
    case "zotero-unreachable":
      return { kind: "zotero-unreachable", port: failure.port };
    case "zotero-timeout":
      return { kind: "zotero-timeout", seconds: failure.seconds };
    case "local-api-disabled":
      return { kind: "local-api-disabled", pref: failure.pref };
    case "source-failed":
      return {
        kind: "source-failed",
        source: failure.source,
        detail: failure.detail,
      };
  }
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
