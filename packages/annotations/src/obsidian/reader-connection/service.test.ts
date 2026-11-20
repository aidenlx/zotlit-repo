// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import {
  Events,
  FileSystemAdapter,
  Scope as ObsidianScope,
  WorkspaceLeaf,
} from "obsidian";
import type { App, PaneType, TFile, Vault, View } from "obsidian";
import { afterEach, beforeEach, expect, expectTypeOf, vi } from "vitest";
import type { MockInstance } from "vitest";

import { MemoryWorkspace } from "@zotlit/obsidian-kit/__fixtures__/obsidian-workspace.ts";
import {
  resetMockPlatform,
  setMockPlatform,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { layerWorkspaceFrom } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import type {
  ConnectHandlers,
  PdfReader,
  ReaderApi,
  ReaderHostContext,
} from "@zotlit/reader-api";
import { answerConnect, READER_API } from "@zotlit/reader-api";

import { readerHandshake } from "./handshake.ts";
import type { ReaderConnectionState, ReaderSource } from "./service.ts";
import { layerReaderConnection, ReaderConnection } from "./service.ts";

import {
  annotationReads,
  attachmentReads,
  capabilityGestures,
  markGestures,
  pdfReader,
  readerSettings,
} from "#__fixtures__/pdf-annotation-editor.ts";
import { editorFixtureLayer } from "#__fixtures__/pdf-annotation-editor/editor.ts";
import { PdfAnnotationEditor } from "#obsidian/pdf-annotation-editor/service.ts";
import {
  layerZotlitPdfReader,
  ZotlitPdfReader,
} from "#obsidian/pdf-reader/service.ts";

let native: MockInstance<WorkspaceLeaf["setViewState"]>;

beforeEach(() => {
  setMockPlatform({ isMacOS: false });
  native = vi.spyOn(WorkspaceLeaf.prototype, "setViewState");
});
afterEach(() => {
  resetMockPlatform();
  vi.restoreAllMocks();
});

const ANCHORED = { subpath: "#page=1&zt-annotation=PUPR5FG5" };

function fakeSource() {
  let handlers: ConnectHandlers | null = null;
  const source = vi.fn((next: ConnectHandlers) => {
    handlers = next;
    return () => {
      handlers = null;
    };
  });
  return {
    source,
    get handlers() {
      return handlers;
    },
  };
}

function fakeApi(viewType = "zotlit-pdf") {
  const closeListeners = new Set<() => void>();
  const removals: ReturnType<typeof vi.fn>[] = [];
  const addExtension = vi.fn<ReaderApi["addExtension"]>(() => {
    const remove = vi.fn();
    removals.push(remove);
    return remove;
  });
  const open = vi.fn<ReaderApi["open"]>(async () => "opened");
  const api: ReaderApi = {
    api: READER_API,
    readerVersion: "1.0.0",
    pdfjsBuild: "test",
    viewType,
    addExtension,
    open,
    readerOf: () => null,
    loadDocument: () => Promise.reject(new Error("no document in this test")),
    onClose: (listener) => {
      closeListeners.add(listener);
      return () => {
        closeListeners.delete(listener);
      };
    },
  };
  return {
    api,
    addExtension,
    open,
    removals,
    close: () => {
      for (const listener of closeListeners) listener();
    },
  };
}

const buildWith = (source: ReturnType<typeof fakeSource>["source"]) =>
  Effect.gen(function* () {
    const scope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
      Scope.close(scope, Exit.void),
    );
    const app = stubService<App>("App", {
      vault: stubService<Vault>("Vault", { adapter: new FileSystemAdapter() }),
    });
    const context = yield* Layer.build(
      editorFixtureLayer({
        app,
        workspace: new MemoryWorkspace(),
        attachments: attachmentReads({
          kind: "resolved",
          attachmentKey: "RGRPDF24",
          itemKey: "ROUG2014",
          serverID: null,
          openable: true,
        }),
        annotations: annotationReads(),
        capabilityGestures: capabilityGestures(),
        markGestures: markGestures(),
        noteIndex: { getNotesByItemKey: () => Effect.succeed([]) },
        settings: readerSettings(),
        reader: layerReaderConnection(source),
      }),
    ).pipe(Effect.provideService(Scope.Scope, scope));
    return {
      scope,
      connection: Context.get(context, ReaderConnection),
      editor: Context.get(context, PdfAnnotationEditor),
    };
  });

