// @vitest-environment happy-dom
import type { FormattedOccurrence } from "#obsidian/citation-text/present.ts";
import type { CitationTextEvent } from "#obsidian/citation-text/service.ts";
import type {
  CitationHoverRequest,
  NavigationPane,
} from "#obsidian/citekey-navigation/index.ts";
import type { ProfilePresentationFailure } from "#obsidian/pandoc/document-presentation.ts";
import { it } from "@effect/vitest";
import { Effect, Exit, Layer, Scope } from "effect";
import { Keymap, MarkdownView } from "obsidian";
import type {
  MarkdownPostProcessor,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  WorkspaceLeaf,
} from "obsidian";
import { describe, expect, vi } from "vitest";

import { MemoryMetadataCache } from "@zotlit/obsidian-kit/__fixtures__/obsidian-metadata-cache.ts";
import { MemoryVault } from "@zotlit/obsidian-kit/__fixtures__/obsidian-vault.ts";
import { MemoryWorkspace } from "@zotlit/obsidian-kit/__fixtures__/obsidian-workspace.ts";
import { testPluginHost } from "@zotlit/obsidian-kit/__fixtures__/plugin-host.ts";
import { layerMetadataCacheFrom } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { layerVaultFrom } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { layerWorkspaceFrom } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { unknownProfileDiagnostic } from "@zotlit/obsidian-kit/profile-stamp.ts";
import { testEvent } from "@zotlit/plugin-kernel/__fixtures__/event-stream.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { Held } from "@zotlit/plugin-services/core/query-client/service.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import type { NoteIndexChange } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { lookupAnswer } from "@zotlit/zotero-reads/__fixtures__/citation-lookup.ts";

import { layerWikilinkReading } from "./service.ts";

import { occurrences, rendered } from "#__fixtures__/citation-text.ts";
import { settingsFeed } from "#__fixtures__/settings.ts";
import {
  internalLink,
  section,
} from "#__fixtures__/wikilink-reading/internal-link.ts";
import { CitationPopover } from "#obsidian/citation-popover/service.ts";
import { citationKey } from "#obsidian/citation-text/present.ts";
import { CitationText } from "#obsidian/citation-text/service.ts";
import { CitekeyEditor } from "#obsidian/citekey-editor/service.ts";

const WANG = "literatures/wangMutationalClinicalSpectrum2020a";
const WANG_KEY = "ABCD2345";

function held(source: string, works: string[] = [WANG_KEY]): string {
  return citationKey({ source, works });
}

