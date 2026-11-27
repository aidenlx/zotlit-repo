import type { EditorView } from "@codemirror/view";
// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Effect, FiberSet, Scope } from "effect";
import { TFile } from "obsidian";
import type { App, Editor, MarkdownFileInfo } from "obsidian";
import { describe, expect, vi } from "vitest";

import { stateEditor } from "@zotlit/annotations/__fixtures__/annot-view/editor.ts";
import { setup as repositorySetup } from "@zotlit/annotations/__fixtures__/annotation-repository.ts";
import { watchInsertionWorkspace } from "@zotlit/annotations/obsidian/annot-view/async-insert.ts";
import type { InsertRunner } from "@zotlit/annotations/obsidian/annot-view/insert-run.ts";
import { annotationAction } from "@zotlit/notes/__fixtures__/note-feature/annotation-actions.ts";
import type { AnnotationInsert } from "@zotlit/notes/desktop/note-feature/insert-annotation.ts";
import type { HostSources } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import { MemoryWorkspace } from "@zotlit/obsidian-kit/__fixtures__/obsidian-workspace.ts";
import { answerOf } from "@zotlit/obsidian-kit/view-runner.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { openScope } from "@zotlit/plugin-kernel/effect-scope.ts";
import {
  buildUseLedger,
  ledgerHost,
} from "@zotlit/plugin-services/obsidian/use-ledger/__fixtures__.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";

import { insertAnnotation } from "./annotation-insert.ts";
import type { AnnotationHit } from "./annotation-search.ts";

const hit: AnnotationHit = {
  key: "PUPR5FG5",
  attachmentKey: "RGRPDF24",
  itemKey: "RUGIER24",
  type: "highlight",
  text: "Identify Your Message",
  comment: null,
  color: "#2ea8e5",
  pageLabel: "1",
  title: "Ten Simple Rules for Better Figures",
  citationKey: "rougier2014",
};

function host(): { sources: HostSources; app: App } {
  const workspace = new MemoryWorkspace();
  const sources = ledgerHost({ workspace });
  const app = stubService<App>("App", {
    workspace: stubService<App["workspace"]>("Workspace", {
      on: (name: string, callback: (...data: never[]) => unknown) =>
        workspace.on(name, (...data: unknown[]) =>
          Reflect.apply(callback, undefined, data),
        ),
      offref: (ref) => workspace.offref(ref),
    }),
  });
  return { sources, app };
}

async function harness(
  stack: AsyncDisposableStack,
  doc: string,
  { whileRendering }: { whileRendering?: (cm: EditorView) => void } = {},
) {
  const { service: repository } = await repositorySetup(stack);
  const { sources, app } = host();
  const useLedger = buildUseLedger(sources, stack);
  const cm = stateEditor({ doc });
  stack.defer(() => cm.destroy());
  const editor = stubService<Editor>("Editor", {
    cm,
    getValue: () => cm.state.doc.toString(),
  });
  const file = new TFile();
  file.path = "Draft.md";
  const info = stubService<MarkdownFileInfo>("MarkdownFileInfo", {
    editor,
    file,
  });
  const prepare = vi.fn<(signal: AbortSignal) => Promise<AnnotationInsert>>(
    async () => {
      whileRendering?.(cm);
      return {
        text: "quote",
        summary: {
          zotero: 0,
          unchecked: 0,
          unavailable: 0,
        },
      };
    },
  );
  const { scope, close } = openScope();
  stack.defer(close);
  const runner: InsertRunner<never> = {
    execute: (request) =>
      annotationAction(
        request,
        Effect.tryPromise((signal) => {
          signal.throwIfAborted();
          return prepare(signal);
        }),
        {
          repository,
          serverID: "XmplSrv00Id1",
          ledger: useLedger.runtime.runSync(UseLedger),
        },
      ),
    run: Effect.runSync(
      FiberSet.make().pipe(
        Effect.flatMap((fibers) => FiberSet.runtime(fibers)<never>()),
        Scope.provide(scope),
      ),
    ),
  };
  const notify = vi.fn<(message: string | DocumentFragment) => void>();
  const start = (target: AnnotationHit, from: number, to: number) => {
    const fiber = insertAnnotation(
      {
        app,
        watchChanges: watchInsertionWorkspace(app.workspace),
        runner,
        notify,
      },
      { hit: target, info, isCurrent: () => true, range: { from, to } },
    );
    if (!fiber) throw new Error("The insert did not start.");
    return fiber;
  };
  const insert = (target: AnnotationHit, from: number, to: number) =>
    answerOf(start(target, from, to), undefined);
  return {
    insert,
    start,
    cm,
    unload: close,
    notify,
    prepare,
    useLedger,
    text: () => cm.state.doc.toString(),
  };
}

