import { it } from "@effect/vitest";
import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  PubSub,
  Scope,
  Stream,
} from "effect";
import type { App, ObsidianProtocolData, TFile } from "obsidian";
import { beforeEach, describe, expect, it as vitestIt, vi } from "vitest";

import { toObsidianOpenableAttachments } from "@zotlit/annotations/core/attachment-open/resolve.ts";
import type { ObsidianOpenableAttachment } from "@zotlit/annotations/core/attachment-open/resolve.ts";
import { attachmentLink } from "@zotlit/annotations/desktop/attachment-open/link.ts";
import type { AttachmentLinkPorts } from "@zotlit/annotations/desktop/attachment-open/link.ts";
import { openAttachments } from "@zotlit/annotations/desktop/attachment-open/open-attachments.ts";
import { TargetOpener } from "@zotlit/annotations/desktop/attachment-open/open-target.ts";
import type { Attachment, getItemDisplayRefByID, Library } from "@zotlit/db";
import { showInLibraryLink } from "@zotlit/library-view/obsidian/library/show-in-library-link.ts";
import { openCompanionNote } from "@zotlit/notes/desktop/note-feature/index.ts";
import { NoteFeature } from "@zotlit/notes/desktop/note-feature/service.ts";
import {
  runBatchUpdate,
  runBatchUpdateAll,
} from "@zotlit/notes/desktop/note-feature/update-batch.ts";
import type { BatchUpdateResult } from "@zotlit/notes/desktop/note-feature/update-batch.ts";
import { NoteImporter } from "@zotlit/notes/desktop/note-import/service.ts";
import type { NoteImportView } from "@zotlit/notes/desktop/note-import/view.ts";
import {
  noteLinks,
  registerNoteLinkRequests,
} from "@zotlit/notes/desktop/protocol/handlers.ts";
import type { NoteLinkPorts } from "@zotlit/notes/desktop/protocol/handlers.ts";
import { NoteLinkOutcome } from "@zotlit/notes/desktop/protocol/outcome.ts";
import { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import { Template } from "@zotlit/notes/obsidian/template/service.ts";
import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { layerTestObsidianEnv } from "@zotlit/obsidian-kit/__fixtures__/obsidian-env.ts";
import { layerTestVaultDisk } from "@zotlit/obsidian-kit/__fixtures__/obsidian-vault-disk.ts";
import { MemoryWorkspace } from "@zotlit/obsidian-kit/__fixtures__/obsidian-workspace.ts";
import { testPluginHost } from "@zotlit/obsidian-kit/__fixtures__/plugin-host.ts";
import { FileManager } from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { layerWorkspaceFrom } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { ShowInLibrary } from "@zotlit/obsidian-kit/show-in-library.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import type {
  ImportNotesRequest,
  UpdateManyRequest,
} from "@zotlit/plugin-services/core/local-server/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { LibrarySource } from "@zotlit/plugin-services/obsidian/library-source/service.ts";
import type { LibrarySourceKind } from "@zotlit/plugin-services/obsidian/library-source/service.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { LinkOutcome } from "@zotlit/plugin-services/obsidian/protocol/outcome.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import { layerProtocolHandlers } from "@zotlit/plugin-shell/obsidian/protocol.ts";
import { openTemplateDataExplorer } from "@zotlit/template-workbench/desktop/data-explorer/register.ts";
import { workbenchLinks } from "@zotlit/template-workbench/desktop/protocol/handlers.ts";
import { openTemplateWorkbench } from "@zotlit/template-workbench/desktop/view/open.ts";
import { readsAnswering } from "@zotlit/zotero-reads/__fixtures__/reads.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type {
  ZoteroReadsApi,
  ZoteroReadsState,
} from "@zotlit/zotero-reads/client/service.ts";

import { features } from "./features.ts";

type LinkDeps = NoteLinkPorts & AttachmentLinkPorts;

vi.mock(
  "@zotlit/notes/desktop/note-feature/update-batch.ts",
  async (importOriginal) => {
    const { Effect } = await import("effect");
    return {
      ...(await importOriginal<
        typeof import("@zotlit/notes/desktop/note-feature/update-batch.ts")
      >()),
      runBatchUpdate: vi.fn(() => Effect.succeed({ outcome: "batch-modal" })),
      runBatchUpdateAll: vi.fn(() =>
        Effect.succeed({ outcome: "batch-modal" }),
      ),
    };
  },
);