const harness = Effect.fnUntraced(function* ({
  formatted,
  citekeys,
  pending,
  presentationFailure,
  ...overrides
}: Partial<Settings> & {
  formatted?: Record<string, string>;
  pending?: boolean;
  presentationFailure?: ProfilePresentationFailure;
  citekeys?: Record<string, string>;
} = {}) {
  const settings = settingsFeed(overrides);
  const notes = testEvent<NoteIndexChange>();
  const citationText = new CitationTextStub(formatted ?? {}, pending, {
    presentationFailure,
    citekeys: citekeys ?? { [WANG_KEY]: "wang2020" },
  });
  const citationIndex = new CitationIndexStub(
    citekeys ?? { [WANG_KEY]: "wang2020" },
    (keys) => citationText.resolve(keys),
  );
  const requests: CitationHoverRequest[] = [];
  const switchRequests: string[] = [];
  const opened: [citekey: string, pane: NavigationPane][] = [];
  const native: MouseEvent[] = [];
  let rerenders = 0;
  let process: MarkdownPostProcessor | undefined;
  const children: MarkdownRenderChild[] = [];

  const vault = new MemoryVault();
  vault.add("note.md");
  const wangFile = vault.add(`${WANG}.md`);
  const metadata = new MemoryMetadataCache();
  metadata.links.set(WANG, wangFile);
  metadata.setCache(wangFile.path, {
    frontmatter: { "zotero-key": WANG_KEY },
  });
  const containerEl = document.createElement("div");
  containerEl.addEventListener("mouseover", (event) => native.push(event));
  containerEl.addEventListener("click", (event) => native.push(event));
  const workspace = new MemoryWorkspace();
  workspace.openLeaf(
    "markdown",
    Object.assign(
      new MarkdownView(stubService<WorkspaceLeaf>("WorkspaceLeaf", {})),
      {
        containerEl,
        previewMode: {
          rerender: () => {
            rerenders += 1;
          },
        },
      },
    ),
  );
  workspace.on("zotlit:switch-profile", (request) => {
    switchRequests.push((request as { path: string }).path);
  });
  const ctx = stubService<MarkdownPostProcessorContext>(
    "MarkdownPostProcessorContext",
    {
      sourcePath: "note.md",
      getSectionInfo: () => null,
      addChild: (child: MarkdownRenderChild) => {
        children.push(child);
        child.load();
      },
    },
  );
  const host = testPluginHost({
    registerMarkdownPostProcessor: (postProcessor) => {
      process = postProcessor;
      return postProcessor;
    },
  });
  const scope = yield* Scope.fork(yield* Scope.Scope);
  yield* Layer.buildWithScope(
    layerWikilinkReading.pipe(
      Layer.provide(
        Layer.mergeAll(
          host.layer,
          layerVaultFrom(vault),
          layerMetadataCacheFrom(metadata),
          layerWorkspaceFrom(workspace),
          Layer.mock(NoteIndex, { changes: notes.stream }),
          settings.layer,
          Layer.mock(CitationText, {
            events: citationText.events.stream,
            peek: () => Effect.sync(() => citationText.peek()),
          }),
          Layer.mock(CitekeyEditor, {
            openCitekey: (citekey, pane) =>
              Effect.sync(() => {
                opened.push([citekey, pane]);
              }),
          }),
          Layer.mock(CitationPopover, {
            show: (request) =>
              Effect.sync(() => {
                requests.push(request);
              }),
          }),
        ),
      ),
    ),
    scope,
  );
  const processSection = (root: HTMLElement) =>
    process!(containerEl.appendChild(root), ctx);
  const processHtml = (html: string) => {
    const root = section(html);
    return { root, result: processSection(root) };
  };
  return {
    settings,
    writeNote: (itemKey: string) => {
      metadata.setCache(wangFile.path, {
        frontmatter: { "zotero-key": itemKey },
      });
      notes.emit({ type: "changed", file: wangFile });
    },
    citationText,
    citationIndex,
    requests,
    switchRequests,
    opened,
    native,
    render: (linktext: string) =>
      processHtml(`<p>${internalLink(linktext)}</p>`).root.textContent ?? "",
    renderSection: (linktext: string, alias?: string) =>
      processHtml(`<p>${internalLink(linktext, alias)}</p>`).root,
    renderHtml: (html: string) => processHtml(html).root,
    processHtml,
    processSection,
    rerenders: () => rerenders,
    unloadSections: () => {
      for (const child of children.splice(0)) child.unload();
    },
    unload: Scope.close(scope, Exit.void),
  };
});