describe("insertAnnotation", () => {
  it.effect(
    "records no Use when an edit over the trigger text drops the insert",
    () =>
      Effect.promise(async () => {
        await using stack = new AsyncDisposableStack();
        const h = await harness(stack, "As shown [>message] here", {
          whileRendering: (cm) =>
            cm.dispatch({ changes: { from: 9, to: 19, insert: "typed" } }),
        });

        expect(await h.insert(hit, 9, 19)).toBeUndefined();

        expect(h.prepare).toHaveBeenCalledOnce();
        expect(h.notify).not.toHaveBeenCalled();
        expect(h.text()).toBe("As shown typed here");
        expect(h.useLedger.runtime.runSync(h.useLedger.current)).toEqual({});
      }),
  );

  it.effect(
    "answers unavailable and leaves the trigger text when the annotation is gone",
    () =>
      Effect.promise(async () => {
        await using stack = new AsyncDisposableStack();
        const h = await harness(stack, "[>message]");

        expect(await h.insert({ ...hit, key: "GONE2345" }, 0, 10)).toEqual({
          kind: "unavailable",
        });

        expect(h.notify).toHaveBeenCalledOnce();
        expect(h.text()).toBe("[>message]");
        expect(h.prepare).not.toHaveBeenCalled();
        expect(h.useLedger.runtime.runSync(h.useLedger.current)).toEqual({});
      }),
  );

  it.effect("interrupts the render when an edit cancels the destination", () =>
    Effect.promise(async () => {
      await using stack = new AsyncDisposableStack();
      const h = await harness(stack, "As shown [>message] here");
      const rendering = Promise.withResolvers<AbortSignal>();
      h.prepare.mockImplementation((signal) => {
        rendering.resolve(signal);
        return new Promise<AnnotationInsert>(() => {});
      });
      const answer = answerOf(h.start(hit, 9, 19), undefined);

      const signal = await rendering.promise;
      expect(signal.aborted).toBe(false);
      h.cm.dispatch({ changes: { from: 9, to: 19, insert: "typed" } });

      expect(await answer).toBeUndefined();
      expect(signal.aborted).toBe(true);
      expect(h.text()).toBe("As shown typed here");
      expect(h.notify).not.toHaveBeenCalled();
    }),
  );

  it.effect("interrupts the render when the plugin unloads", () =>
    Effect.promise(async () => {
      await using stack = new AsyncDisposableStack();
      const h = await harness(stack, "As shown [>message] here");
      const rendering = Promise.withResolvers<AbortSignal>();
      h.prepare.mockImplementation((signal) => {
        rendering.resolve(signal);
        return new Promise<AnnotationInsert>(() => {});
      });
      const answer = answerOf(h.start(hit, 9, 19), undefined);

      const signal = await rendering.promise;
      await h.unload();

      expect(await answer).toBeUndefined();
      expect(signal.aborted).toBe(true);
      expect(h.text()).toBe("As shown [>message] here");
      expect(h.notify).not.toHaveBeenCalled();
    }),
  );
});

it.effect("records a Use only after the selected annotation lands", () =>
  Effect.promise(async () => {
    await using stack = new AsyncDisposableStack();
    const h = await harness(stack, "[>message]");
    expect(await h.insert(hit, 0, 10)).toEqual({
      kind: "inserted",
      summary: { zotero: 0, unchecked: 0, unavailable: 0 },
    });
    expect(h.text()).toBe("quote ");
    expect(
      h.useLedger.runtime.runSync(h.useLedger.current)[hit.itemKey]?.kind,
    ).toBe("cited");
  }),
);
