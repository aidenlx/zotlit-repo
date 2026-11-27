// @vitest-environment happy-dom
import type { Citation } from "#obsidian/citation-index/service.ts";
import type { CitationTextEvent } from "#obsidian/citation-text/service.ts";
import type { CitationHoverRequest } from "#obsidian/citekey-navigation/index.ts";
import type { RenderedCitation } from "#obsidian/pandoc/engine.ts";
import { it } from "@effect/vitest";
import { Effect, Exit, Fiber, Layer, Scope, Stream } from "effect";
import type {
  MarkdownPostProcessor,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  WorkspaceLeaf,
} from "obsidian";
import { Keymap, MarkdownView } from "obsidian";
import { describe, expect, vi } from "vitest";

import { MemoryMetadataCache } from "@zotlit/obsidian-kit/__fixtures__/obsidian-metadata-cache.ts";
import { MemoryVault } from "@zotlit/obsidian-kit/__fixtures__/obsidian-vault.ts";
import { MemoryWorkspace } from "@zotlit/obsidian-kit/__fixtures__/obsidian-workspace.ts";
import { testPluginHost } from "@zotlit/obsidian-kit/__fixtures__/plugin-host.ts";
import { layerVaultFrom } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { layerWorkspaceFrom } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";
import { vaultError } from "@zotlit/plugin-kernel/vault-errors.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { queryClientsFixture } from "@zotlit/plugin-services/core/query-client/__fixtures__.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import type { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { lookupAnswerFor } from "@zotlit/zotero-reads/__fixtures__/citation-lookup.ts";
import {
  citedWorkSeed,
  inProcessReadsService,
  memoryOpener,
} from "@zotlit/zotero-reads/__fixtures__/in-process.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { CitationLookupAnswer } from "@zotlit/zotero-reads/contract/citation-lookup.ts";

import { layerCitekeyReading } from "./service.ts";

import { CitationLookupStub } from "#__fixtures__/citation-index/citation-lookup.ts";
import {
  ALPHA_KEY,
  citation,
  literalOccurrences,
  rendered,
} from "#__fixtures__/citation-text.ts";
import { citationTextFixture } from "#__fixtures__/citation-text.ts";
import { OpenDocumentsStub } from "#__fixtures__/citation-text/open-documents.ts";
import { renderFailure } from "#__fixtures__/pandoc/render-cache.ts";
import { profileReader } from "#__fixtures__/profiles.ts";
import { settingsFeed } from "#__fixtures__/settings.ts";
import { defaults } from "#__fixtures__/settings.ts";
import { inProcessParseClient } from "#core/citation-parse/in-process.ts";
import { CitationLookup } from "#obsidian/citation-index/lookup-service.ts";
import { ParsedNote } from "#obsidian/citation-index/parsed-note.ts";
import { readReferenceSources } from "#obsidian/citation-index/sources.ts";
import { CitationPopover } from "#obsidian/citation-popover/service.ts";
import { CitationText } from "#obsidian/citation-text/service.ts";
import { CitekeyEditor } from "#obsidian/citekey-editor/service.ts";

interface ReadingFakes {
  workspace: MemoryWorkspace;
  vault?: MemoryVault;
  citationText: Layer.Layer<CitationText>;
  citationLookup?: Layer.PartialEffectful<CitationLookup["Service"]>;
  citekeyEditor?: Layer.PartialEffectful<CitekeyEditor["Service"]>;
  citationPopover?: Layer.PartialEffectful<CitationPopover["Service"]>;
  settings: Layer.Layer<PluginSettings>;
}

const openReading = Effect.fnUntraced(function* ({
  workspace,
  vault = new MemoryVault(),
  ...fakes
}: ReadingFakes) {
  let process: MarkdownPostProcessor | undefined;
  const host = testPluginHost({
    registerMarkdownPostProcessor: (postProcessor) => {
      process = postProcessor;
      return postProcessor;
    },
  });
  const scope = yield* Scope.fork(yield* Scope.Scope);
  yield* Layer.buildWithScope(
    layerCitekeyReading.pipe(
      Layer.provide(
        Layer.mergeAll(
          host.layer,
          layerVaultFrom(vault),
          layerWorkspaceFrom(workspace),
          fakes.citationText,
          Layer.mock(CitationLookup, fakes.citationLookup ?? {}),
          Layer.mock(CitekeyEditor, fakes.citekeyEditor ?? {}),
          Layer.mock(CitationPopover, fakes.citationPopover ?? {}),
          fakes.settings,
        ),
      ),
    ),
    scope,
  );
  const postProcessor = process!;
  return {
    postProcessor,
    process: (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
      void postProcessor(el, ctx);
    },
    unload: Scope.close(scope, Exit.void),
  };
});

function section(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

function readingView(
  containerEl: HTMLElement,
  rerender: (scroll: boolean) => void,
): MarkdownView {
  return Object.assign(
    new MarkdownView(stubService<WorkspaceLeaf>("WorkspaceLeaf", {})),
    { containerEl, previewMode: { rerender } },
  );
}

const makeHarness = Effect.fnUntraced(function* ({
  body,
  cited = [citation("alpha", ALPHA_KEY)],
  formats = true,
  formatCitations,
  renderText = (source) => `«${source}»`,
  overrides = {},
  frontmatter = {},
  ambiguousKeys = [],
  resolutionPending = false,
  open = Effect.void,
}: {
  body: string;
  open?: Effect.Effect<void>;
  cited?: Citation[];
  ambiguousKeys?: readonly string[];
  resolutionPending?: boolean;
  formats?: boolean;
  formatCitations?: (
    citations: readonly string[],
  ) => Promise<readonly RenderedCitation[] | null>;
  renderText?: (source: string, index: number) => string;
  overrides?: Partial<Settings>;
  frontmatter?: Record<string, unknown>;
}) {
  const citationRequests: { citations: readonly string[] }[] = [];
  const popoverRequests: CitationHoverRequest[] = [];
  const opened: [citekey: string, pane: unknown][] = [];
  const switchRequests: string[] = [];
  const occurrences = literalOccurrences(body);
  let rerenders = 0;
  let render = renderText;
  let formatting = formats;
  const children: MarkdownRenderChild[] = [];
  let ambiguous = ambiguousKeys;
  let resolutionReady = !resolutionPending;
  const answer = (requested: readonly string[]): CitationLookupAnswer =>
    lookupAnswerFor(
      requested,
      Object.fromEntries(
        ambiguous.map((citekey) => [
          citekey,
          { kind: "ambiguous" as const, candidates: [] },
        ]),
      ),
      JSON.stringify(ambiguous),
    );

  const citationLookup = new CitationLookupStub(({ citekeys = [] }) =>
    resolutionReady ? answer(citekeys) : null,
  );
  const vault = new MemoryVault();
  const metadata = new MemoryMetadataCache();
  for (const path of ["note.md", "other.md"]) {
    vault.add(path, body);
    metadata.setCache(path, { frontmatter });
  }
  const workspace = new MemoryWorkspace();
  workspace.on("zotlit:switch-profile", (request) => {
    switchRequests.push((request as { path: string }).path);
  });

  const reads = yield* Effect.acquireDisposable(
    Effect.sync(() =>
      inProcessReadsService(
        memoryOpener(() => citedWorkSeed([ALPHA_KEY])).open,
      ),
    ),
  );
  const queryClient = yield* Effect.acquireDisposable(
    Effect.sync(() => queryClientsFixture()),
  );
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const fixture = yield* Effect.acquireDisposable(
    Effect.sync(() =>
      citationTextFixture({
        openDocuments: new OpenDocumentsStub(),
        citationLookup,
        profile: profileReader(defaults, metadata),
        host: { vault, metadataCache: metadata },
        citationIndex: {
          getParsedDocument: () =>
            Effect.tryPromise({
              try: async () => ({
                facts: new ParsedNote(
                  body,
                  (
                    await runPromise(
                      inProcessParseClient.parse({
                        path: "note.md",
                        generation: 0,
                        text: body,
                      }),
                    )
                  ).record,
                ),
                set: {
                  occurrences,
                  citations: cited,
                  errors: [],
                  lookup: answer(occurrences.map((o) => o.raw)),
                  ...(await reads.runtime.runPromise(
                    ZoteroReads.use((db) => readReferenceSources(db, cited)),
                  )),
                  syntaxes: {
                    citekey: "included" as const,
                    wikilink: "excluded" as const,
                    annotation: "included" as const,
                  },
                  omittedSyntaxes: [],
                  coverage: "complete" as const,
                },
              }),
              catch: vaultError("cachedRead", "note.md"),
            }),
          events: Stream.empty,
        },
        noteIndex: {
          changes: Stream.empty,
          whenIndexed: Effect.void,
        },
        bibliographyRender: {
          state: Effect.succeed({
            vaultPresentation: { styleId: null, locale: null },
            missingStyle: null,
          }),
          readCitations: (citations: readonly string[]) =>
            Effect.tryPromise({
              try: async () => {
                citationRequests.push({ citations });
                return formatCitations
                  ? await formatCitations(citations)
                  : formatting
                    ? citations.map((source, index) =>
                        rendered(render(source, index)),
                      )
                    : null;
              },
              catch: renderFailure,
            }),
          readBibliography: () =>
            Effect.tryPromise({
              try: async () => ({
                entries: [],
                hasEntryMarkers: false,
              }),
              catch: renderFailure,
            }),
          events: Stream.empty,
        },
        queryClient,
      }),
    ),
  );
  const text = fixture.runtime.runSync(CitationText);
  if (!formatCitations) yield* text.read("note.md").pipe(Effect.orDie);

  const reading = yield* openReading({
    workspace,
    vault,
    citationText: Layer.succeed(CitationText, text),
    citationLookup: {
      observe: (changed) => citationLookup.observe(changed),
    },
    citekeyEditor: {
      openCitekey: (citekey, pane) =>
        Effect.sync(() => {
          opened.push([citekey, pane]);
        }).pipe(Effect.andThen(open)),
    },
    citationPopover: {
      show: (request) =>
        Effect.sync(() => {
          popoverRequests.push(request);
        }),
    },
    settings: settingsFeed(overrides).layer,
  });

  const sectionCtx = (
    lines: { from: number; to: number } | null,
  ): MarkdownPostProcessorContext =>
    stubService<MarkdownPostProcessorContext>("MarkdownPostProcessorContext", {
      sourcePath: "note.md",
      getSectionInfo: () =>
        lines && { text: body, lineStart: lines.from, lineEnd: lines.to },
      addChild: (child: MarkdownRenderChild) => {
        children.push(child);
        child.load();
      },
    });
  const ctx = sectionCtx({ from: 0, to: body.split("\n").length - 1 });

  const nextEvent = (matches: (event: CitationTextEvent) => boolean) =>
    Stream.runHead(Stream.filter(text.events, (event) => matches(event))).pipe(
      Effect.forkScoped({ startImmediately: true }),
      Effect.map((fiber) => Fiber.join(fiber)),
    );

  return {
    postProcessor: reading.postProcessor,
    process: reading.process,
    sectionCtx,
    ctx,
    viewedCtx: (el: HTMLElement): MarkdownPostProcessorContext => {
      workspace.openLeaf(
        "markdown",
        readingView(el, () => {
          rerenders += 1;
        }),
      );
      return ctx;
    },
    citationRequests,
    popoverRequests,
    opened,
    rerenders: () => rerenders,
    renderAs: (renderText: (source: string, index: number) => string) => {
      render = renderText;
    },
    stopFormatting: () => {
      formatting = false;
    },
    startFormatting: () => {
      formatting = true;
    },
    changeFile: (path: string, nextFrontmatter = frontmatter) => {
      metadata.change(vault.getFileByPath(path)!, {
        frontmatter: nextFrontmatter,
      });
    },
    rebuildResolution: (keys: readonly string[]) => {
      ambiguous = keys;
      resolutionReady = true;
      citationLookup.refresh();
    },
    unloadSections: () => {
      for (const child of children.splice(0)) child.unload();
    },
    activeLookups: () => citationLookup.activeObservations,
    switchRequests,
    read: (path: string) => text.read(path).pipe(Effect.orDie),
    settles: (path: string) =>
      nextEvent((event) => event.type === "settled" && event.path === path),
    changes: (path: string) =>
      nextEvent((event) => event.type === "changed" && event.path === path),
    unload: reading.unload,
  };
});

function pendingRender() {
  let settle: ((value: readonly RenderedCitation[]) => void) | undefined;
  const pending = new Promise<readonly RenderedCitation[]>((resolve) => {
    settle = resolve;
  });
  return {
    pending,
    settle: (value: readonly RenderedCitation[]) => settle!(value),
  };
}

describe("CitekeyReading", () => {
  it.effect("rerenders open reading views when Pandoc navigation changes", () =>
    Effect.gen(function* () {
      const settings = settingsFeed();
      const rerender = vi.fn<(scroll: boolean) => void>();
      const workspace = new MemoryWorkspace();
      workspace.openLeaf(
        "markdown",
        readingView(document.createElement("div"), rerender),
      );
      yield* openReading({
        workspace,
        citationText: Layer.mock(CitationText, { events: Stream.empty }),
        settings: settings.layer,
      });
      expect(rerender).not.toHaveBeenCalled();

      settings.update({ "citation.open-as-links": true });

      expect(rerender).toHaveBeenCalledExactlyOnceWith(true);
    }),
  );

  it.live(
    "renders the reading views again on disposal, which drops its citations",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({ body: "Blah [@alpha]." });
        const el = section("<p>Blah [@alpha].</p>");
        h.process(el, h.viewedCtx(el));
        expect(h.rerenders()).toBe(0);

        yield* h.unload;

        expect(h.rerenders()).toBe(1);
        const late = section("<p>Blah [@alpha].</p>");
        h.process(late, h.ctx);
        expect(late.textContent).toBe("Blah [@alpha].");
      }),
  );

  it.live("puts the engine's formatted citation in the source's place", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({
        body: "Blah [see @alpha, p. 3] blah.",
      });
      const el = section("<p>Blah [see @alpha, p. 3] blah.</p>");

      h.process(el, h.ctx);

      expect(el.textContent).toBe(`Blah «[see @${ALPHA_KEY}, p. 3]» blah.`);
      expect(el.querySelector("span.zt-citation")).not.toBeNull();
    }),
  );

  it.live(
    "names an unavailable Imported Note Profile on its raw citation",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({
          body: "Cited @alpha.",
          frontmatter: {
            "zotero-note-key": "1/NOTE1234",
            "zotlit-profile": "deleted-profile",
          },
        });
        const el = section("<p>Cited @alpha.</p>");

        h.process(el, h.ctx);

        const citation = el.querySelector<HTMLElement>(
          '[data-citation-presentation-error="profile"]',
        );
        expect(citation?.textContent).toBe("@alpha");
        expect(citation?.getAttribute("aria-label")).toContain(
          "deleted-profile",
        );
        expect(citation?.getAttribute("aria-label")).toBe(
          m.notice_imported_note_profile_unknown({
            stamp: "deleted-profile",
            target: "note.md",
          }),
        );
        const recovery = el.querySelector<HTMLButtonElement>(
          "[data-profile-recovery]",
        );
        expect(recovery?.textContent).toBe(m.profile_switch_recovery());
        recovery?.click();
        expect(h.switchRequests).toEqual(["note.md"]);
        expect(citation?.title).toBe("");
      }),
  );

  it.live(
    "updates and clears the Profile diagnostic on the same citation",
    () =>
      Effect.gen(function* () {
        const imported = { "zotero-note-key": "1/NOTE1234" };
        const h = yield* makeHarness({
          body: "Cited @alpha.",
          formats: false,
          frontmatter: { ...imported, "zotlit-profile": "missing-a" },
        });
        const el = section("<p>Cited @alpha.</p>");
        h.process(el, h.ctx);
        const citation = el.querySelector("p span")!;
        expect(citation.getAttribute("aria-label")).toContain("missing-a");

        const changed = yield* h.settles("note.md");
        h.changeFile("note.md", { ...imported, "zotlit-profile": "missing-b" });
        yield* changed;

        expect(el.querySelector("p span")).toBe(citation);
        expect.soft(citation.getAttribute("aria-label")).toContain("missing-b");

        const repaired = yield* h.settles("note.md");
        h.changeFile("note.md", imported);
        yield* repaired;

        expect(el.querySelector("p span")).toBe(citation);
        expect.soft(citation.hasAttribute("aria-label")).toBe(false);
        expect(citation.hasAttribute("data-citation-presentation-error")).toBe(
          false,
        );
      }),
  );

  it.live(
    "adds a Profile diagnostic to a citation first rendered without one",
    () =>
      Effect.gen(function* () {
        const imported = { "zotero-note-key": "1/NOTE1234" };
        const h = yield* makeHarness({
          body: "Cited @alpha.",
          formats: false,
          frontmatter: imported,
        });
        const el = section("<p>Cited @alpha.</p>");
        h.process(el, h.ctx);
        const citation = el.querySelector("p span")!;
        expect(citation.hasAttribute("aria-label")).toBe(false);

        const changed = yield* h.settles("note.md");
        h.changeFile("note.md", { ...imported, "zotlit-profile": "missing-a" });
        yield* changed;

        expect(el.querySelector("p span")).toBe(citation);
        expect.soft(citation.getAttribute("aria-label")).toBe(
          m.notice_imported_note_profile_unknown({
            stamp: "missing-a",
            target: "note.md",
          }),
        );
        expect(citation.getAttribute("data-citation-presentation-error")).toBe(
          "profile",
        );
      }),
  );

  const IBID = (source: string, index: number): string =>
    index === 0 ? `«${source}»` : "ibid";

  it.live(
    "shows each occurrence the text rendered for its own place in the document",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({
          body: "One [@alpha].\n\nTwo [@alpha].",
          renderText: IBID,
        });
        const first = section("<p>One [@alpha].</p>");
        const second = section("<p>Two [@alpha].</p>");

        h.process(first, h.sectionCtx({ from: 0, to: 0 }));
        h.process(second, h.sectionCtx({ from: 2, to: 2 }));

        expect(first.textContent).toBe(`One «[@${ALPHA_KEY}]».`);
        expect(second.textContent).toBe("Two ibid.");
      }),
  );

  it.live(
    "shows first-occurrence text in a section Obsidian places nowhere",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({
          body: "One [@alpha].\n\nTwo [@alpha].",
          renderText: IBID,
        });
        const el = section("<p>Two [@alpha].</p>");

        h.process(el, h.sectionCtx(null));

        expect(el.textContent).toBe(`Two «[@${ALPHA_KEY}]».`);
      }),
  );

  it.live("keeps source when no engine formats the citation", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({
        body: "Blah [see @alpha, p. 3] blah.",
        formats: false,
      });
      const el = section("<p>Blah [see @alpha, p. 3] blah.</p>");

      h.process(el, h.ctx);

      expect(el.textContent).toBe("Blah [see @alpha, p. 3] blah.");
    }),
  );

  it.live("keeps source while formatted citation presentation is off", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({
        body: "Blah [see @alpha, p. 3] blah.",
        overrides: { "citation.show-formatted": false },
      });
      const el = section("<p>Blah [see @alpha, p. 3] blah.</p>");

      h.process(el, h.ctx);

      expect(el.textContent).toBe("Blah [see @alpha, p. 3] blah.");
    }),
  );

  it.live("keeps source visible while citation text is pending", () =>
    Effect.gen(function* () {
      const render = pendingRender();
      const h = yield* makeHarness({
        body: "Blah [@alpha].",
        formatCitations: () => render.pending,
      });
      const el = section("<p>Blah [@alpha].</p>");
      const settled = yield* h.settles("note.md");

      expect(h.postProcessor(el, h.ctx)).toBeUndefined();
      expect(el.textContent).toBe("Blah [@alpha].");

      render.settle([rendered("«[@alpha]»")]);
      yield* settled;
    }),
  );

  it.live(
    "marks source as neutral while citation-key resolution is pending",
    () =>
      Effect.gen(function* () {
        const pending = new Promise<readonly RenderedCitation[]>(
          () => undefined,
        );
        const h = yield* makeHarness({
          body: "Blah [@alpha].",
          formatCitations: () => pending,
          resolutionPending: true,
        });
        const el = section("<p>Blah [@alpha].</p>");

        h.process(el, h.ctx);

        expect(el.textContent).toBe("Blah [@alpha].");
        expect(
          el.querySelector(`.${themeHook.citationKeyPending}`),
        ).not.toBeNull();
        expect(
          el.querySelector(`.${themeHook.citationKeyUnresolved}`),
        ).toBeNull();
      }),
  );

  it.live("leaves a citekey no Literature Note carries as written", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({
        body: "@ghost blah.",
        cited: [citation("ghost", null)],
      });
      const el = section("<p>@ghost blah.</p>");

      h.process(el, h.ctx);

      expect(el.textContent).toBe("@ghost blah.");
    }),
  );

  it.live(
    "exposes the literal theme hooks for each literal Citation resolution state",
    () =>
      Effect.gen(function* () {
        const cases = [
          {
            body: "[@alpha]",
            cited: [citation("alpha", ALPHA_KEY)],
            classes: ["zt-citation", "zt-citation-key"],
          },
          {
            body: "[@alpha; @ghost]",
            cited: [citation("alpha", ALPHA_KEY), citation("ghost", null)],
            classes: [
              "zt-citation",
              "zt-citation-key",
              "zt-citation-key-partially-unresolved",
            ],
          },
          {
            body: "[@ghost]",
            cited: [citation("ghost", null)],
            classes: [
              "zt-citation",
              "zt-citation-key",
              "zt-citation-key-unresolved",
            ],
          },
          {
            body: "[@twin]",
            cited: [citation("twin", null)],
            ambiguousKeys: ["twin"],
            classes: [
              "zt-citation",
              "zt-citation-key",
              "zt-citation-key-ambiguous",
            ],
            absent: ["zt-citation-key-unresolved"],
          },
          {
            body: "[@twin; @ghost]",
            cited: [citation("twin", null), citation("ghost", null)],
            ambiguousKeys: ["twin"],
            classes: [
              "zt-citation",
              "zt-citation-key",
              "zt-citation-key-unresolved",
            ],
            absent: ["zt-citation-key-ambiguous"],
          },
        ];
        for (const { body, cited, classes, ambiguousKeys, absent } of cases) {
          yield* Effect.scoped(
            Effect.gen(function* () {
              const h = yield* makeHarness({ body, cited, ambiguousKeys });
              const el = section(`<p>${body}</p>`);

              h.process(el, h.ctx);

              const rendered = el.querySelector("span");
              for (const className of classes) {
                expect(rendered?.classList.contains(className)).toBe(true);
              }
              for (const className of absent ?? []) {
                expect(rendered?.classList.contains(className)).toBe(false);
              }
            }),
          );
        }
      }),
  );

  it.live("shows the rendered citation's popover while navigation is off", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({
        body: "Blah [@alpha].",
        overrides: { "citation.open-as-links": false },
      });
      const el = section("<p>Blah [@alpha].</p>");

      h.process(el, h.viewedCtx(el));
      const citationEl = el.querySelector<HTMLElement>(".zt-citation")!;
      citationEl.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

      expect(h.popoverRequests).toHaveLength(1);
      expect(h.popoverRequests[0]).toMatchObject({
        targetEl: citationEl,
        works: [{ citekey: "alpha" }],
        sourcePath: "note.md",
      });
    }),
  );

  it.live(
    "leaves the rendered citation's plain click inert while navigation is off",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({
          body: "Blah [@alpha].",
          overrides: {
            "citation.open-as-links": false,
            "citation.hover-action": "off",
          },
        });
        const el = section("<p>Blah [@alpha].</p>");
        const event = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
        });

        h.process(el, h.viewedCtx(el));
        const citationEl = el.querySelector<HTMLElement>(".zt-citation")!;
        citationEl.dispatchEvent(event);

        expect(h.opened).toEqual([]);
        expect(h.popoverRequests).toEqual([]);
        expect(event.defaultPrevented).toBe(false);
        expect(citationEl.dataset.ztClick).toBe("none");
      }),
  );

  it.live("states that a rendered citation opens while navigation is on", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({
        body: "Blah [@alpha].",
        overrides: { "citation.open-as-links": true },
      });
      const el = section("<p>Blah [@alpha].</p>");

      h.process(el, h.viewedCtx(el));

      expect(
        el.querySelector<HTMLElement>(".zt-citation")!.dataset.ztClick,
      ).toBe("open");
    }),
  );

  it.live("opens the work a Mod-click names while navigation is off", () =>
    Effect.gen(function* () {
      vi.spyOn(Keymap, "isModifier").mockReturnValue(true);
      vi.spyOn(Keymap, "isModEvent").mockReturnValue("tab");
      yield* Effect.addFinalizer(() => Effect.sync(() => vi.restoreAllMocks()));
      const h = yield* makeHarness({
        body: "Blah [@alpha].",
        overrides: { "citation.open-as-links": false },
      });
      const el = section("<p>Blah [@alpha].</p>");

      h.process(el, h.viewedCtx(el));
      el.querySelector<HTMLElement>(".zt-citation")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );

      expect(h.popoverRequests).toEqual([]);
      expect(h.opened).toEqual([["alpha", "tab"]]);
    }),
  );

  it.live("interrupts a pending open when the plugin unloads", () =>
    Effect.gen(function* () {
      let interrupted = false;
      const h = yield* makeHarness({
        body: "Blah [@alpha].",
        overrides: { "citation.open-as-links": true },
        open: Effect.never.pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted = true;
            }),
          ),
        ),
      });
      const el = section("<p>Blah [@alpha].</p>");

      h.process(el, h.viewedCtx(el));
      el.querySelector<HTMLElement>(".zt-citation")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      expect(h.opened).toEqual([["alpha", false]]);
      yield* h.unload;

      expect(interrupted).toBe(true);
    }),
  );

  it.live(
    "opens the work a plain click names while Citations open as links",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({
          body: "Blah [@alpha].",
          overrides: { "citation.open-as-links": true },
        });
        const el = section("<p>Blah [@alpha].</p>");

        h.process(el, h.viewedCtx(el));
        el.querySelector<HTMLElement>(".zt-citation")!.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );

        expect(h.popoverRequests).toEqual([]);
        expect(h.opened).toEqual([["alpha", false]]);
      }),
  );

  it.live("keeps an unrendered citation opening as a link", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({
        body: "Blah [@alpha].",
        overrides: {
          "citation.show-formatted": false,
          "citation.open-as-links": true,
        },
      });
      const el = section("<p>Blah [@alpha].</p>");

      h.process(el, h.viewedCtx(el));
      el.querySelector<HTMLElement>(".zt-citation")!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );

      expect(h.popoverRequests).toEqual([]);
      expect(h.opened).toEqual([["alpha", false]]);
    }),
  );

  it.live("leaves the reading view alone while the treatment is off", () =>
    Effect.gen(function* () {
      for (const overrides of [
        {
          "citation.show-formatted": false,
          "citation.open-as-links": false,
        },
        { "citation.pandoc-citations": false },
      ]) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const h = yield* makeHarness({
              body: "Blah [@alpha].",
              overrides,
            });
            const el = section("<p>Blah [@alpha].</p>");

            h.process(el, h.ctx);

            expect(el.textContent).toBe("Blah [@alpha].");
            expect(el.querySelector(".zt-citation-key")).toBeNull();
          }),
        );
      }
    }),
  );

  it.live("keeps the block element a reading-view flash targets", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({
        body: "Blah [@alpha] blah.",
      });
      const el = section("<p>Blah [@alpha] blah.</p>");
      const block = el.firstElementChild!;

      h.process(el, h.ctx);

      expect(el.children).toHaveLength(1);
      expect(el.firstElementChild).toBe(block);
      expect(block.querySelector("span.zt-citation")).not.toBeNull();
    }),
  );

  it.live("formats a document once for every section that asks", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({
        body: "One [@alpha].\n\nTwo [@alpha].",
      });

      h.process(section("<p>One [@alpha].</p>"), h.ctx);
      h.process(section("<p>Two [@alpha].</p>"), h.ctx);

      expect(h.citationRequests).toHaveLength(1);
    }),
  );
});