vi.mock(
  "@zotlit/notes/desktop/note-feature/index.ts",
  async (importOriginal) => {
    const { Effect } = await import("effect");
    return {
      ...(await importOriginal<
        typeof import("@zotlit/notes/desktop/note-feature/index.ts")
      >()),
      openCompanionNote: vi.fn(() => Effect.void),
    };
  },
);

vi.mock(
  "@zotlit/annotations/desktop/attachment-open/open-attachments.ts",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@zotlit/annotations/desktop/attachment-open/open-attachments.ts")
    >()),
    openAttachments: vi.fn(),
  }),
);

vi.mock(
  "@zotlit/annotations/core/attachment-open/resolve.ts",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@zotlit/annotations/core/attachment-open/resolve.ts")
    >()),
    toObsidianOpenableAttachments: vi.fn(),
  }),
);

vi.mock(
  "@zotlit/template-workbench/desktop/view/open.ts",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@zotlit/template-workbench/desktop/view/open.ts")
    >()),
    openTemplateWorkbench: vi.fn(() => Effect.void),
  }),
);

vi.mock(
  "@zotlit/template-workbench/desktop/data-explorer/register.ts",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@zotlit/template-workbench/desktop/data-explorer/register.ts")
    >()),
    openTemplateDataExplorer: vi.fn(async () => {}),
  }),
);

const SOURCE_ID = "abc12345";

type ItemDisplayRef = NonNullable<ReturnType<typeof getItemDisplayRefByID>>;
type DisplayRefSlice = { itemID: number; ref: ItemDisplayRef | null }[];

const reads = {
  DisplayRefs: vi.fn((_input: Parameters<ZoteroReadsApi["DisplayRefs"]>[0]) =>
    Stream.make<DisplayRefSlice[]>([]),
  ),
  AttachmentsAt: vi.fn(
    (_input: Parameters<ZoteroReadsApi["AttachmentsAt"]>[0]) =>
      Effect.succeed<readonly Attachment[]>([]),
  ),
  Libraries: vi.fn((_input: Parameters<ZoteroReadsApi["Libraries"]>[0]) =>
    Effect.succeed<Library[]>([
      {
        libraryID: 1,
        version: 0,
        clientVersion: null,
        type: "user",
        groupID: null,
        name: null,
      },
      {
        libraryID: 12,
        version: 0,
        clientVersion: null,
        type: "group",
        groupID: 7,
        name: "Reading group",
      },
    ]),
  ),
  ScopeItemIDs: vi.fn((_input: Parameters<ZoteroReadsApi["ScopeItemIDs"]>[0]) =>
    Effect.succeed<number[] | null>([5, 6]),
  ),
};
const readsApi = readsAnswering({
  DisplayRefs: (input) => reads.DisplayRefs(input),
  AttachmentsAt: (input) => reads.AttachmentsAt(input),
  Libraries: (input) => reads.Libraries(input),
  ScopeItemIDs: (input) => reads.ScopeItemIDs(input),
});

function refOf(ref: ItemDisplayRef): void {
  reads.DisplayRefs.mockReturnValue(
    Stream.make<DisplayRefSlice[]>([{ itemID: ref.itemID, ref }]),
  );
}

function attachmentsAt(attachments: readonly Attachment[]): void {
  reads.AttachmentsAt.mockReturnValue(Effect.succeed(attachments));
}

function attachmentOf(itemID: number): Attachment {
  return stubService<Attachment>("Attachment", { itemID });
}

function openableAttachment(indexedKey: string): ObsidianOpenableAttachment {
  return {
    indexedKey,
    label: `${indexedKey}.pdf`,
    openPath: `attachments/${indexedKey}.pdf`,
    absolutePath: `/vault/attachments/${indexedKey}.pdf`,
  };
}

const REF: ItemDisplayRef = {
  itemID: 1,
  libraryID: 1,
  key: "ABCD2345",
  groupID: null,
  indexedKey: "ABCD2345",
  title: "Alpha",
};
const { title: _title, ...ITEM_REF } = REF;

const openBatchModal = vi.fn<NoteImportView["openBatchModal"]>();
const noteImportView = stubService<NoteImportView>("NoteImportView", {
  openBatchModal: (options) => openBatchModal(options),
});

const handlers = new Map<string, (data: ObsidianProtocolData) => unknown>();

