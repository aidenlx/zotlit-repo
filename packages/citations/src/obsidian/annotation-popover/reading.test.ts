// @vitest-environment happy-dom
import type { DocumentCitations } from "#obsidian/citation-text/present.ts";
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit, Layer, Scope, Stream } from "effect";
import type {
  MarkdownPostProcessor,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  MarkdownSectionInformation,
  WorkspaceLeaf,
} from "obsidian";
import { Component, MarkdownView } from "obsidian";
import { describe, expect } from "vitest";

import { MemoryWorkspace } from "@zotlit/obsidian-kit/__fixtures__/obsidian-workspace.ts";
import { testPluginHost } from "@zotlit/obsidian-kit/__fixtures__/plugin-host.ts";
import { layerWorkspaceFrom } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { queryClientsFixture } from "@zotlit/plugin-services/core/query-client/__fixtures__.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { lookupAnswer } from "@zotlit/zotero-reads/__fixtures__/citation-lookup.ts";

import type { AnnotationLinkReadingDeps } from "./reading.ts";
import {
  AnnotationLinkReadingCore,
  layerAnnotationLinkReading,
} from "./reading.ts";
import type { AnnotationHoverRequest } from "./service.ts";
import { AnnotationPopover } from "./service.ts";

import { presented } from "#__fixtures__/citation-text.ts";
import { defaults } from "#__fixtures__/settings.ts";
import { CitationText } from "#obsidian/citation-text/service.ts";
import { CitekeyEditor } from "#obsidian/citekey-editor/service.ts";

const HREF = "zotero://open/library/items/RGRPDF24?annotation=PUPR5FG5&page=1";

async function harness(
  stack: AsyncDisposableStack,
  {
    html = `<p><a class="external-link" href="${HREF}"><strong>p. 1</strong></a></p>`,
    citations = () => null,
    held = (path) => {
      const value = citations(path);
      return value === null ? null : { value, status: "fresh" };
    },
    show,
    section: initialSection = null,
  }: {
    html?: string;
    citations?: (path: string) => DocumentCitations | null;
    held?: AnnotationLinkReadingDeps["citations"];
    show?: AnnotationLinkReadingDeps["show"];
    section?: MarkdownSectionInformation | null;
  } = {},
) {
  const hovers: AnnotationHoverRequest[] = [];
  let sectionInfo = initialSection;
  let process: MarkdownPostProcessor | undefined;
  const container = document.body.appendChild(document.createElement("div"));
  stack.defer(() => container.remove());
  const view: MarkdownView = Object.assign(
    new MarkdownView(stubService<WorkspaceLeaf>("WorkspaceLeaf", {})),
    {
      containerEl: container,
      hoverPopover: null,
    },
  );
  const service = stack.use(
    new AnnotationLinkReadingCore({
      markdownViews: () => [view],
      host: {
        registerMarkdownPostProcessor: (
          postProcessor: MarkdownPostProcessor,
        ) => {
          process = postProcessor;
          return postProcessor;
        },
      },
      show: show ?? ((request) => hovers.push(request)),
      citations: held,
      openItem: () => {
        throw new Error("Nothing opens a Literature Note here");
      },
    }),
  );
  const el = container.appendChild(document.createElement("div"));
  el.innerHTML = html;
  const section = new Component();
  section.load();
  stack.defer(() => section.unload());
  await process!(
    el,
    stubService<MarkdownPostProcessorContext>("MarkdownPostProcessorContext", {
      sourcePath: "drafts/chapter.md",
      addChild: (child: MarkdownRenderChild) => section.addChild(child),
      getSectionInfo: () => sectionInfo,
    }),
  );
  const anchor = el.querySelector("a")!;
  return {
    anchor,
    el,
    service,
    section,
    moveSection: (next: MarkdownSectionInformation | null) => {
      sectionInfo = next;
    },
    opened: () => hovers.length > 0,
  };
}

const enter = (anchor: Element, from: Element | null = null): void => {
  anchor.dispatchEvent(
    new MouseEvent("mouseover", { bubbles: true, relatedTarget: from }),
  );
};

