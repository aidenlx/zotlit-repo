// @vitest-environment happy-dom
import { it } from "@effect/vitest";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import type { App, PaneType, PluginManifest, TFile, View } from "obsidian";
import { Events, Scope as ObsidianScope, WorkspaceLeaf } from "obsidian";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, expect, expectTypeOf, vi } from "vitest";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { MemoryDeviceStorage } from "@zotlit/obsidian-kit/__fixtures__/obsidian-device-storage.ts";
import { MemoryWorkspace } from "@zotlit/obsidian-kit/__fixtures__/obsidian-workspace.ts";
import {
  resetMockPlatform,
  setMockPlatform,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { noticeText } from "@zotlit/obsidian-kit/notice.ts";
import type { NoticeMessage } from "@zotlit/obsidian-kit/notice.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { layerDeviceStorageFrom } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import { Vault as VaultService } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { layerWorkspaceFrom } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { AttachmentResolver } from "@zotlit/plugin-services/obsidian/attachment-resolver/service.ts";
import type {
  ConnectHandlers,
  PdfReader,
  ReaderApi,
  ReaderHostContext,
} from "@zotlit/reader-api";
import { answerConnect, READER_API } from "@zotlit/reader-api";

import { readerHandshake } from "./handshake.ts";
import { FALLBACK_NOTICE_KEY } from "./notice.ts";
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
    const app = stubService<App>("App", {});
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

it.effect("connects after accept: adds the editor extension", () =>
  Effect.gen(function* () {
    const reader = fakeSource();
    const { connection } = yield* buildWith(reader.source);
    const { api, addExtension } = fakeApi("reader-view");
    reader.handlers!.onAccept(api);
    yield* settle;
    expect(yield* connection.current).toEqual({ status: "connected", api });
    expect(addExtension).toHaveBeenCalledOnce();
    expect(addExtension.mock.calls[0]![0].id).toBe("zotlit-annotation-editor");
  }),
);

it.effect("goes absent on the api's close: retires the extension handle", () =>
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
  readonly setViewState = vi.fn<WorkspaceLeaf["setViewState"]>(async () => {});

  override getLeaf(newLeaf?: PaneType | boolean): WorkspaceLeaf {
    super.getLeaf(newLeaf);
    return stubService<WorkspaceLeaf>("WorkspaceLeaf", {
      setViewState: this.setViewState,
    });
  }
}

const handshakeReader = (
  prepare: (events: Events) => void = () => {},
  {
    installed = false,
    storage = new MemoryDeviceStorage(),
  }: { installed?: boolean; storage?: MemoryDeviceStorage } = {},
) =>
  Effect.gen(function* () {
    const events = new Events();
    prepare(events);
    const workspace = new OpeningWorkspace();
    const notifier = testNotifier();
    const manifests: Record<string, PluginManifest> = installed
      ? { "zotlit-reader": stubService<PluginManifest>("PluginManifest", {}) }
      : {};
    const context = yield* Layer.build(
      layerZotlitPdfReader.pipe(
        Layer.provideMerge(
          layerReaderConnection(
            readerHandshake({ workspace: events }, "zotlit"),
          ),
        ),
        Layer.provideMerge(layerWorkspaceFrom(workspace)),
        Layer.provideMerge(layerDeviceStorageFrom(storage)),
        Layer.provideMerge(
          Layer.mock(AttachmentResolver, {
            warm: Effect.void,
            resolveFile: () => Effect.succeed({ kind: "unresolved" }),
          }),
        ),
        Layer.provideMerge(
          Layer.mock(VaultService, {
            getFileByPath: () => Effect.succeed(null),
          }),
        ),
        Layer.provideMerge(notifier.layer),
        Layer.provideMerge(
          Layer.succeed(
            ObsidianApp,
            stubService<App>("App", {
              plugins: stubService<App["plugins"]>("App.plugins", {
                plugins: {},
                manifests,
              }),
            }),
          ),
        ),
      ),
    );
    return {
      events,
      workspace,
      storage,
      notices: notifier.notices,
      connection: Context.get(context, ReaderConnection),
      reader: Context.get(context, ZotlitPdfReader),
    };
  });

const paper = () => stubService<TFile>("TFile", { path: "paper.pdf" });
const obsidianView = (file: TFile) => ({
  type: "pdf",
  state: { file: file.path },
  active: false,
});

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
      expect(workspace.setViewState).not.toHaveBeenCalled();
    }),
);