function protocolData(
  action: string,
  query: Record<string, string> = {},
): ObsidianProtocolData {
  return { action, ...query };
}

function appStub(members: Partial<App> = {}): App {
  const app = stubService<App>("App", members);
  Object.defineProperty(app, "$$typeof", { value: undefined });
  Object.defineProperty(app, "nodeType", { value: undefined });
  Object.defineProperty(app, "tagName", { value: undefined });
  Object.defineProperty(app, "nodeName", { value: undefined });
  return app;
}

interface Setup {
  readonly deps?: Partial<LinkDeps>;
  readonly opener?: Pick<TargetOpener["Service"], "open">;
  readonly state?: ZoteroReadsState["state"];
  readonly updateManyRequests?: Stream.Stream<UpdateManyRequest>;
  readonly importNotesRequests?: Stream.Stream<ImportNotesRequest>;
  readonly files?: ReadonlyMap<string, TFile>;
  readonly workspace?: MemoryWorkspace;
  readonly getFileByPath?: (path: string) => Effect.Effect<TFile | null>;
  readonly whenIndexed?: Effect.Effect<void>;
  readonly source?: LibrarySourceKind;
}

const shownInLibrary: string[] = [];

function servicesFor(setup: Setup = {}) {
  return Layer.mergeAll(
    setup.source
      ? Layer.succeed(
          LibrarySource,
          stubService<LibrarySource["Service"]>("LibrarySource", {
            active: setup.source,
          }),
        )
      : Layer.empty,
    Layer.mock(Template, {}),
    Layer.mock(FileManager, {}),
    Layer.succeed(
      FileSystem.FileSystem,
      stubService<FileSystem.FileSystem>("FileSystem", {}),
    ),
    Layer.mock(ZoteroPref, {
      current: Effect.succeed(
        stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
          sourceId: SOURCE_ID,
          acceptedSourceIds: [SOURCE_ID],
          dataDir: "/data",
          baseAttachmentPath: null,
        }),
      ),
    }),
    Layer.mock(ZoteroReads, {
      current: Effect.succeed(
        stubService<ZoteroReadsState>("ZoteroReadsState", {
          state: setup.state ?? "ready",
        }),
      ),
      changes: Stream.make(
        stubService<ZoteroReadsState>("ZoteroReadsState", {
          state: setup.state ?? "ready",
        }),
      ),
      reads: readsApi,
      snapshot: Effect.succeed(readsApi),
    }),
    Layer.mock(LocalServer, {
      updateManyRequests: setup.updateManyRequests ?? Stream.empty,
      importNotesRequests: setup.importNotesRequests ?? Stream.empty,
    }),
    Layer.mock(UseLedger, {}),
    Layer.mock(ShowInLibrary, {
      show: (indexedKey) =>
        Effect.sync(() => {
          shownInLibrary.push(indexedKey);
        }),
    }),
    Layer.mock(NoteIndex, { whenIndexed: setup.whenIndexed ?? Effect.void }),
    Layer.mock(LibraryScope, {}),
    Layer.mock(MetadataCache, {}),
    Layer.mock(NoteFeature, {}),
    Layer.mock(NoteImporter, {}),
    Layer.mock(PluginSettings, {}),
    Layer.mock(Profile, {}),
    Layer.mock(TargetOpener, setup.opener ?? {}),
    Layer.mock(Vault, {
      getFileByPath:
        setup.getFileByPath ??
        ((path: string) => Effect.succeed(setup.files?.get(path) ?? null)),
    }),
    testNotifier().layer,
    layerWorkspaceFrom(setup.workspace ?? new MemoryWorkspace()),
    layerTestObsidianEnv({ os: "win32" }),
    layerTestVaultDisk({ basePath: "/vault" }),
  );
}

function linksOf(deps: LinkDeps) {
  const ports = Effect.succeed(deps);
  return [
    attachmentLink(ports),
    ...noteLinks(ports),
    ...workbenchLinks(),
    showInLibraryLink,
  ];
}

function depsOf(setup: Setup): LinkDeps {
  return stubService<LinkDeps>("LinkDeps", {
    noteImportView,
    bridge: stubService<LinkDeps["bridge"]>("EffectBridge", {}),
    app: appStub(),
    ...setup.deps,
  });
}

const recordingHost = () =>
  testPluginHost({
    registerObsidianProtocolHandler: (action, handler) => {
      handlers.set(action, handler);
    },
  });

