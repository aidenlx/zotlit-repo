// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Scope,
  Stream,
} from "effect";
import { FileSystemAdapter, Scope as ObsidianScope } from "obsidian";
import type { App, TFile, Vault } from "obsidian";
import { beforeEach, afterEach, expect } from "vitest";

import {
  resetMockPlatform,
  setMockPlatform,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import type { PdfReaderView } from "@zotlit/pdf-reader/obsidian";
beforeEach(() => setMockPlatform({ isMacOS: false }));
afterEach(() => resetMockPlatform());

import type { OpenReaderView } from "#__fixtures__/pdf-annotation-editor/editor.ts";

import { MemoryWorkspace } from "@zotlit/obsidian-kit/__fixtures__/obsidian-workspace.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { PdfAnnotationEditor } from "./service.ts";

import {
  annotationReads,
  attachmentReads,
  capabilityGestures,
  markGestures,
  pdfReader,
  readerSettings,
} from "#__fixtures__/pdf-annotation-editor.ts";
import {
  attachReader,
  editorFixtureLayer,
} from "#__fixtures__/pdf-annotation-editor/editor.ts";

const host = () => {
  const workspace = new MemoryWorkspace();
  const reader = pdfReader();
  const view = stubService<PdfReaderView & OpenReaderView>("PdfReaderView", {
    file: stubService<TFile>("TFile", {
      path: "attachments/rougier-2014.pdf",
    }),
    leaf: undefined,
    app: stubService<App>("App", {}),
    fake: reader,
    containerEl: document.createElement("div"),
    scope: new ObsidianScope(),
  });
  const app = stubService<App>("App", {
    vault: stubService<Vault>("Vault", { adapter: new FileSystemAdapter() }),
  });
  return { workspace, reader, view, app };
};

it.effect(
  "ends the session Stream and withdraws bindings when its layer closes",
  () =>
    Effect.gen(function* () {
      const h = host();
      const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const layer = editorFixtureLayer({
        app: h.app,
        workspace: h.workspace,
        attachments: attachmentReads(),
        annotations: annotationReads(),
        capabilityGestures: capabilityGestures(),
        markGestures: markGestures(),
        noteIndex: { getNotesByItemKey: () => Effect.succeed([]) },
        settings: readerSettings(),
      });
      const context = yield* Layer.build(layer).pipe(
        Effect.provideService(Scope.Scope, scope),
      );
      const editor = Context.get(context, PdfAnnotationEditor);
      const announced = yield* Stream.runCollect(editor.sessionAdded).pipe(
        Effect.forkScoped({ startImmediately: true }),
      );
      const attached = attachReader(editor, h.view);
      h.workspace.layoutReady();
      expect(yield* editor.bindings).toHaveLength(1);
      yield* Scope.close(scope, Exit.succeed(undefined));
      expect(yield* editor.bindings).toEqual([]);
      expect(yield* Fiber.join(announced)).toEqual([
        "attachments/rougier-2014.pdf",
      ]);
      h.reader.navigateTo("#page=1&zt-annotation=PUPR5FG5");
      attached?.[Symbol.dispose]();
      expect(yield* editor.bindings).toEqual([]);
    }),
);

it.effect(
  "leaves a delayed layout callback and a late attach inert after scope close",
  () =>
    Effect.gen(function* () {
      const h = host();
      const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const context = yield* Layer.build(
        editorFixtureLayer({
          app: h.app,
          workspace: h.workspace,
          attachments: attachmentReads(),
          annotations: annotationReads(),
          capabilityGestures: capabilityGestures(),
          markGestures: markGestures(),
          noteIndex: { getNotesByItemKey: () => Effect.succeed([]) },
          settings: readerSettings(),
        }),
      ).pipe(Effect.provideService(Scope.Scope, scope));
      const editor = Context.get(context, PdfAnnotationEditor);
      yield* Scope.close(scope, Exit.succeed(undefined));
      h.workspace.layoutReady();
      expect(attachReader(editor, h.view)).toBeUndefined();
      expect(yield* editor.bindings).toEqual([]);
    }),
);

it.effect(
  "interrupts a pending annotation read when the editor scope closes",
  () =>
    Effect.gen(function* () {
      const h = host();
      const started = yield* Deferred.make<void>();
      const stopped = yield* Deferred.make<void>();
      const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
        Scope.close(scope, Exit.void),
      );
      const annotations = annotationReads();
      annotations.read.mockImplementation(() =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Deferred.succeed(stopped, undefined)),
        ),
      );
      const context = yield* Layer.build(
        editorFixtureLayer({
          app: h.app,
          workspace: h.workspace,
          attachments: attachmentReads({
            kind: "resolved",
            attachmentKey: "RGRPDF24",
            itemKey: "ROUG2014",
            serverID: null,
            openable: true,
          }),
          annotations,
          capabilityGestures: capabilityGestures(),
          markGestures: markGestures(),
          noteIndex: { getNotesByItemKey: () => Effect.succeed([]) },
          settings: readerSettings(),
        }),
      ).pipe(Effect.provideService(Scope.Scope, scope));
      const editor = Context.get(context, PdfAnnotationEditor);
      attachReader(editor, h.view);
      h.workspace.layoutReady();
      expect(annotations.read).toHaveBeenCalledOnce();
      yield* Deferred.await(started);
      const binding = (yield* editor.bindings)[0]!;
      yield* Scope.close(scope, Exit.succeed(undefined));
      yield* Deferred.await(stopped);
      yield* Effect.promise(() => binding.refreshed);
      expect(yield* editor.bindings).toEqual([]);
    }),
);