describe("WikilinkReading rendering", () => {
  it.effect(
    "names an unavailable Imported Note Profile with an Obsidian tooltip",
    () =>
      Effect.gen(function* () {
        const h = yield* harness({
          "citation.wikilink-citations": true,
          presentationFailure: {
            kind: "unusable",
            property: "profile",
            diagnostic: unknownProfileDiagnostic("deleted-profile"),
            target: "Imported/Research.md",
          },
        });

        const root = h.renderSection(WANG);
        const link = root.querySelector<HTMLElement>(
          '[data-citation-presentation-error="profile"]',
        );

        expect(link?.getAttribute("aria-label")).toContain("deleted-profile");
        expect(link?.getAttribute("aria-label")).toBe(
          m.notice_imported_note_profile_unknown({
            stamp: "deleted-profile",
            target: "Imported/Research.md",
          }),
        );
        const recovery = root.querySelector<HTMLButtonElement>(
          "[data-profile-recovery]",
        );
        expect(recovery?.textContent).toBe(m.profile_switch_recovery());
        recovery?.click();
        expect(h.switchRequests).toEqual(["Imported/Research.md"]);
        expect(link?.title).toBe("");
      }),
  );

  it.effect(
    "keeps a fragment-carrying link native without a formatted result",
    () =>
      Effect.gen(function* () {
        const h = yield* harness({ "citation.wikilink-citations": true });

        const root = h.renderSection(`${WANG}#cite:locator=7`);

        expect(root.textContent).toBe(`${WANG} > cite:locator=7`);
        expect(root.querySelector(".zt-literature-note-link")).toBeNull();
      }),
  );

  it.effect(
    "keeps a fragment-less link native without a formatted result",
    () =>
      Effect.gen(function* () {
        const h = yield* harness({ "citation.wikilink-citations": true });

        expect(h.render(WANG)).toBe(WANG);
      }),
  );

  it.effect(
    "keeps a native link when the Item carries no native citation key",
    () =>
      Effect.gen(function* () {
        const h = yield* harness({
          "citation.wikilink-citations": true,
          citekeys: {},
        });

        expect(h.render(WANG)).toBe(WANG);
      }),
  );

  it.effect(
    "shows the citation a style formatted once the shared text holds one",
    () =>
      Effect.gen(function* () {
        const h = yield* harness({
          "citation.wikilink-citations": true,
          formatted: {
            [held("[@wang2020, {p. 7}]")]: "(Wang et al. 2020, p. 7)",
          },
        });

        expect(h.render(`${WANG}#cite:locator=7`)).toBe(
          "(Wang et al. 2020, p. 7)",
        );
      }),
  );

  it.effect(
    "keeps the native link while formatted citation presentation is off",
    () =>
      Effect.gen(function* () {
        const h = yield* harness({
          "citation.wikilink-citations": true,
          "citation.show-formatted": false,
          formatted: {
            [held("[@wang2020, {p. 7}]")]: "(Wang et al. 2020, p. 7)",
          },
        });

        const root = h.renderSection(`${WANG}#cite:locator=7`);

        expect(root.textContent).toBe(`${WANG} > cite:locator=7`);
        expect(root.querySelector(".zt-literature-note-link")).toBeNull();
      }),
  );

  it.effect(
    "keeps the native link visible while citation text is pending",
    () =>
      Effect.gen(function* () {
        const h = yield* harness({
          "citation.wikilink-citations": true,
          pending: true,
        });

        const { root, result } = h.processHtml(
          `<p>${internalLink(`${WANG}#cite:locator=7`)}</p>`,
        );

        expect(result).toBeUndefined();
        expect(root.textContent).toBe(`${WANG} > cite:locator=7`);
        expect(root.querySelector(".zt-literature-note-link")).toBeNull();
      }),
  );

  it.effect("leaves a link that names no Literature Note alone", () =>
    Effect.gen(function* () {
      const h = yield* harness();

      expect(h.render("notes/plain")).toBe("notes/plain");
    }),
  );

  it.effect(
    "leaves the reading views alone once the treatment is retired",
    () =>
      Effect.gen(function* () {
        const h = yield* harness();
        yield* h.unload;

        expect(h.render(`${WANG}#cite:locator=7`)).toBe(
          `${WANG} > cite:locator=7`,
        );
      }),
  );
});

describe("WikilinkReading hover", () => {
  const rendering = (overrides: Parameters<typeof harness>[0] = {}) =>
    harness({
      "citation.wikilink-citations": true,
      formatted: {
        [held("[@wang2020, {p. 7}]")]: "(Wang et al. 2020, p. 7)",
      },
      ...overrides,
    });

  const hover = (root: HTMLElement) => {
    root
      .querySelector("a")
      ?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  };

  it.effect(
    "shows the Citation Popover of the work a rendered Citation names",
    () =>
      Effect.gen(function* () {
        const h = yield* rendering();
        const root = h.renderSection(`${WANG}#cite:locator=7`);

        hover(root);

        expect(h.requests).toHaveLength(1);
        expect(h.requests[0]).toMatchObject({
          targetEl: root.querySelector("a"),
          sourcePath: "note.md",
          works: [{ citekey: "wang2020", indexedKey: WANG_KEY }],
        });
      }),
  );

  it.effect(
    "keeps Obsidian's own hover out of a Citation the popover answers",
    () =>
      Effect.gen(function* () {
        const h = yield* rendering();
        const root = h.renderSection(`${WANG}#cite:locator=7`);

        hover(root);

        expect(h.native).toEqual([]);
      }),
  );

  it.effect("leaves the hover to Obsidian under Page preview and Off", () =>
    Effect.gen(function* () {
      for (const action of ["page-preview", "off"] as const) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const h = yield* rendering({ "citation.hover-action": action });
            const root = h.renderSection(`${WANG}#cite:locator=7`);

            hover(root);

            expect(h.requests).toEqual([]);
            expect(h.native).toHaveLength(1);
          }),
        );
      }
    }),
  );

  it.effect(
    "holds the hover back until Mod is held where Reading view asks for it",
    () =>
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => vi.restoreAllMocks()),
        );
        const h = yield* rendering({
          "citation.hover-require-mod-reading": true,
        });
        const root = h.renderSection(`${WANG}#cite:locator=7`);

        hover(root);
        expect(h.requests).toEqual([]);

        vi.spyOn(Keymap, "isModifier").mockReturnValue(true);
        hover(root);
        expect(h.requests).toHaveLength(1);
      }),
  );

  it.effect(
    "keeps Obsidian's own hover out while Require Mod holds the popover back",
    () =>
      Effect.gen(function* () {
        const h = yield* rendering({
          "citation.hover-require-mod-reading": true,
        });
        const root = h.renderSection(`${WANG}#cite:locator=7`);

        hover(root);

        expect(h.requests).toEqual([]);
        expect(h.native).toEqual([]);
      }),
  );

  it.effect(
    "leaves a link it rendered no Citation for hovering as Obsidian's own",
    () =>
      Effect.gen(function* () {
        const h = yield* rendering({ formatted: {} });
        const root = h.renderSection(`${WANG}#cite:locator=7`);

        hover(root);

        expect(h.requests).toEqual([]);
        expect(h.native).toHaveLength(1);
      }),
  );
});