const register = Effect.fn("register")(function* (setup: Setup = {}) {
  const deps = depsOf(setup);
  const context = yield* Layer.build(
    Layer.merge(servicesFor(setup), recordingHost().layer),
  );
  yield* Layer.build(layerProtocolHandlers(linksOf(deps))).pipe(
    Effect.provide(context),
  );
  return yield* registerNoteLinkRequests(Effect.succeed(deps)).pipe(
    Effect.provide(context),
  );
});

const dispatch = Effect.fn("dispatch")(function* (
  action: string,
  query: Record<string, string> = {},
) {
  const handler = handlers.get(action);
  if (!handler) return yield* Effect.die(`no handler for ${action}`);
  const fiber = handler(
    protocolData(action, { "source-id": SOURCE_ID, ...query }),
  );
  if (!Fiber.isFiber(fiber)) return yield* Effect.die("no handler fiber");
  return yield* Fiber.join(fiber);
});

beforeEach(() => {
  handlers.clear();
  shownInLibrary.length = 0;
  vi.mocked(runBatchUpdate).mockClear();
  vi.mocked(runBatchUpdateAll).mockClear();
  openBatchModal.mockReset();
  reads.Libraries.mockClear();
  reads.ScopeItemIDs.mockClear();
  reads.DisplayRefs.mockReset();
  reads.AttachmentsAt.mockReset();
  vi.mocked(openCompanionNote).mockClear();
  vi.mocked(openTemplateWorkbench).mockClear();
  vi.mocked(openTemplateDataExplorer).mockClear();
  vi.mocked(toObsidianOpenableAttachments).mockReset();
  vi.mocked(openAttachments).mockReset();
});

describe("single-note protocol links", () => {
  it.effect.each(["open", "update"] as const)(
    "routes %s through the shared Companion flow with its URL Profile",
    (action) =>
      Effect.gen(function* () {
        refOf(REF);
        yield* register();
        yield* dispatch(`zotlit/${action}`, {
          item: "1",
          profile: "Bk3Qn7XvT2Lp",
        });
        expect(openCompanionNote).toHaveBeenCalledExactlyOnceWith(
          expect.anything(),
          ITEM_REF,
          { action, profile: "Bk3Qn7XvT2Lp", scope: "full" },
        );
      }),
  );
});

describe("paneType", () => {
  it.effect("routes an explore link's paneType to the explorer", () =>
    Effect.gen(function* () {
      refOf(REF);
      yield* register();
      yield* dispatch("zotlit/explore", { item: "1", paneType: "window" });
      expect(openTemplateDataExplorer).toHaveBeenCalledExactlyOnceWith(
        { itemIndexedKey: "ABCD2345", anchorAnnotationKey: undefined },
        { paneType: "window" },
      );
    }),
  );

  it.effect("routes the link's paneType to the Companion flow", () =>
    Effect.gen(function* () {
      refOf(REF);
      yield* register();
      yield* dispatch("zotlit/open", { item: "1", paneType: "split" });
      expect(openCompanionNote).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        ITEM_REF,
        { action: "open", scope: "full", paneType: "split" },
      );
    }),
  );
});

describe("show-in-library protocol link", () => {
  it.effect("shows the Item its Indexed Key names in the Library View", () =>
    Effect.gen(function* () {
      yield* register();
      const outcome = yield* dispatch("zotlit/show-in-library", {
        "item-key": "ABCD2345g7",
      });
      expect(shownInLibrary).toEqual(["ABCD2345g7"]);
      expect(outcome).toEqual(LinkOutcome.Opened());
    }),
  );

  it.effect("refuses a link whose key is not an Indexed Key", () =>
    Effect.gen(function* () {
      yield* register();
      const outcome = yield* dispatch("zotlit/show-in-library", {
        "item-key": "not a key",
      });
      expect(shownInLibrary).toEqual([]);
      expect(outcome).toEqual(LinkOutcome.InvalidLink());
    }),
  );
});