const openAnchored = Effect.fnUntraced(function* () {
  yield* Effect.promise(() =>
    new WorkspaceLeaf().setViewState({ type: "pdf" }, ANCHORED),
  );
  return native.mock.calls.at(-1)?.[0].type;
});

const settle = Effect.yieldNow;

it.effect("is absent when the source answers absent", () =>
  Effect.gen(function* () {
    const reader = fakeSource();
    const { connection } = yield* buildWith(reader.source);
    reader.handlers!.onAbsent();
    yield* settle;
    expect(yield* connection.current).toEqual({ status: "absent" });
    expect(yield* openAnchored()).toBe("pdf");
  }),
);

it.effect("is incompatible with the reason the source gives", () =>
  Effect.gen(function* () {
    const reader = fakeSource();
    const { connection } = yield* buildWith(reader.source);
    reader.handlers!.onRefuse({ supported: [2], readerVersion: "2.0.0" });
    expect(yield* connection.current).toEqual({
      status: "incompatible",
      reason: { supported: [2], readerVersion: "2.0.0" },
    });
  }),
);

it.effect(
  "connects after accept: adds the editor extension and sends anchored PDF opens to the api's view type",
  () =>
    Effect.gen(function* () {
      const reader = fakeSource();
      const { connection } = yield* buildWith(reader.source);
      const { api, addExtension } = fakeApi("reader-view");
      reader.handlers!.onAccept(api);
      yield* settle;
      expect(yield* connection.current).toEqual({ status: "connected", api });
      expect(addExtension).toHaveBeenCalledOnce();
      expect(addExtension.mock.calls[0]![0].id).toBe(
        "zotlit-annotation-editor",
      );
      expect(yield* openAnchored()).toBe("reader-view");
    }),
);

it.effect(
  "goes absent on the api's close: removes the Anchor patch and retires the extension handle",
  () =>
    Effect.gen(function* () {
      const reader = fakeSource();
      const { connection } = yield* buildWith(reader.source);
      const first = fakeApi();
      reader.handlers!.onAccept(first.api);
      yield* settle;
      first.close();
      yield* settle;
      expect(yield* connection.current).toEqual({ status: "absent" });
      expect(first.removals).toHaveLength(1);
      expect(first.removals[0]).toHaveBeenCalledOnce();
      expect(yield* openAnchored()).toBe("pdf");
    }),
);

it.effect("connects again on a second accept", () =>
  Effect.gen(function* () {
    const reader = fakeSource();
    const { connection } = yield* buildWith(reader.source);
    const first = fakeApi();
    reader.handlers!.onAccept(first.api);
    yield* settle;
    first.close();
    yield* settle;
    const second = fakeApi();
    reader.handlers!.onAccept(second.api);
    yield* settle;
    expect(yield* connection.current).toEqual({
      status: "connected",
      api: second.api,
    });
    expect(second.addExtension).toHaveBeenCalledOnce();
    expect(yield* openAnchored()).toBe("zotlit-pdf");
  }),
);

it.effect(
  "unsubscribes the source and retires the extension when its layer closes",
  () =>
    Effect.gen(function* () {
      const reader = fakeSource();
      const { scope } = yield* buildWith(reader.source);
      const first = fakeApi();
      reader.handlers!.onAccept(first.api);
      yield* settle;
      yield* Scope.close(scope, Exit.void);
      expect(reader.handlers).toBeNull();
      expect(first.removals[0]).toHaveBeenCalledOnce();
      expect(yield* openAnchored()).toBe("pdf");
    }),
);

it.effect(
  "binds a reader that already holds a document when the extension attaches late",
  () =>
    Effect.gen(function* () {
      const reader = fakeSource();
      const { editor } = yield* buildWith(reader.source);
      const { api, addExtension } = fakeApi();
      reader.handlers!.onAccept(api);
      yield* settle;
      const extension = addExtension.mock.calls[0]![0];
      const open = pdfReader();
      open.openDocument();
      const file = stubService<TFile>("TFile", {
        path: "attachments/rougier-2014.pdf",
      });
      const view = stubService<View>("View", {
        leaf: undefined,
        app: stubService<App>("App", {}),
        containerEl: document.createElement("div"),
        scope: new ObsidianScope(),
      });
      const attached = extension.attach?.({
        reader: open.reader as PdfReader,
        host: stubService<ReaderHostContext>("ReaderHostContext", {
          view,
          file,
          restored: true,
          unloading: () => false,
        }),
        subpath: null,
      });
      const binding = (yield* editor.bindings)[0]!;
      yield* Effect.promise(() => binding.refreshed);
      expect(open.toolbarEl.childElementCount).toBe(1);
      attached?.[Symbol.dispose]();
    }),
);