describe("CitekeyReading refresh", () => {
  it.live(
    "refreshes a rendered citation in place when its document's text changes",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({ body: "Blah [@alpha]." });
        const el = section("<p>Blah [@alpha].</p>");
        h.process(el, h.viewedCtx(el));
        const block = el.firstElementChild;
        expect(el.textContent).toBe(`Blah «[@${ALPHA_KEY}]».`);

        h.renderAs((source) => `‹${source}›`);
        const settled = yield* h.settles("note.md");
        h.changeFile("note.md");
        expect(el.textContent).toBe(`Blah «[@${ALPHA_KEY}]».`);
        yield* settled;

        expect(el.textContent).toBe(`Blah ‹[@${ALPHA_KEY}]›.`);
        expect(el.firstElementChild).toBe(block);
        expect(el.querySelectorAll(".zt-citation")).toHaveLength(1);
        expect(h.rerenders()).toBe(0);
      }),
  );

  it.live("leaves another document's sections alone", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ body: "Blah [@alpha]." });
      yield* h.read("other.md");
      const el = section("<p>Blah [@alpha].</p>");
      h.process(el, h.viewedCtx(el));

      h.renderAs((source) => `‹${source}›`);
      const changed = yield* h.changes("other.md");
      h.changeFile("other.md");
      yield* changed;

      expect(el.textContent).toBe(`Blah «[@${ALPHA_KEY}]».`);
      expect(h.rerenders()).toBe(0);
    }),
  );

  it.live("fills a section in that rendered while its text was pending", () =>
    Effect.gen(function* () {
      const render = pendingRender();
      const h = yield* makeHarness({
        body: "Blah [@alpha].",
        formatCitations: () => render.pending,
      });
      const el = section("<p>Blah [@alpha].</p>");
      const settled = yield* h.settles("note.md");
      h.process(el, h.viewedCtx(el));
      expect(el.textContent).toBe("Blah [@alpha].");

      render.settle([rendered("«[@alpha]»")]);
      yield* settled;

      expect(el.textContent).toBe("Blah «[@alpha]».");
      expect(el.querySelector(".zt-citation")).not.toBeNull();
      expect(h.rerenders()).toBe(0);
    }),
  );

  it.live(
    "restores the source when a fresh read has no formatted citation",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({ body: "Blah [@alpha]." });
        const el = section("<p>Blah [@alpha].</p>");
        h.process(el, h.viewedCtx(el));
        expect(el.textContent).toBe(`Blah «[@${ALPHA_KEY}]».`);

        h.stopFormatting();
        const settled = yield* h.settles("note.md");
        h.changeFile("note.md");
        yield* settled;

        expect(el.textContent).toBe("Blah [@alpha].");
        expect(el.querySelector("p span")?.textContent).toBe("[@alpha]");

        h.startFormatting();
        const formatted = yield* h.settles("note.md");
        h.changeFile("note.md");
        yield* formatted;

        expect(el.textContent).toBe(`Blah «[@${ALPHA_KEY}]».`);
      }),
  );

  it.live(
    "restores the source and names the Profile when an Imported Note loses its Profile",
    () =>
      Effect.gen(function* () {
        const imported = { "zotero-note-key": "1/NOTE1234" };
        const h = yield* makeHarness({
          body: "Cited @alpha.",
          formats: true,
          frontmatter: imported,
        });
        const el = section("<p>Cited @alpha.</p>");
        h.process(el, h.ctx);
        const formatted = el.querySelector("p span")!.textContent;
        expect(formatted).toBe(`«@${ALPHA_KEY}»`);

        const changed = yield* h.settles("note.md");
        h.changeFile("note.md", {
          ...imported,
          "zotlit-profile": "deleted-profile",
        });
        yield* changed;

        const raw = el.querySelector("p span")!;
        expect(raw.textContent).toBe("@alpha");
        expect(raw.getAttribute("data-citation-presentation-error")).toBe(
          "profile",
        );
        expect(raw.getAttribute("aria-label")).toBe(
          m.notice_imported_note_profile_unknown({
            stamp: "deleted-profile",
            target: "note.md",
          }),
        );

        const firstRender = section("<p>Cited @alpha.</p>");
        h.process(firstRender, h.ctx);
        const firstRaw = firstRender.querySelector("p span")!;
        expect(raw.textContent).toBe(firstRaw.textContent);
        expect(raw.getAttribute("data-citation-presentation-error")).toBe(
          firstRaw.getAttribute("data-citation-presentation-error"),
        );
        expect(raw.getAttribute("aria-label")).toBe(
          firstRaw.getAttribute("aria-label"),
        );

        const repaired = yield* h.settles("note.md");
        h.changeFile("note.md", imported);
        yield* repaired;

        const restored = el.querySelector("p span")!;
        expect(restored.textContent).toBe(formatted);
        expect(
          restored.getAttribute("data-citation-presentation-error"),
        ).toBeNull();
        expect(restored.getAttribute("aria-label")).toBeNull();
      }),
  );

  it.live("keeps the formatted citation when a document read fails", () =>
    Effect.gen(function* () {
      let fail = false;
      const h = yield* makeHarness({
        body: "Blah [@alpha].",
        formatCitations: (sources) =>
          fail
            ? Promise.reject(new Error("render failed"))
            : Promise.resolve(sources.map((source) => rendered(`«${source}»`))),
      });
      yield* h.read("note.md");
      const el = section("<p>Blah [@alpha].</p>");
      h.process(el, h.viewedCtx(el));
      expect(el.textContent).toBe(`Blah «[@${ALPHA_KEY}]».`);

      fail = true;
      const settled = yield* h.settles("note.md");
      h.changeFile("note.md");

      expect(yield* settled).toMatchObject({
        _tag: "Some",
        value: { held: { status: "failed" } },
      });
      expect(el.textContent).toBe(`Blah «[@${ALPHA_KEY}]».`);
    }),
  );

  it.live(
    "keeps key state with the held document until its fresh read arrives",
    () =>
      Effect.gen(function* () {
        const h = yield* makeHarness({
          body: "[@twin]",
          cited: [citation("twin", null)],
        });
        const el = section("<p>[@twin]</p>");
        h.process(el, h.viewedCtx(el));
        expect(
          el.querySelector(`.${themeHook.citationKeyUnresolved}`),
        ).not.toBeNull();

        const settled = yield* h.settles("note.md");
        h.rebuildResolution(["twin"]);

        expect(
          el.querySelector(`.${themeHook.citationKeyUnresolved}`),
        ).not.toBeNull();
        yield* settled;
        expect(
          el.querySelector(`.${themeHook.citationKeyAmbiguous}`),
        ).not.toBeNull();
        expect(
          el.querySelector(`.${themeHook.citationKeyUnresolved}`),
        ).toBeNull();
        expect(h.rerenders()).toBe(0);
      }),
  );

  it.live("keeps a placed element across a refresh whose answer is equal", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ body: "Blah [@alpha]." });
      const el = section("<p>Blah [@alpha].</p>");
      h.process(el, h.viewedCtx(el));
      const element = el.querySelector<HTMLElement>(".zt-citation")!;

      const rebuilt = yield* h.settles("note.md");
      h.rebuildResolution([]);
      yield* rebuilt;
      const changed = yield* h.settles("note.md");
      h.changeFile("note.md");
      yield* changed;

      expect(el.querySelector(".zt-citation")).toBe(element);
      expect(el.textContent).toBe(`Blah «[@${ALPHA_KEY}]».`);
      element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      expect(h.popoverRequests).toHaveLength(1);
    }),
  );

  it.live("answers one hover with one popover after a refresh", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ body: "Blah [@alpha]." });
      const el = section("<p>Blah [@alpha].</p>");
      h.process(el, h.viewedCtx(el));

      h.renderAs((source) => `‹${source}›`);
      const settled = yield* h.settles("note.md");
      h.changeFile("note.md");
      yield* settled;
      expect(el.textContent).toBe(`Blah ‹[@${ALPHA_KEY}]›.`);
      el.querySelector<HTMLElement>(".zt-citation")!.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true }),
      );

      expect(h.popoverRequests).toHaveLength(1);
    }),
  );

  it.live("leaves a section Obsidian tore down alone", () =>
    Effect.gen(function* () {
      const h = yield* makeHarness({ body: "Blah [@alpha]." });
      const el = section("<p>Blah [@alpha].</p>");
      h.process(el, h.viewedCtx(el));
      expect(h.activeLookups()).toBe(1);
      h.unloadSections();
      expect(h.activeLookups()).toBe(0);

      h.renderAs((source) => `‹${source}›`);
      const changed = yield* h.changes("note.md");
      h.changeFile("note.md");
      yield* changed;

      expect(el.textContent).toBe(`Blah «[@${ALPHA_KEY}]».`);
    }),
  );
});