describe("open-attachment protocol link", () => {
  const app = appStub();
  const opener = {
    open: vi.fn(() => Effect.succeed({ kind: "reader" as const })),
  };
  beforeEach(() => opener.open.mockClear());

  const registerOpener = (state?: ZoteroReadsState["state"]) =>
    register({
      deps: {
        app,
        bridge: stubService<LinkDeps["bridge"]>("EffectBridge", {
          runAndForget: () => {},
        }),
      },
      opener,
      state,
    });

  it.effect("treats the id as the Attachment itself when it names one", () =>
    Effect.gen(function* () {
      const attachment = attachmentOf(9);
      attachmentsAt([attachment]);
      vi.mocked(toObsidianOpenableAttachments).mockReturnValue([
        openableAttachment("ATCH1"),
      ]);
      yield* registerOpener();

      yield* dispatch("zotlit/open-attachment", { item: "9" });

      expect(toObsidianOpenableAttachments).toHaveBeenCalledExactlyOnceWith(
        [attachment],
        {
          pathContext: { dataDir: "/data", baseAttachmentPath: null },
          vaultBasePath: "/vault",
          platform: "win32",
        },
      );
      expect(reads.AttachmentsAt).toHaveBeenCalledExactlyOnceWith({
        itemID: 9,
      });
    }),
  );

  it.effect(
    "falls back to the item's own Attachments when the id names a regular item",
    () =>
      Effect.gen(function* () {
        const attachment = attachmentOf(2);
        attachmentsAt([attachment]);
        vi.mocked(toObsidianOpenableAttachments).mockReturnValue([
          openableAttachment("ATCH2"),
        ]);
        yield* registerOpener();

        yield* dispatch("zotlit/open-attachment", { item: "42" });

        expect(toObsidianOpenableAttachments).toHaveBeenCalledWith(
          [attachment],
          expect.anything(),
        );
        expect(reads.AttachmentsAt).toHaveBeenCalledExactlyOnceWith({
          itemID: 42,
        });
      }),
  );

  it.effect(
    "hands an empty list to openAttachments when nothing resolves to an Obsidian-Openable Attachment, deferring the notice to the reader",
    () =>
      Effect.gen(function* () {
        attachmentsAt([]);
        vi.mocked(toObsidianOpenableAttachments).mockReturnValue([]);
        yield* registerOpener();

        yield* dispatch("zotlit/open-attachment", { item: "42" });

        expect(openAttachments).toHaveBeenCalledExactlyOnceWith([], {
          reader: expect.anything(),
          app,
        });
      }),
  );

  it.effect("resolves no Attachments while the database is not ready", () =>
    Effect.gen(function* () {
      yield* registerOpener("degraded");

      expect(yield* dispatch("zotlit/open-attachment", { item: "9" })).toEqual(
        LinkOutcome.DatabaseUnavailable(),
      );

      expect(reads.AttachmentsAt).not.toHaveBeenCalled();
      expect(openAttachments).not.toHaveBeenCalled();
    }),
  );

  it.effect("offers no event, so the picker is always the Suggest modal", () =>
    Effect.gen(function* () {
      attachmentsAt([attachmentOf(9)]);
      const opened = openableAttachment("ATCH1");
      vi.mocked(toObsidianOpenableAttachments).mockReturnValue([opened]);
      yield* registerOpener();

      yield* dispatch("zotlit/open-attachment", { item: "9" });

      expect(openAttachments).toHaveBeenCalledExactlyOnceWith([opened], {
        reader: expect.anything(),
        app,
      });
    }),
  );

  it.effect(
    "opens a picked row in the pane the pick asked for when the link names none",
    () =>
      Effect.gen(function* () {
        attachmentsAt([attachmentOf(9)]);
        const opened = openableAttachment("ATCH1");
        vi.mocked(toObsidianOpenableAttachments).mockReturnValue([opened]);
        yield* registerOpener();

        yield* dispatch("zotlit/open-attachment", { item: "9" });

        expect(openAttachments).toHaveBeenCalledOnce();
        const { reader } = vi.mocked(openAttachments).mock.calls[0]![1];
        reader.open(opened, "tab");
        expect(opener.open).toHaveBeenCalledExactlyOnceWith(
          { kind: "attachment", attachmentKey: "ATCH1" },
          "tab",
        );
      }),
  );

  it.effect(
    "honors the link's paneType even for a single Attachment that would open directly",
    () =>
      Effect.gen(function* () {
        attachmentsAt([attachmentOf(9)]);
        const opened = openableAttachment("ATCH1");
        vi.mocked(toObsidianOpenableAttachments).mockReturnValue([opened]);
        yield* registerOpener();

        yield* dispatch("zotlit/open-attachment", {
          item: "9",
          paneType: "split",
        });

        expect(openAttachments).toHaveBeenCalledOnce();
        const { reader } = vi.mocked(openAttachments).mock.calls[0]![1];
        reader.open(opened, false);
        expect(opener.open).toHaveBeenCalledExactlyOnceWith(
          { kind: "attachment", attachmentKey: "ATCH1" },
          "split",
        );
      }),
  );
});