describe("WikilinkReading click", () => {
  const rendering = (overrides: Parameters<typeof harness>[0] = {}) =>
    harness({
      "citation.wikilink-citations": true,
      formatted: {
        [held("[@wang2020, {p. 7}]")]: "(Wang et al. 2020, p. 7)",
      },
      ...overrides,
    });

  const click = (root: HTMLElement, init: MouseEventInit = {}) => {
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    root.querySelector("a")?.dispatchEvent(event);
    return event;
  };

  it.effect("swallows a plain click, and stops there", () =>
    Effect.gen(function* () {
      const h = yield* rendering();
      const root = h.renderSection(`${WANG}#cite:locator=7`);

      const event = click(root);

      expect(h.requests).toEqual([]);
      expect(h.opened).toEqual([]);
      expect(event.defaultPrevented).toBe(true);
      expect(h.native).toEqual([]);
      expect(root.querySelector("a")?.dataset.ztClick).toBe("none");
    }),
  );

  it.effect("swallows a plain click under Page preview and Off", () =>
    Effect.gen(function* () {
      for (const action of ["page-preview", "off"] as const) {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const h = yield* rendering({ "citation.hover-action": action });
            const root = h.renderSection(`${WANG}#cite:locator=7`);

            const event = click(root);

            expect(h.requests).toEqual([]);
            expect(event.defaultPrevented).toBe(true);
            expect(h.native).toEqual([]);
          }),
        );
      }
    }),
  );

  it.effect(
    "leaves a Mod-click to Obsidian, which opens the note the link names",
    () =>
      Effect.gen(function* () {
        vi.spyOn(Keymap, "isModifier").mockReturnValue(true);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => vi.restoreAllMocks()),
        );
        const h = yield* rendering();
        const root = h.renderSection(`${WANG}#cite:locator=7`);

        const event = click(root, { ctrlKey: true });

        expect(h.requests).toEqual([]);
        expect(h.opened).toEqual([]);
        expect(event.defaultPrevented).toBe(false);
        expect(h.native).toHaveLength(1);
      }),
  );

  it.effect(
    "leaves every click to Obsidian while Citations open as links",
    () =>
      Effect.gen(function* () {
        const h = yield* rendering({ "citation.open-as-links": true });
        const root = h.renderSection(`${WANG}#cite:locator=7`);

        const event = click(root);

        expect(h.requests).toEqual([]);
        expect(event.defaultPrevented).toBe(false);
        expect(h.native).toHaveLength(1);
        expect(root.querySelector("a")?.dataset.ztClick).toBeUndefined();
      }),
  );

  it.effect(
    "leaves a link it rendered no Citation for clicking as Obsidian's own",
    () =>
      Effect.gen(function* () {
        const h = yield* rendering({ formatted: {} });
        const root = h.renderSection(`${WANG}#cite:locator=7`);

        click(root);

        expect(h.requests).toEqual([]);
        expect(h.native).toHaveLength(1);
      }),
  );
});