describe("AnnotationLinkReading", () => {
  it("hovers once while the pointer moves inside one link", async () => {
    await using stack = new AsyncDisposableStack();
    const run = await harness(stack);

    enter(run.anchor, run.anchor.querySelector("strong"));
    expect(run.opened()).toBe(false);

    enter(run.anchor);
    expect(run.opened()).toBe(true);
  });

  it("stops answering hovers once Obsidian unloads the section", async () => {
    await using stack = new AsyncDisposableStack();
    const run = await harness(stack);

    run.section.unload();
    enter(run.anchor);

    expect(run.opened()).toBe(false);
  });

  it("stops answering hovers once the service is gone, though the section stays rendered", async () => {
    await using stack = new AsyncDisposableStack();
    const run = await harness(stack);

    run.service[Symbol.dispose]();
    enter(run.anchor);

    expect(run.opened()).toBe(false);
  });

  it.effect("interrupts a pending hover when the plugin unloads", () =>
    Effect.gen(function* () {
      let interrupted = false;
      const started = yield* Deferred.make<void>();
      let process: MarkdownPostProcessor | undefined;
      const host = testPluginHost({
        registerMarkdownPostProcessor: (postProcessor) => {
          process = postProcessor;
          return postProcessor;
        },
      });
      const container = document.body.appendChild(
        document.createElement("div"),
      );
      yield* Effect.addFinalizer(() => Effect.sync(() => container.remove()));
      const workspace = new MemoryWorkspace();
      workspace.openLeaf(
        "markdown",
        Object.assign(
          new MarkdownView(stubService<WorkspaceLeaf>("WorkspaceLeaf", {})),
          { containerEl: container, hoverPopover: null },
        ),
      );
      const scope = yield* Scope.fork(yield* Scope.Scope);
      yield* Layer.buildWithScope(
        layerAnnotationLinkReading.pipe(
          Layer.provide(
            Layer.mergeAll(
              host.layer,
              layerWorkspaceFrom(workspace),
              Layer.mock(PluginSettings, {
                current: Effect.succeed(defaults),
                changes: Stream.never,
              }),
              Layer.mock(CitationText, { events: Stream.never }),
              Layer.mock(CitekeyEditor, {}),
              Layer.mock(AnnotationPopover, {
                show: () =>
                  Deferred.succeed(started, undefined).pipe(
                    Effect.andThen(Effect.never),
                    Effect.onInterrupt(() =>
                      Effect.sync(() => {
                        interrupted = true;
                      }),
                    ),
                  ),
              }),
            ),
          ),
        ),
        scope,
      );
      const el = container.appendChild(document.createElement("div"));
      el.innerHTML = `<p><a class="external-link" href="${HREF}">p. 1</a></p>`;
      const section = new Component();
      section.load();
      yield* Effect.addFinalizer(() => Effect.sync(() => section.unload()));
      void process!(
        el,
        stubService<MarkdownPostProcessorContext>(
          "MarkdownPostProcessorContext",
          {
            sourcePath: "drafts/chapter.md",
            addChild: (child: MarkdownRenderChild) => section.addChild(child),
          },
        ),
      );

      enter(el.querySelector("a")!);
      yield* Deferred.await(started);
      yield* Scope.close(scope, Exit.void);

      expect(interrupted).toBe(true);
    }),
  );
});

const CITATION = `[](${HREF})`;

function citationsOf(starts: readonly number[]): DocumentCitations {
  const text = presented("(Rougier 2014, 1)");
  return {
    lookup: lookupAnswer({}, { RUGIER24: "rougierTenSimpleRules2014" }),
    formatted: new Map([
      [
        CITATION,
        starts.map((start) => ({
          ...text,
          text: {
            ...text.text,
            citations: [{ id: "RUGIER24", mode: "normal" as const }],
          },
          start,
        })),
      ],
    ]),
    entrySerials: false,
    summaries: new Map(),
    literalWorks: new Map(),
  };
}