it("takes the Reader through the contract's types alone", () => {
  expectTypeOf<Parameters<ReaderSource>[0]>().toEqualTypeOf<ConnectHandlers>();
  expectTypeOf(readerHandshake).returns.toEqualTypeOf<ReaderSource>();
  expectTypeOf<
    Extract<ReaderConnectionState, { status: "connected" }>["api"]
  >().toEqualTypeOf<ReaderApi>();
});

class OpeningWorkspace extends MemoryWorkspace {
  readonly openFile = vi.fn<WorkspaceLeaf["openFile"]>(async () => {});

  override getLeaf(newLeaf?: PaneType | boolean): WorkspaceLeaf {
    super.getLeaf(newLeaf);
    return stubService<WorkspaceLeaf>("WorkspaceLeaf", {
      openFile: this.openFile,
    });
  }
}

const handshakeReader = (prepare: (events: Events) => void = () => {}) =>
  Effect.gen(function* () {
    const events = new Events();
    prepare(events);
    const workspace = new OpeningWorkspace();
    const context = yield* Layer.build(
      layerZotlitPdfReader.pipe(
        Layer.provideMerge(
          layerReaderConnection(
            readerHandshake({ workspace: events }, "zotlit"),
          ),
        ),
        Layer.provideMerge(layerWorkspaceFrom(workspace)),
      ),
    );
    return {
      events,
      workspace,
      connection: Context.get(context, ReaderConnection),
      reader: Context.get(context, ZotlitPdfReader),
    };
  });

const paper = () => stubService<TFile>("TFile", { path: "paper.pdf" });

it.effect(
  "connects through the handshake when the Reader started first, and opens through its api",
  () =>
    Effect.gen(function* () {
      const { api, open } = fakeApi();
      const { workspace, connection, reader } = yield* handshakeReader(
        (events) => answerConnect(events, new Map([[READER_API.major, api]])),
      );
      expect(yield* connection.current).toEqual({ status: "connected", api });
      const file = paper();
      expect(yield* reader.open(file, "#page=2", "tab")).toBe("opened");
      expect(open).toHaveBeenCalledExactlyOnceWith(file, {
        subpath: "#page=2",
        pane: "tab",
      });
      expect(workspace.openFile).not.toHaveBeenCalled();
    }),
);

it.effect(
  "opens in Obsidian's PDF view until the Reader starts, then connects on its ready",
  () =>
    Effect.gen(function* () {
      const { events, workspace, connection, reader } =
        yield* handshakeReader();
      expect(yield* connection.current).toEqual({ status: "absent" });
      const file = paper();
      expect(yield* reader.open(file, "#page=2", "tab")).toBe("opened");
      expect(workspace.leafRequests).toEqual(["tab"]);
      expect(workspace.openFile).toHaveBeenCalledExactlyOnceWith(file, {
        eState: { subpath: "#page=2" },
      });
      const { api, open } = fakeApi();
      answerConnect(events, new Map([[READER_API.major, api]]));
      expect(yield* connection.current).toEqual({ status: "connected", api });
      expect(yield* reader.open(file, "", false)).toBe("opened");
      expect(open).toHaveBeenCalledOnce();
      expect(workspace.openFile).toHaveBeenCalledOnce();
    }),
);

it.effect(
  "is incompatible when the Reader refuses ZotLit's major, and opens in Obsidian's PDF view",
  () =>
    Effect.gen(function* () {
      const { events, workspace, connection, reader } =
        yield* handshakeReader();
      const { api } = fakeApi();
      answerConnect(events, new Map([[READER_API.major + 1, api]]));
      expect(yield* connection.current).toEqual({
        status: "incompatible",
        reason: {
          supported: [READER_API.major + 1],
          readerVersion: "1.0.0",
        },
      });
      const file = paper();
      expect(yield* reader.open(file, "", true)).toBe("opened");
      expect(workspace.openFile).toHaveBeenCalledExactlyOnceWith(
        file,
        undefined,
      );
    }),
);