describe("WikilinkReading rerender", () => {
  it.effect(
    "renders every reading view again when a Literature Note changes",
    () =>
      Effect.gen(function* () {
        const h = yield* harness();

        h.writeNote("WXYZ2345");

        expect(h.rerenders()).toBe(1);
      }),
  );

  it.effect("renders again when a gating setting changes", () =>
    Effect.gen(function* () {
      const h = yield* harness({ "citation.wikilink-citations": false });

      h.settings.update({ "citation.wikilink-citations": true });
      expect(h.rerenders()).toBe(1);

      h.settings.update({ "citation.show-formatted": false });
      expect(h.rerenders()).toBe(2);
    }),
  );

  it.effect("renders again when a setting changes who answers a gesture", () =>
    Effect.gen(function* () {
      const h = yield* harness();

      h.settings.update({ "citation.hover-action": "off" });
      expect(h.rerenders()).toBe(1);

      h.settings.update({ "citation.open-as-links": true });
      expect(h.rerenders()).toBe(2);
      h.settings.update({ "citation.open-as-links": false });
      expect(h.rerenders()).toBe(3);

      h.settings.update({ "citation.hover-require-mod-reading": true });
      expect(h.rerenders()).toBe(3);
    }),
  );

  it.effect(
    "leaves the reading views alone when what a Citation says changes",
    () =>
      Effect.gen(function* () {
        const h = yield* harness();

        h.citationIndex.emit();
        h.citationText.emit("invalidated");
        h.citationText.emit("changed", "note.md");
        expect(h.rerenders()).toBe(0);
      }),
  );

  it.effect(
    "leaves the reading views alone when an unrelated setting changes",
    () =>
      Effect.gen(function* () {
        const h = yield* harness();

        h.settings.update({ "citation.open-as-links": false });
        expect(h.rerenders()).toBe(0);
      }),
  );

  it.effect(
    "renders again on disposal, which drops the treatment's own text",
    () =>
      Effect.gen(function* () {
        const h = yield* harness();
        yield* h.unload;

        expect(h.rerenders()).toBe(1);
      }),
  );
});

