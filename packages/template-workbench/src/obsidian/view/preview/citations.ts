import type { PreviewHint, RenderDiagnostic } from "#core/render/index.ts";
// Draft citations use their own source and presentation, without entering the saved-note cache.
import { Effect } from "effect";

import { CitationLookup } from "@zotlit/citations/obsidian/citation-index/lookup-service.ts";
import { CitationParse } from "@zotlit/citations/obsidian/citation-parse/service.ts";
import type { PresentedCitation } from "@zotlit/citations/obsidian/citation-text/present.ts";
import { holdsNote } from "@zotlit/citations/obsidian/pandoc/inline-content.tsx";
import { BibliographyRender } from "@zotlit/citations/obsidian/pandoc/render-cache.ts";
import { PandocEngine } from "@zotlit/citations/obsidian/pandoc/service.ts";
import type { PandocEngineStatus } from "@zotlit/citations/obsidian/pandoc/service.ts";
import { isChildItemFields, itemToCsl } from "@zotlit/db";
import type { CslItemData } from "@zotlit/db";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import type { ViewServices } from "@zotlit/obsidian-kit/view-atoms.ts";
import type { CitationSource } from "@zotlit/plugin-kernel/citation-source.ts";
import type { WikilinkCitation } from "@zotlit/plugin-kernel/wikilink-citation.ts";
import {
  citationOfRun,
  citationRuns,
  citationTarget,
  wikilinkCitation,
} from "@zotlit/plugin-kernel/wikilink-citation.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { resolveLiteratureNoteIn } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

export interface PreviewCitation extends PresentedCitation {
  source: string;
  start: number;
  /** An empty list identifies a literal Citation. */
  links: readonly { target: string; citation: WikilinkCitation }[];
}
interface DraftCitation extends CitationSource {
  start: number;
  works: (string | null)[];
  links: readonly { target: string; citation: WikilinkCitation }[];
}