describe("layerProtocolHandlers", () => {
  it.effect(
    "registers the handlers on the plugin host, and runs them on the layer's services",
    () =>
      Effect.gen(function* () {
        yield* Layer.build(
          layerProtocolHandlers(
            noteLinks(
              Effect.map(scopedBridge, (bridge) =>
                stubService<NoteLinkPorts>("NoteLinkPorts", {
                  noteImportView,
                  app: appStub(),
                  bridge,
                }),
              ),
            ),
          ).pipe(
            Layer.provide(Layer.merge(recordingHost().layer, servicesFor())),
          ),
        );

        yield* dispatch("zotlit/update-all");

        expect(runBatchUpdateAll).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ view: noteImportView }),
          { groupID: 0, collectionKey: undefined },
        );
      }),
  );

  vitestIt(
    "registers every action the Zotero side and the notes link to, once",
    () => {
      const actions = features.flatMap((feature) =>
        feature.protocol.map(({ action }) => action),
      );
      expect(actions.toSorted()).toEqual(
        [
          "zotlit/explore",
          "zotlit/import-all-notes",
          "zotlit/import-note",
          "zotlit/import-notes",
          "zotlit/open",
          "zotlit/open-attachment",
          "zotlit/show-in-library",
          "zotlit/update",
          "zotlit/update-all",
          "zotlit/update-many",
        ].toSorted(),
      );
    },
  );
});

describe("library-wide protocol links", () => {
  it.effect("passes the named group as an exact update target", () =>
    Effect.gen(function* () {
      yield* register();

      yield* dispatch("zotlit/update-all", {
        library: "7",
        collection: "ABCD2345",
      });

      expect(runBatchUpdateAll).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        { groupID: 7, collectionKey: "ABCD2345" },
      );
    }),
  );

  it.effect("keeps a link without a library parameter on My Library", () =>
    Effect.gen(function* () {
      yield* register();

      yield* dispatch("zotlit/update-all");

      expect(runBatchUpdateAll).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        { groupID: 0, collectionKey: undefined },
      );
    }),
  );

  it.effect(
    "ends an update-all link with the outcome its update ended with",
    () =>
      Effect.gen(function* () {
        vi.mocked(runBatchUpdateAll).mockReturnValueOnce(
          Effect.succeed<BatchUpdateResult>({ outcome: "empty-selection" }),
        );
        yield* register();

        const outcome = yield* dispatch("zotlit/update-all", { library: "7" });

        expect(outcome).toEqual(
          NoteLinkOutcome.UpdateAll({
            exit: Exit.succeed({ outcome: "empty-selection" }),
          }),
        );
      }),
  );

  it.effect("ends an update-all link with its update's failure", () =>
    Effect.gen(function* () {
      vi.mocked(runBatchUpdateAll).mockReturnValueOnce(
        Effect.die(new Error("classify failed")),
      );
      yield* register();

      const outcome = yield* dispatch("zotlit/update-all", { library: "7" });

      expect(
        NoteLinkOutcome.$is("UpdateAll")(outcome) &&
          Exit.isFailure(outcome.exit),
      ).toBe(true);
    }),
  );

  it.effect("passes the named group as an exact import target", () =>
    Effect.gen(function* () {
      yield* register();

      yield* dispatch("zotlit/import-all-notes", {
        library: "7",
        collection: "ABCD2345",
      });

      expect(reads.ScopeItemIDs).toHaveBeenCalledExactlyOnceWith({
        kind: "notes",
        libraryID: 12,
        collectionKey: "ABCD2345",
      });
      expect(openBatchModal).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ total: 2 }),
      );
    }),
  );

  it.effect(
    "keeps an import link without a library parameter on My Library",
    () =>
      Effect.gen(function* () {
        yield* register();

        yield* dispatch("zotlit/import-all-notes");

        expect(reads.ScopeItemIDs).toHaveBeenCalledExactlyOnceWith({
          kind: "notes",
          libraryID: 1,
        });
        expect(openBatchModal).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ total: 2 }),
        );
      }),
  );
});