it.effect(
  "routes Obsidian's anchored PDF opens to the reader's view type only while connected",
  () =>
    Effect.gen(function* () {
      const { events } = yield* handshakeReader();
      expect(yield* openAnchored()).toBe("pdf");
      const reader = fakeApi("reader-view");
      answerConnect(events, new Map([[READER_API.major, reader.api]]));
      yield* settle;
      expect(yield* openAnchored()).toBe("reader-view");
      reader.close();
      yield* settle;
      expect(yield* openAnchored()).toBe("pdf");
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
      expect(workspace.setViewState).toHaveBeenCalledExactlyOnceWith(
        obsidianView(file),
        { subpath: "#page=2" },
      );
      const { api, open } = fakeApi();
      answerConnect(events, new Map([[READER_API.major, api]]));
      expect(yield* connection.current).toEqual({ status: "connected", api });
      expect(yield* reader.open(file, "", false)).toBe("opened");
      expect(open).toHaveBeenCalledOnce();
      expect(workspace.setViewState).toHaveBeenCalledOnce();
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
      expect(workspace.setViewState).toHaveBeenCalledExactlyOnceWith(
        obsidianView(file),
        undefined,
      );
    }),
);

const noticeTexts = (notices: readonly { messages: NoticeMessage[] }[]) =>
  notices.map(({ messages }) => noticeText(messages[0]!));

it.effect(
  "tells the researcher once per vault how to get the annotation tools when a PDF opens in Obsidian's PDF view",
  () =>
    Effect.gen(function* () {
      const storage = new MemoryDeviceStorage();
      const first = yield* handshakeReader(undefined, { storage });
      yield* first.reader.open(paper(), "#page=2", "tab");
      yield* first.reader.open(paper(), "#page=3", "tab");
      expect(noticeTexts(first.notices)).toEqual([
        `${m.notice_reader_fallback()}\n${m.settings_reader_status_install()}`,
      ]);
      const later = yield* handshakeReader(undefined, {
        storage,
        installed: true,
      });
      yield* later.reader.open(paper(), "", "tab");
      yield* later.reader.open(paper(), "", "tab");
      expect(noticeTexts(later.notices)).toEqual([
        `${m.notice_reader_fallback()}\n${m.settings_reader_status_turn_on()}`,
      ]);
      const again = yield* handshakeReader(undefined, {
        storage,
        installed: true,
      });
      yield* again.reader.open(paper(), "", "tab");
      expect(again.notices).toEqual([]);
      expect(storage.loadLocalStorage(FALLBACK_NOTICE_KEY)).toEqual([
        "install",
        "turn-on",
      ]);
    }),
);

it.effect(
  "names the plugin to update in the notice when the Reader refuses ZotLit's major",
  () =>
    Effect.gen(function* () {
      const { api } = fakeApi();
      const { reader, notices } = yield* handshakeReader(
        (events) =>
          answerConnect(events, new Map([[READER_API.major + 1, api]])),
        { installed: true },
      );
      yield* reader.open(paper(), "", "tab");
      expect(noticeTexts(notices)).toEqual([
        `${m.notice_reader_fallback()}\n${m.settings_reader_status_update({
          plugin: "ZotLit",
        })}`,
      ]);
    }),
);

it.effect("shows no notice when the PDF opens in ZotLit Reader", () =>
  Effect.gen(function* () {
    const { api } = fakeApi();
    const { reader, notices } = yield* handshakeReader(
      (events) => answerConnect(events, new Map([[READER_API.major, api]])),
      { installed: true },
    );
    yield* reader.open(paper(), "", "tab");
    expect(notices).toEqual([]);
  }),
);