export const renderDraftCitations = Effect.fn(
  "NotePreview.renderDraftCitations",
)(function* (input: {
  markdown: string;
  sourcePath: string;
  styleId: string | null;
  locale: string | null;
  wikilinks: boolean;
}): Effect.fn.Return<
  {
    citations: readonly PreviewCitation[];
    diagnostics: RenderDiagnostic[];
    hint?: Omit<PreviewHint, "part">;
  },
  unknown,
  ViewServices
> {
  const citationParse = yield* CitationParse;
  const citationLookup = yield* CitationLookup;
  const bibliographyRender = yield* BibliographyRender;
  const { record } = yield* citationParse.parse({
    path: input.sourcePath,
    generation: 0,
    text: input.markdown,
  });
  const scanned = record.citations;
  const links = input.wikilinks
    ? record.wikilinks.map(({ position }) => ({
        start: position.start.offset,
        end: position.end.offset,
        target: input.markdown.slice(
          position.start.offset + 2,
          position.end.offset - 2,
        ),
      }))
    : [];
  const metadata = yield* MetadataCache;
  const notes = new Map<
    string,
    Effect.Success<ReturnType<typeof resolveLiteratureNoteIn>>
  >();
  for (const link of links) {
    const target = citationTarget(link.target);
    if (target)
      notes.set(
        target.linkpath,
        yield* resolveLiteratureNoteIn(
          metadata,
          target.linkpath,
          input.sourcePath,
        ),
      );
  }

  const lookup = yield* citationLookup.read({
    citekeys: scanned.flatMap((citation) =>
      citation.keys.map((key) => key.citekey),
    ),
    indexedKeys: [...notes.values()].flatMap((note) =>
      note ? [note.indexedKey] : [],
    ),
  });
  const placed: DraftCitation[] = scanned.map(({ start, end, keys }) => ({
    start,
    source: input.markdown.slice(start, end),
    links: [],
    keys: keys.map((key) => ({
      ...key,
      start: key.start - start,
      end: key.end - start,
    })),
    works: keys.map(({ citekey }) => {
      const found = lookup.resolve(citekey);
      return found.kind === "unique" ? found.item.indexedKey : null;
    }),
  }));
  if (input.wikilinks) {
    const runs = citationRuns(
      links,
      (link) =>
        wikilinkCitation(link.target, {
          enabled: true,
          literatureNote: (linkpath) => {
            const note = notes.get(linkpath) ?? null;
            return (
              note && {
                ...note,
                citationKey: lookup.citekeyOf(note.indexedKey),
              }
            );
          },
        }),
      (left, right) => input.markdown.slice(left.end, right.start),
    );
    for (const run of runs)
      placed.push({
        ...citationOfRun(run),
        start: run[0]!.source.start,
        links: run.map(({ source, citation }) => ({
          target: source.target,
          citation,
        })),
      });
  }
  placed.sort((left, right) => left.start - right.start);
  if (placed.length === 0) return { citations: [], diagnostics: [] };
  const items = new Map<string, CslItemData>();
  {
    const keys = [...new Set(placed.flatMap(({ works }) => works))].filter(
      (key) => key !== null,
    );
    const [user, found] = yield* Effect.scoped(
      Effect.gen(function* () {
        const reads = yield* (yield* ZoteroReads).snapshot;
        return yield* Effect.all(
          [
            reads.DatabaseIdentity({}),
            reads.ItemsByIndexedKeys({ indexedKeys: keys }),
          ],
          { concurrency: "unbounded" },
        );
      }),
    );
    for (const key of keys) {
      const item = found.get(key);
      if (item && !isChildItemFields(item.fields))
        items.set(key, { ...itemToCsl(item, user), id: key });
    }
  }
  const complete = placed.filter(({ works }) =>
    works.every((key) => key !== null && items.has(key)),
  );
  if (complete.length === 0) return { citations: [], diagnostics: [] };
  const sources = complete.map(namedSource);
  const presentation = { styleId: input.styleId, locale: input.locale };
  // The outcome says which of the three reasons a preview shows; the read that
  // follows it answers with the render that stands, rather than with one an
  // invalidation superseded halfway.
  const outcome = yield* bibliographyRender.renderCitations(
    sources,
    [...items.values()],
    presentation,
  );
  // Citations stay as the author wrote them, which the engine only improves.
  if (outcome.kind === "unavailable" && outcome.reason === "engine-absent") {
    const hint = engineHint(yield* (yield* PandocEngine).current);
    return { citations: [], diagnostics: [], ...(hint ? { hint } : {}) };
  }
  const formatted =
    outcome.kind === "held"
      ? yield* bibliographyRender
          .readCitations(sources, [...items.values()], { presentation })
          .pipe(Effect.orElseSucceed(() => null))
      : null;
  if (formatted === null)
    return {
      citations: [],
      diagnostics: [
        {
          code: "citation-style-error",
          part: "render",
          message:
            outcome.kind === "unavailable" && outcome.reason === "style-missing"
              ? m.profile_preview_citation_style_missing()
              : m.profile_preview_citation_failed(),
        },
      ],
    };
  const serials = new Map<string, number>();
  if (formatted.some(({ content }) => holdsNote(content))) {
    const bibliography = yield* bibliographyRender
      .readBibliography([...items.values()], { presentation })
      .pipe(Effect.orElseSucceed(() => null));
    bibliography?.entries.forEach(({ id }, index) =>
      serials.set(id, index + 1),
    );
  }
  return {
    citations: formatted.map((text, index) => ({
      source: complete[index]!.source,
      start: complete[index]!.start,
      links: complete[index]!.links,
      text,
      serials: holdsNote(text.content)
        ? text.citations.map(({ id }) => serials.get(id))
        : [],
    })),
    diagnostics: [],
  };
});
/** What a preview suggests for each status that gives no engine. */
function engineHint(
  status: PandocEngineStatus,
): Omit<PreviewHint, "part"> | null {
  if (status === null) return null;
  switch (status.kind) {
    case "pack-absent":
      return {
        message: m.profile_preview_citation_engine_absent(),
        opensEngineSettings: true,
      };
    case "pack-outdated":
    case "plugin-outdated":
    case "pack-damaged":
    case "failed":
      return {
        message: m.references_engine_failed_title(),
        opensEngineSettings: true,
      };
    case "ready":
      return null;
  }
}
function namedSource(citation: DraftCitation): string {
  let source = citation.source;
  for (let index = citation.keys.length - 1; index >= 0; index--) {
    const key = citation.keys[index]!;
    const marker = source[key.start] === "-" ? "-@" : "@";
    source = `${source.slice(0, key.start)}${marker}${citation.works[index]}${source.slice(key.end)}`;
  }
  return source;
}