describe("refused protocol links", () => {
  it.effect.each([
    ["zotlit/open", { item: "1" }],
    ["zotlit/update", { item: "1" }],
    ["zotlit/update-many", { items: "1,2" }],
    ["zotlit/import-note", { item: "1", mode: "child" }],
    ["zotlit/import-notes", { items: "1,2", mode: "child" }],
    ["zotlit/open-attachment", { item: "9" }],
    ["zotlit/explore", { item: "1" }],
    ["zotlit/update-all", { library: "7" }],
    ["zotlit/import-all-notes", { library: "7" }],
  ] as const)(
    "refuses %s, an action on library content launched from Zotero on this computer, while the online library is the source",
    ([action, query]) =>
      Effect.gen(function* () {
        refOf(REF);
        yield* register({ source: "web-api" });

        expect(yield* dispatch(action, query)).toEqual(
          LinkOutcome.NeedsLocalZotero(),
        );
        expect(reads.DisplayRefs).not.toHaveBeenCalled();
        expect(reads.AttachmentsAt).not.toHaveBeenCalled();
        expect(runBatchUpdate).not.toHaveBeenCalled();
      }),
  );

  it.effect("reads no item for a query that does not parse", () =>
    Effect.gen(function* () {
      yield* register();

      expect(yield* dispatch("zotlit/open", { item: "x" })).toEqual(
        LinkOutcome.InvalidLink(),
      );

      expect(reads.DisplayRefs).not.toHaveBeenCalled();
    }),
  );

  it.effect("ignores a link from another Zotero", () =>
    Effect.gen(function* () {
      refOf(REF);
      yield* register();

      expect(
        yield* dispatch("zotlit/open", { item: "1", "source-id": "ffff0000" }),
      ).toEqual(LinkOutcome.ForeignSource());

      expect(reads.DisplayRefs).not.toHaveBeenCalled();
      expect(openCompanionNote).not.toHaveBeenCalled();
    }),
  );

  it.effect("reads no item when the database is not ready", () =>
    Effect.gen(function* () {
      yield* register({ state: "degraded" });

      expect(yield* dispatch("zotlit/open", { item: "1" })).toEqual(
        LinkOutcome.DatabaseUnavailable(),
      );

      expect(reads.DisplayRefs).not.toHaveBeenCalled();
    }),
  );

  it.effect("opens no note for an id with no live item", () =>
    Effect.gen(function* () {
      yield* register();

      expect(yield* dispatch("zotlit/open", { item: "5" })).toEqual(
        LinkOutcome.ItemNotFound(),
      );

      expect(openCompanionNote).not.toHaveBeenCalled();
    }),
  );

  it.effect("refuses a pushed Profile ID that names no Profile", () =>
    Effect.gen(function* () {
      const requests = yield* PubSub.unbounded<UpdateManyRequest>();
      const registration = yield* register({
        updateManyRequests: Stream.fromPubSub(requests),
      });
      const outcome = yield* Stream.runHead(registration.outcomes).pipe(
        Effect.forkChild({ startImmediately: true }),
      );

      yield* PubSub.publish(requests, {
        items: [1, 2],
        scope: "full",
        profileId: "not-a-profile",
      });

      expect(yield* Fiber.join(outcome)).toEqual(
        Option.some(NoteLinkOutcome.UnknownProfile({ text: "not-a-profile" })),
      );
      expect(runBatchUpdate).not.toHaveBeenCalled();
    }),
  );
});