describe("WikilinkReading refresh", () => {
  const CITE = `${WANG}#cite:locator=7`;
  const before = { [held("[@wang2020, {p. 7}]")]: "(Wang et al. 2020, p. 7)" };
  const after = { [held("[@wang2020, {p. 7}]")]: "(Wang 2020, 7)" };

  it.effect(
    "restores a wikilink after its Imported Note Profile is repaired",
    () =>
      Effect.gen(function* () {
        const h = yield* harness({
          "citation.wikilink-citations": true,
          presentationFailure: {
            kind: "unusable",
            property: "profile",
            diagnostic: unknownProfileDiagnostic("missing-a"),
            target: "note.md",
          },
        });
        const root = h.renderSection(CITE);
        const anchor = root.querySelector("a")!;
        expect(anchor.getAttribute("aria-label")).toContain("missing-a");

        h.citationText.repairProfile();
        h.citationText.hold(before);
        h.citationText.emit("changed", "note.md");

        expect(root.querySelector("a")).toBe(anchor);
        expect.soft(anchor.hasAttribute("aria-label")).toBe(false);
        expect
          .soft(anchor.hasAttribute("data-citation-presentation-error"))
          .toBe(false);
        expect(anchor.textContent).toBe("(Wang et al. 2020, p. 7)");
      }),
  );

  it.effect(
    "preserves a native alias through a Profile failure and repair",
    () =>
      Effect.gen(function* () {
        const h = yield* harness({ "citation.wikilink-citations": true });
        h.citationText.failProfile("missing-a");
        const breadcrumb = `${WANG} > cite:locator=7`;
        const root = h.renderHtml(
          `<p>${internalLink(CITE)} and ${internalLink(CITE, breadcrumb)}</p>`,
        );
        const [citation, alias] = root.querySelectorAll("a");
        expect(citation?.getAttribute("aria-label")).toContain("missing-a");
        expect(alias?.getAttribute("aria-label")).toBe(breadcrumb);

        h.citationText.repairProfile();
        h.citationText.hold(before);
        h.citationText.emit("changed", "note.md");

        expect(citation?.textContent).toBe("(Wang et al. 2020, p. 7)");
        expect(root.querySelectorAll("a")[1]).toBe(alias);
        expect(alias?.textContent).toBe(breadcrumb);
        expect(alias?.getAttribute("aria-label")).toBe(breadcrumb);
        expect(alias?.getAttribute("data-tooltip-position")).toBe("top");
      }),
  );

  it.effect(
    "updates a changed Profile stamp on the same formatted wikilink",
    () =>
      Effect.gen(function* () {
        const h = yield* harness({
          "citation.wikilink-citations": true,
          formatted: before,
        });
        const root = h.renderSection(CITE);
        const anchor = root.querySelector("a")!;
        expect(anchor.textContent).toBe("(Wang et al. 2020, p. 7)");

        h.citationText.hold({});
        h.citationText.failProfile("missing-a");
        h.citationText.emit("changed", "note.md");
        expect(anchor.getAttribute("aria-label")).toContain("missing-a");

        h.citationText.failProfile("missing-b");
        h.citationText.emit("changed", "note.md");

        expect(root.querySelector("a")).toBe(anchor);
        expect(anchor.textContent).toBe(`${WANG} > cite:locator=7`);
        expect(anchor.getAttribute("aria-label")).toBe(
          m.notice_imported_note_profile_unknown({
            stamp: "missing-b",
            target: "note.md",
          }),
        );
      }),
  );

  it.effect(
    "refreshes a rendered Citation in place when its document's text changes",
    () =>
      Effect.gen(function* () {
        const h = yield* harness({
          "citation.wikilink-citations": true,
          formatted: before,
        });
        const root = h.renderSection(CITE);
        const anchor = root.querySelector("a");
        expect(root.textContent).toBe("(Wang et al. 2020, p. 7)");

        h.citationText.hold(after);
        h.citationText.emit("changed", "note.md");

        expect(root.textContent).toBe("(Wang 2020, 7)");
        expect(root.querySelector("a")).toBe(anchor);
        expect(anchor?.dataset["href"]).toBe(CITE);
        expect(h.rerenders()).toBe(0);
      }),
  );

  it.effect("leaves another document's sections alone", () =>
    Effect.gen(function* () {
      const h = yield* harness({
        "citation.wikilink-citations": true,
        formatted: before,
      });
      const root = h.renderSection(CITE);

      h.citationText.hold(after);
      h.citationText.emit("changed", "other.md");

      expect(root.textContent).toBe("(Wang et al. 2020, p. 7)");
      expect(h.rerenders()).toBe(0);
    }),
  );

  it.effect(
    "refreshes every live section when every document's text goes stale",
    () =>
      Effect.gen(function* () {
        const h = yield* harness({
          "citation.wikilink-citations": true,
          formatted: before,
        });
        const root = h.renderSection(CITE);

        h.citationText.hold(after);
        h.citationText.emit("invalidated");

        expect(root.textContent).toBe("(Wang 2020, 7)");
        expect(h.rerenders()).toBe(0);
      }),
  );

  it.effect(
    "keeps the formatted Citation when a read with no matching text is pending or failed",
    () =>
      Effect.gen(function* () {
        const h = yield* harness({
          "citation.wikilink-citations": true,
          formatted: before,
        });
        const root = h.renderSection(CITE);

        for (const status of ["revalidating", "failed"] as const) {
          h.citationText.hold({}, status);
          h.citationText.emit("changed", "note.md");

          expect(root.textContent).toBe("(Wang et al. 2020, p. 7)");
        }
        expect(h.rerenders()).toBe(0);
      }),
  );

  it.effect(
    "restores the native link and hover when fresh citation text is missing",
    () =>
      Effect.gen(function* () {
        const h = yield* harness({
          "citation.wikilink-citations": true,
          "citation.hover-action": "popover",
          formatted: before,
        });
        const root = section(`<p>${internalLink(CITE)}</p>`);
        const native = root.cloneNode(true);
        const anchor = root.querySelector("a")!;
        void h.processSection(root);
        expect(anchor.textContent).toBe("(Wang et al. 2020, p. 7)");

        h.citationText.hold({});
        h.citationText.emit("changed", "note.md");

        expect.soft(root.isEqualNode(native)).toBe(true);
        expect(root.querySelector("a")).toBe(anchor);
        expect(anchor.dataset["href"]).toBe(CITE);
        const hover = new MouseEvent("mouseover", { bubbles: true });
        anchor.dispatchEvent(hover);
        expect.soft(h.native).toEqual([hover]);
        expect.soft(h.requests).toHaveLength(0);

        h.citationText.hold(after);
        h.citationText.emit("changed", "note.md");

        expect(anchor.textContent).toBe("(Wang 2020, 7)");
      }),
  );

  it.effect(
    "keeps a rendered Citation Run in its one anchor and updates its text",
    () =>
      Effect.gen(function* () {
        const source = held("[@wang2020, {p. 7}; @wang2020, {p. 9}]", [
          WANG_KEY,
          WANG_KEY,
        ]);
        const h = yield* harness({
          "citation.wikilink-citations": true,
          formatted: { [source]: "(Wang et al. 2020, pp. 7, 9)" },
        });
        const root = h.renderHtml(
          `<p>See ${internalLink(CITE)}; ${internalLink(`${WANG}#cite:locator=9`)} here.</p>`,
        );
        expect(root.textContent).toBe("See (Wang et al. 2020, pp. 7, 9) here.");

        h.citationText.hold({ [source]: "(Wang 2020, 7, 9)" });
        h.citationText.emit("invalidated");

        expect(root.textContent).toBe("See (Wang 2020, 7, 9) here.");
        expect(root.querySelectorAll("a")).toHaveLength(1);
        expect(root.querySelector("a")?.dataset["href"]).toBe(CITE);
      }),
  );

  it.effect(
    "restores every native link and separator when fresh text for a Citation Run is missing",
    () =>
      Effect.gen(function* () {
        const source = held("[@wang2020, {p. 7}; @wang2020, {p. 9}]", [
          WANG_KEY,
          WANG_KEY,
        ]);
        const h = yield* harness({
          "citation.wikilink-citations": true,
          formatted: { [source]: "(Wang et al. 2020, pp. 7, 9)" },
        });
        const root = section(
          `<p>See ${internalLink(CITE)}; ${internalLink(`${WANG}#cite:locator=9`)} here.</p>`,
        );
        const native = root.cloneNode(true);
        const [first, second] = root.querySelectorAll("a");
        const separator = first!.nextSibling;
        void h.processSection(root);
        expect(root.textContent).toBe("See (Wang et al. 2020, pp. 7, 9) here.");
        expect(root.querySelectorAll("a")).toHaveLength(1);

        h.citationText.hold({});
        h.citationText.emit("changed", "note.md");

        expect.soft(root.isEqualNode(native)).toBe(true);
        const [restoredFirst, restoredSecond] = root.querySelectorAll("a");
        expect(restoredFirst).toBe(first);
        expect.soft(restoredSecond).toBe(second);
        expect(restoredFirst!.nextSibling).toBe(separator);
      }),
  );

  it.effect(
    "shows a Citation that rendered before its text was held once the text arrives",
    () =>
      Effect.gen(function* () {
        const h = yield* harness({
          "citation.wikilink-citations": true,
          formatted: {},
        });
        const root = h.renderSection(CITE);
        expect(root.querySelector(".zt-citation")).toBeNull();

        h.citationText.hold(before);
        h.citationText.emit("changed", "note.md");

        expect(root.textContent).toBe("(Wang et al. 2020, p. 7)");
        expect(root.querySelector(".zt-citation")).not.toBeNull();
        expect(h.rerenders()).toBe(0);
      }),
  );

  it.effect(
    "shows a section that rendered while text was pending once it settles",
    () =>
      Effect.gen(function* () {
        const h = yield* harness({
          "citation.wikilink-citations": true,
          pending: true,
        });
        const root = h.renderSection(CITE);
        expect(root.textContent).toBe(`${WANG} > cite:locator=7`);

        h.citationText.hold(before);
        h.citationText.emit("changed", "note.md");

        expect(root.textContent).toBe("(Wang et al. 2020, p. 7)");
        expect(h.rerenders()).toBe(0);
      }),
  );

  it.effect(
    "refreshes every live section when the citekey resolution snapshot rebuilds",
    () =>
      Effect.gen(function* () {
        const h = yield* harness({
          "citation.wikilink-citations": true,
          formatted: before,
        });
        const root = h.renderSection(CITE);

        h.citationText.hold(after);
        h.citationIndex.emit();

        expect(root.textContent).toBe("(Wang 2020, 7)");
        expect(h.rerenders()).toBe(0);
      }),
  );

  it.effect(
    "shows a link whose Item gained a native citation key at a snapshot rebuild",
    () =>
      Effect.gen(function* () {
        const h = yield* harness({
          "citation.wikilink-citations": true,
          formatted: before,
          citekeys: {},
        });
        const root = h.renderSection(CITE);
        expect(root.textContent).toBe(`${WANG} > cite:locator=7`);

        h.citationIndex.resolve({ [WANG_KEY]: "wang2020" });
        h.citationIndex.emit();

        expect(root.textContent).toBe("(Wang et al. 2020, p. 7)");
        expect(h.rerenders()).toBe(0);
      }),
  );

  it.effect("answers one hover with one popover after a refresh", () =>
    Effect.gen(function* () {
      const h = yield* harness({
        "citation.wikilink-citations": true,
        formatted: before,
      });
      const root = h.renderSection(CITE);

      h.citationText.hold(after);
      h.citationText.emit("changed", "note.md");
      root
        .querySelector("a")
        ?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

      expect(h.requests).toHaveLength(1);
    }),
  );

  it.effect(
    "answers each hover once when the citation text matches the native link",
    () =>
      Effect.gen(function* () {
        const h = yield* harness({
          "citation.wikilink-citations": true,
          "citation.hover-action": "popover",
          formatted: { [held("[@wang2020]")]: WANG },
        });
        const root = h.renderSection(WANG);
        const anchor = root.querySelector("a")!;
        expect(anchor.textContent).toBe(WANG);

        const requestsPerHover: number[] = [];
        for (const refresh of [false, true, true]) {
          if (refresh) h.citationText.emit("changed", "note.md");
          const previous = h.requests.length;
          anchor.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          requestsPerHover.push(h.requests.length - previous);
          expect(root.querySelectorAll("a")).toHaveLength(1);
          expect(root.querySelector("a")).toBe(anchor);
        }

        expect(requestsPerHover).toEqual([1, 1, 1]);
      }),
  );

  it.effect("leaves a section Obsidian tore down alone", () =>
    Effect.gen(function* () {
      const h = yield* harness({
        "citation.wikilink-citations": true,
        formatted: before,
      });
      const root = h.renderSection(CITE);
      h.unloadSections();

      h.citationText.hold(after);
      h.citationText.emit("invalidated");

      expect(root.textContent).toBe("(Wang et al. 2020, p. 7)");
    }),
  );
});