describe("Annotation Citations in reading view", () => {
  it("shows the formatted citation in an empty link, and its hover names the Annotation", async () => {
    await using stack = new AsyncDisposableStack();
    const shown: AnnotationHoverRequest[] = [];
    const run = await harness(stack, {
      html: `<p>See <a class="external-link" href="${HREF}"></a>.</p>`,
      citations: () => citationsOf([4]),
      show: (request) => shown.push(request),
    });

    expect(run.anchor.textContent).toBe("(Rougier 2014, 1)");

    enter(run.anchor);
    expect(shown[0]?.link.annotationKey).toBe("PUPR5FG5");
  });

  it("keeps a link with text", async () => {
    await using stack = new AsyncDisposableStack();
    const shown: AnnotationHoverRequest[] = [];
    const run = await harness(stack, {
      citations: () => citationsOf([4]),
      show: (request) => shown.push(request),
    });

    expect(run.anchor.textContent).toBe("p. 1");
  });

  it("matches each link to the citation its section holds", async () => {
    await using stack = new AsyncDisposableStack();
    const second = "(Rougier 2014, 1) again";
    const run = await harness(stack, {
      html: `<p><a class="external-link" href="${HREF}"></a></p>`,
      section: { text: `${CITATION}\n${CITATION}`, lineStart: 1, lineEnd: 1 },
      citations: () => {
        const citations = citationsOf([0, CITATION.length + 1]);
        const [first, later] = citations.formatted.get(CITATION)!;
        (citations.formatted as Map<string, unknown>).set(CITATION, [
          first,
          {
            ...later!,
            text: { ...later!.text, content: [{ t: "Str", c: second }] },
          },
        ]);
        return citations;
      },
    });

    expect(run.anchor.textContent).toBe(second);
  });

  it("rewrites the citation in place when its note's citations change", async () => {
    await using stack = new AsyncDisposableStack();
    let citations: DocumentCitations | null = null;
    const run = await harness(stack, {
      html: `<p><a class="external-link" href="${HREF}"></a></p>`,
      citations: () => citations,
    });
    expect(run.anchor.hasChildNodes()).toBe(false);

    citations = citationsOf([0]);
    run.service.refresh("drafts/chapter.md");

    expect(run.anchor.textContent).toBe("(Rougier 2014, 1)");
  });

  it("restores the native annotation link when formatting disappears", async () => {
    await using stack = new AsyncDisposableStack();
    let citations: DocumentCitations | null = null;
    const run = await harness(stack, {
      html: `<p><a class="external-link" href="${HREF}"></a></p>`,
      citations: () => citations,
    });
    const native = run.anchor.cloneNode(true);
    citations = citationsOf([0]);
    run.service.refresh("drafts/chapter.md");
    expect(run.anchor.textContent).toBe("(Rougier 2014, 1)");

    citations = { ...citations, formatted: new Map() };
    run.service.refresh("drafts/chapter.md");

    expect.soft(run.anchor.hasChildNodes()).toBe(false);
    expect.soft(run.anchor.isEqualNode(native)).toBe(true);
    expect(run.el.querySelector("a")).toBe(run.anchor);
    expect(run.anchor.getAttribute("href")).toBe(HREF);
    enter(run.anchor);
    expect(run.opened()).toBe(true);

    citations = citationsOf([0]);
    run.service.refresh("drafts/chapter.md");
    expect(run.anchor.textContent).toBe("(Rougier 2014, 1)");
  });

  it("keeps the formatted annotation citation while its replacement read is pending", async () => {
    await using stack = new AsyncDisposableStack();
    const queries = stack.use(queryClientsFixture());
    const path = "drafts/chapter.md";
    const key = ["citations", path];
    const initial = citationsOf([0]);
    const replacement = { ...initial, formatted: new Map() };
    await queries.bridge.runPromise(queries.ask(key, async () => initial));
    const run = await harness(stack, {
      html: `<p><a class="external-link" href="${HREF}"></a></p>`,
      held: (sourcePath) =>
        queries.bridge.runSync(
          queries.peek<DocumentCitations>(["citations", sourcePath]),
        ),
    });
    expect(run.anchor.textContent).toBe("(Rougier 2014, 1)");

    queries.bridge.runSync(queries.invalidate(key));
    const gate = Promise.withResolvers<DocumentCitations>();
    const reading = queries.bridge.runPromise(
      queries.ask(key, () => gate.promise),
    );
    try {
      expect(queries.bridge.runSync(queries.peek(key))?.status).toBe(
        "revalidating",
      );
      run.service.refresh(path);
      expect(run.anchor.textContent).toBe("(Rougier 2014, 1)");
    } finally {
      gate.resolve(replacement);
      await reading;
    }
  });

  it("keeps the formatted annotation citation while a read is pending after an edit above it", async () => {
    await using stack = new AsyncDisposableStack();
    const queries = stack.use(queryClientsFixture());
    const path = "drafts/chapter.md";
    const key = ["citations", path];
    const initial = citationsOf([0]);
    await queries.bridge.runPromise(queries.ask(key, async () => initial));
    const run = await harness(stack, {
      html: `<p><a class="external-link" href="${HREF}"></a></p>`,
      held: (sourcePath) =>
        queries.bridge.runSync(
          queries.peek<DocumentCitations>(["citations", sourcePath]),
        ),
      section: { text: CITATION, lineStart: 0, lineEnd: 0 },
    });
    expect(run.anchor.textContent).toBe("(Rougier 2014, 1)");

    queries.bridge.runSync(queries.invalidate(key));
    const gate = Promise.withResolvers<DocumentCitations>();
    const reading = queries.bridge.runPromise(
      queries.ask(key, () => gate.promise),
    );
    try {
      run.moveSection({
        text: `Added line\n${CITATION}`,
        lineStart: 1,
        lineEnd: 1,
      });
      run.service.refresh(path);
      expect(run.anchor.textContent).toBe("(Rougier 2014, 1)");
    } finally {
      gate.resolve(citationsOf(["Added line\n".length]));
      await reading;
    }
    run.service.refresh(path);
    expect(run.anchor.textContent).toBe("(Rougier 2014, 1)");
  });
});