describe("batch protocol links", () => {
  it.effect(
    "hands an update-many link's ids, scope and Profile to the batch runner",
    () =>
      Effect.gen(function* () {
        yield* register();

        yield* dispatch("zotlit/update-many", {
          items: "3,4,3",
          scope: "metadata",
          profile: "Bk3Qn7XvT2Lp",
        });

        expect(runBatchUpdate).toHaveBeenCalledExactlyOnceWith(
          expect.objectContaining({ view: noteImportView }),
          [3, 4],
          { scope: "metadata", profile: "Bk3Qn7XvT2Lp" },
        );
      }),
  );

  it.effect(
    "ends an update-many link with the outcome its update ended with",
    () =>
      Effect.gen(function* () {
        vi.mocked(runBatchUpdate).mockReturnValueOnce(
          Effect.succeed<BatchUpdateResult>({ outcome: "db-unavailable" }),
        );
        yield* register();

        const outcome = yield* dispatch("zotlit/update-many", { items: "3,4" });

        expect(outcome).toEqual(
          NoteLinkOutcome.UpdateMany({
            exit: Exit.succeed({ outcome: "db-unavailable" }),
          }),
        );
      }),
  );

  it.effect("ends an update-many link with its update's failure", () =>
    Effect.gen(function* () {
      vi.mocked(runBatchUpdate).mockReturnValueOnce(
        Effect.die(new Error("classify failed")),
      );
      yield* register();

      const outcome = yield* dispatch("zotlit/update-many", { items: "3,4" });

      expect(
        NoteLinkOutcome.$is("UpdateMany")(outcome) &&
          Exit.isFailure(outcome.exit),
      ).toBe(true);
    }),
  );

  it.effect("imports the one item an import-note link names", () =>
    Effect.gen(function* () {
      yield* register();

      yield* dispatch("zotlit/import-note", { item: "8", mode: "child" });

      expect(openBatchModal).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          total: 1,
          text: expect.objectContaining({
            title: m.batch_import_child_title(),
          }),
        }),
      );
    }),
  );

  it.effect("imports the items an import-notes link names", () =>
    Effect.gen(function* () {
      yield* register();

      yield* dispatch("zotlit/import-notes", { items: "8,9", mode: "note" });

      expect(openBatchModal).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          total: 2,
          text: expect.objectContaining({ title: m.batch_import_title() }),
        }),
      );
    }),
  );

  it.effect("opens no import while the database is not ready", () =>
    Effect.gen(function* () {
      yield* register({ state: "degraded" });

      const outcome = yield* dispatch("zotlit/import-note", {
        item: "8",
        mode: "note",
      });

      expect(outcome).toEqual(
        NoteLinkOutcome.ImportNotes({
          exit: Exit.succeed({ outcome: "db-unavailable" }),
        }),
      );
      expect(openBatchModal).not.toHaveBeenCalled();
    }),
  );

  it.effect("ends a link import with the failure its run ended with", () =>
    Effect.gen(function* () {
      yield* register({ whenIndexed: Effect.die(new Error("index failed")) });

      const outcome = yield* dispatch("zotlit/import-note", {
        item: "8",
        mode: "note",
      });

      expect(
        NoteLinkOutcome.$is("ImportNotes")(outcome) &&
          Exit.isFailure(outcome.exit),
      ).toBe(true);
      expect(openBatchModal).not.toHaveBeenCalled();
    }),
  );
});

describe("requests pushed over the Local Server", () => {
  it.effect("runs a pushed batch update with its scope and Profile", () =>
    Effect.gen(function* () {
      const registration = yield* register({
        updateManyRequests: Stream.make<[UpdateManyRequest]>({
          items: [5, 6],
          scope: "full",
          profileId: "Bk3Qn7XvT2Lp",
        }),
      });

      yield* registration.idle;

      expect(runBatchUpdate).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        [5, 6],
        { scope: "full", profile: "Bk3Qn7XvT2Lp" },
      );
    }),
  );

  it.effect("runs a pushed batch import", () =>
    Effect.gen(function* () {
      const registration = yield* register({
        importNotesRequests: Stream.make<[ImportNotesRequest]>({
          items: [7, 8],
          mode: "note",
        }),
      });

      yield* registration.idle;

      expect(openBatchModal).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          total: 2,
          text: expect.objectContaining({ title: m.batch_import_title() }),
        }),
      );
    }),
  );

  it.effect("starts no run for a request pushed after the Scope closes", () =>
    Effect.gen(function* () {
      const requests = yield* PubSub.unbounded<UpdateManyRequest>();
      const scope = yield* Scope.make();
      const registration = yield* register({
        updateManyRequests: Stream.fromPubSub(requests),
      }).pipe(Scope.provide(scope));
      const request: UpdateManyRequest = { items: [5], scope: "full" };
      const ran = yield* Deferred.make<void>();
      vi.mocked(runBatchUpdate).mockImplementationOnce(() =>
        Effect.sync((): BatchUpdateResult => {
          Deferred.doneUnsafe(ran, Effect.void);
          return { outcome: "batch-modal" };
        }),
      );
      yield* PubSub.publish(requests, request);
      yield* Deferred.await(ran);

      yield* Scope.close(scope, Exit.void);
      yield* PubSub.publish(requests, request);
      yield* registration.idle;

      expect(runBatchUpdate).toHaveBeenCalledOnce();
    }),
  );
});