interface HeldText {
  formatted: Map<string, FormattedOccurrence[]>;
  entrySerials: boolean;
  summaries: Map<string, string>;
  presentationFailure?: ProfilePresentationFailure;
  literalWorks: Map<string, string>;
  lookup: ReturnType<typeof lookupAnswer>;
}

class CitationTextStub {
  readonly events = testEvent<CitationTextEvent>();
  #citekeys: Record<string, string>;
  #formatted: Record<string, string>;
  #pending: boolean;
  #status: Held<HeldText>["status"] = "fresh";
  #presentationFailure: ProfilePresentationFailure | undefined;

  constructor(
    formatted: Record<string, string>,
    pending: boolean | undefined,
    {
      presentationFailure,
      citekeys,
    }: {
      presentationFailure?: ProfilePresentationFailure;
      citekeys: Record<string, string>;
    },
  ) {
    this.#citekeys = citekeys;
    this.#formatted = formatted;
    this.#pending = pending ?? false;
    this.#presentationFailure = presentationFailure;
  }

  resolve(citekeys: Record<string, string>): void {
    this.#citekeys = citekeys;
    this.emit();
  }

  repairProfile(): void {
    this.#presentationFailure = undefined;
  }

  failProfile(stamp: string): void {
    this.#presentationFailure = {
      kind: "unusable",
      property: "profile",
      diagnostic: unknownProfileDiagnostic(stamp),
      target: "note.md",
    };
  }

  hold(
    formatted: Record<string, string>,
    status: Held<HeldText>["status"] = "fresh",
  ): void {
    this.#formatted = formatted;
    this.#pending = false;
    this.#status = status;
  }

  peek(): Held<HeldText> | null {
    if (this.#pending) return null;
    const value = this.#text();
    return { value, status: this.#status, settled: Promise.resolve(value) };
  }

  #text(): HeldText {
    const formatted = new Map<string, FormattedOccurrence[]>();
    for (const [source, text] of Object.entries(this.#formatted)) {
      formatted.set(source, occurrences(rendered(text)));
    }
    return {
      formatted,
      entrySerials: false,
      summaries: new Map(),
      lookup: lookupAnswer(
        {},
        { [WANG_KEY]: this.#citekeys[WANG_KEY] ?? null, ...this.#citekeys },
      ),
      literalWorks: new Map(),
      ...(this.#presentationFailure
        ? { presentationFailure: this.#presentationFailure }
        : {}),
    };
  }

  emit(event: "changed" | "invalidated" = "invalidated", path?: string): void {
    this.events.emit(
      event === "changed" ? { type: "changed", path: path! } : { type: event },
    );
  }
}

class CitationIndexStub {
  readonly #changed;
  #citekeys: Record<string, string>;

  constructor(
    citekeys: Record<string, string>,
    changed: (keys: Record<string, string>) => void,
  ) {
    this.#changed = changed;
    this.#citekeys = citekeys;
  }

  resolve(citekeys: Record<string, string>): void {
    this.#citekeys = citekeys;
  }

  emit(): void {
    this.#changed(this.#citekeys);
  }
}
