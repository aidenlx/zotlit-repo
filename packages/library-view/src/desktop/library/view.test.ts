// @vitest-environment happy-dom
import { it as effectIt } from "@effect/vitest";
import { Effect, Layer, Stream } from "effect";
import type {
  App,
  Plugin,
  TFile,
  WorkspaceItem,
  WorkspaceLeaf,
} from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Item } from "@zotlit/db";
import { makeItem } from "@zotlit/db/item-fixture";
import { testItemSeed } from "@zotlit/item-query";
import { NoteFeature } from "@zotlit/notes/desktop/note-feature/service.ts";
import {
  keymapApp,
  pressTop,
} from "@zotlit/obsidian-kit/__fixtures__/keymap.ts";
import { layerHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import {
  createObsidianHost,
  PluginStub,
} from "@zotlit/obsidian-kit/__fixtures__/obsidian-host.ts";
import { MemoryWorkspace } from "@zotlit/obsidian-kit/__fixtures__/obsidian-workspace.ts";
import {
  Menu,
  controlsOf,
  Modal,
  resetMockPlatform,
  setMockPlatform,
  TextComponent,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { layerWorkspaceFrom } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import type { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import {
  testEvent,
  testEvents,
} from "@zotlit/plugin-kernel/__fixtures__/event-stream.ts";
import { testRuntime } from "@zotlit/plugin-kernel/__fixtures__/runtime.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { subscribe } from "@zotlit/plugin-kernel/effect-stream.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type {
  SearchHit,
  SearchOptions,
} from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import { ItemLookup } from "@zotlit/plugin-services/obsidian/item-lookup/service.ts";
import { resolvedLibraryScopeAtom } from "@zotlit/plugin-services/obsidian/library-scope/atoms.ts";
import { LibraryScope as LibraryScopeService } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { notedItemKeysAtom } from "@zotlit/plugin-services/obsidian/note-index/atoms.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import type { NoteIndexChange } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { useLedgerAtom } from "@zotlit/plugin-services/obsidian/use-ledger/atoms.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import type {
  Ledger,
  UseKind,
} from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import type { QueryHostDeps } from "@zotlit/query-views/__fixtures__/query-view/host.ts";
import { noLiteratureNotes } from "@zotlit/query-views/__fixtures__/query-view/literature-notes.ts";
import {
  fakeQuery,
  requested,
} from "@zotlit/query-views/__fixtures__/query-view/query-run.ts";
import { QueryService } from "@zotlit/query-views/desktop/item-query/service.ts";
import type {
  QueryViewOutcome,
  QueryViewRequest,
  QueryViewValue,
} from "@zotlit/query-views/worker/item-query/query-view.ts";
import { stubbedReads } from "@zotlit/zotero-reads/__fixtures__/in-process.ts";
import {
  zoteroRevisionAtom,
  zoteroStateAtom,
} from "@zotlit/zotero-reads/client/atoms.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReadsEvent } from "@zotlit/zotero-reads/client/service.ts";
import type {
  AvailableLibrary,
  LibraryScope,
  LibrarySelector,
  ResolvedLibraryScope,
} from "@zotlit/zotero-reads/contract/library-scope.ts";
import { selectorKey } from "@zotlit/zotero-reads/contract/library-scope.ts";
import { DbUnavailable } from "@zotlit/zotero-reads/contract/rpc.ts";

import type { LibraryNode } from "./document.ts";
import { nodeKey } from "./document.ts";
import { itemActions } from "./item-actions.ts";
import { openLibraryView, registerLibraryView } from "./register.ts";
import type { LibraryViewDeps } from "./view.ts";
import { LibraryView } from "./view.ts";
import { openWelcomeView } from "./welcome-register.ts";

import { holdNow, useAt, makeLibraryHost } from "#__fixtures__/library.ts";
import { buildSettings } from "#__fixtures__/settings.ts";
import { waitFor } from "#__fixtures__/welcome.ts";

const EMPTY = {
  kind: "result",
  result: {
    libraries: [{ type: "personal" }],
    query: { filter: null, fields: [], sort: [], limit: null },
    returnedCount: 0,
    matchedCount: 0,
    truncated: false,
    warnings: [],
    rows: [],
  },
} satisfies QueryViewOutcome;

let cleanup = new AsyncDisposableStack();
afterEach(async () => {
  await cleanup.disposeAsync();
  cleanup = new AsyncDisposableStack();
  document.body.replaceChildren();
});

class OpenView extends LibraryView {
  override readonly containerEl = document.createElement("div");
  open(): Promise<void> {
    return this.onOpen();
  }
  close(): Promise<void> {
    return this.onClose();
  }
}

interface SeedItem {
  readonly key: string;
  readonly libraryID: number;
  readonly collections: readonly string[];
  readonly annotations?: number;
  readonly pdf?: boolean;
  readonly title?: string;
  readonly tags?: readonly string[];
  readonly attachments?: readonly string[];
  readonly fields?: Readonly<Record<string, QueryViewValue>>;
  readonly itemType?: string;
  readonly card?: Readonly<Record<string, QueryViewValue>>;
  readonly marks?: readonly SeedAnnotation[];
}

interface SeedAnnotation {
  readonly key: string;
  readonly values: Readonly<Record<string, QueryViewValue>>;
}

function marksOf(item: SeedItem): readonly SeedAnnotation[] {
  return (
    item.marks ??
    Array.from({ length: item.annotations ?? 0 }, (_, index) => ({
      key: `${item.key.slice(0, 7)}${index}`,
      values: { type: "highlight", color: "#ffd400", text: "" },
    }))
  );
}

function cardValues(item: SeedItem): Record<string, QueryViewValue> {
  return {
    itemType: item.itemType ?? "journalArticle",
    tags: (item.tags ?? []).map((name) => ({ name, type: "manual" })),
    "annotations[].indexedKey": marksOf(item).map(({ key }) => key),
    "annotations[].color": marksOf(item).map(
      ({ values }) => values.color ?? null,
    ),
    ...item.card,
  };
}

const LIBRARIES: readonly AvailableLibrary[] = [
  { selector: { type: "personal" }, libraryID: 1, name: null },
  { selector: { type: "group", groupID: 4815 }, libraryID: 2, name: "Lab" },
  { selector: { type: "group", groupID: 77 }, libraryID: 3, name: "Archive" },
];
const PATHS = new Map<number, string[][]>([
  [
    1,
    [
      ["Reading list"],
      ["Thesis"],
      ["Thesis", "Chapter 1"],
      ["Thesis", "Chapter 2"],
    ],
  ],
  [2, [["Thesis"]]],
  [3, []],
]);
const SEED: readonly SeedItem[] = [
  {
    key: "AAAAAAAA",
    libraryID: 1,
    collections: ["Thesis/Chapter 1", "Thesis/Chapter 2"],
    annotations: 2,
    pdf: true,
    title: "Graph drawing for figures",
    tags: ["method", "figure"],
  },
  {
    key: "BBBBBBBB",
    libraryID: 1,
    collections: ["Thesis/Chapter 2"],
    pdf: true,
    title: "Notes on attention",
    tags: ["talk"],
    fields: {
      creators: [
        { role: "author", family: "Vaswani", given: "Ashish", literal: null },
        { role: "author", family: "Shazeer", given: "Noam", literal: null },
        { role: "editor", family: "Guyon", given: "Isabelle", literal: null },
      ],
      date: { year: 2017 },
      publicationTitle: "Advances in Neural Information Processing Systems",
      abstractNote: "Attention alone carries a sequence model.",
    },
  },
  {
    key: "CCCCCCCC",
    libraryID: 1,
    collections: ["Thesis"],
    annotations: 1,
    title: "Figures that work",
    tags: ["method"],
  },
  {
    key: "DDDDDDDD",
    libraryID: 1,
    collections: ["Reading list"],
    title: "Ten rules for better figures",
    tags: ["figure"],
  },
  { key: "EEEEEEEE", libraryID: 1, collections: [], tags: ["method"] },
  {
    key: "FFFFFFFF",
    libraryID: 2,
    collections: ["Thesis"],
    title: "Figures in the lab",
    tags: ["lab-meeting"],
  },
  { key: "GGGGGGGG", libraryID: 2, collections: [] },
  {
    key: "HHHHHHHH",
    libraryID: 3,
    collections: [],
    attachments: ["HPDFHPDF"],
  },
];

const NOTED = ["AAAAAAAA", "DDDDDDDD"];

const CONDITIONS: readonly [string, (item: SeedItem) => boolean][] = [
  ["lastRead == null", () => true],
  ["annotations.isEmpty()", (item) => (item.annotations ?? 0) === 0],
  ["annotations.length > 0", (item) => (item.annotations ?? 0) > 0],
  [
    'attachments.filter(value.fileType == "pdf" && value.exists).length > 0',
    (item) => item.pdf === true,
  ],
];
function selects(filter: string | undefined, item: SeedItem): boolean {
  if (filter === undefined) return true;
  let answered = filter;
  for (const [condition, test] of CONDITIONS)
    answered = answered.replaceAll(condition, String(test(item)));
  const answer = testItemSeed(answered, {
    scan: {
      itemID: 1,
      key: item.key,
      itemType: "journalArticle",
      dateAdded: null,
      dateModified: null,
    },
    groupID: null,
    fields: { title: item.title ?? "" },
    custom: {},
    customFieldNames: [],
    creators: [],
    tags: (item.tags ?? []).map((name) => ({ name, type: 0 })),
    collections: item.collections.map((path) => path.split("/")),
  });
  if (answer.kind !== "result") throw new Error(JSON.stringify(answer));
  return answer.matched;
}

function answer(
  items: readonly SeedItem[],
  request: QueryViewRequest,
): QueryViewOutcome {
  const named =
    request.libraries?.mode === "selected" ? request.libraries.libraries : [];
  const ids = new Set(
    LIBRARIES.filter(({ selector }) =>
      named.some((s) => selectorKey(s) === selectorKey(selector)),
    ).map(({ libraryID }) => libraryID),
  );
  if (request.from === "annotations") {
    const of = items.find(
      ({ key, libraryID }) =>
        key === request.context?.item && ids.has(libraryID),
    );
    if (!of || request.limit == null) return EMPTY;
    const marks = marksOf(of);
    const rows = marks
      .slice(0, request.limit)
      .map(({ key, values }) => ({ indexedKey: key, values }));
    return requested(
      {
        kind: "result",
        result: {
          ...EMPTY.result,
          returnedCount: rows.length,
          matchedCount: marks.length,
          truncated: rows.length < marks.length,
          rows,
        },
      },
      request,
    );
  }
  if (request.from === "attachments") {
    const parent = /^item\.indexedKey == "(\w+)"$/.exec(request.filter ?? "");
    const rows = items
      .filter(({ key, libraryID }) => key === parent?.[1] && ids.has(libraryID))
      .flatMap(({ attachments }) => attachments ?? [])
      .map((key) => ({ indexedKey: key, values: { title: key } }));
    return requested(
      {
        kind: "result",
        result: {
          ...EMPTY.result,
          returnedCount: rows.length,
          matchedCount: rows.length,
          rows,
        },
      },
      request,
    );
  }
  if (request.group === undefined) {
    const rows = items
      .filter(
        (item) => ids.has(item.libraryID) && selects(request.filter, item),
      )
      .map((item) => {
        const { key, collections, title, fields, attachments } = item;
        return {
          indexedKey: key,
          values: {
            collections: collections.toSorted(),
            ...(attachments && {
              "attachments[].indexedKey": [...attachments],
            }),
            ...(title !== undefined && { title }),
            ...(item.pdf && { "attachments[].fileType": ["pdf"] }),
            ...fields,
            ...(request.limit === 1 && cardValues(item)),
          },
        };
      });
    const returned =
      request.limit == null ? rows : rows.slice(0, request.limit);
    return requested(
      {
        kind: "result",
        result: {
          ...EMPTY.result,
          returnedCount: returned.length,
          matchedCount: rows.length,
          truncated: returned.length < rows.length,
          rows: returned,
        },
      },
      request,
    );
  }
  const valuesOf = GROUPS[request.group];
  if (!valuesOf) throw new Error(`The fake cannot group by ${request.group}`);
  const matched = items.filter(
    (item) => ids.has(item.libraryID) && selects(request.filter, item),
  );
  const groups = new Map<string | null, SeedItem[]>();
  for (const item of matched) {
    const values = valuesOf(item);
    for (const value of values.length > 0 ? values : [null])
      groups.set(value, [...(groups.get(value) ?? []), item]);
  }
  return {
    kind: "result",
    result: {
      libraries: EMPTY.result.libraries,
      query: EMPTY.result.query,
      truncated: false,
      warnings: [],
      returnedCount: matched.length,
      matchedCount: matched.length,
      totalCount: matched.length,
      groups: [...groups].map(([value, rows]) => ({
        value,
        count: rows.length,
        rows: (request.limit == null ? rows : rows.slice(0, request.limit)).map(
          ({ key }) => ({ indexedKey: key, values: {} }),
        ),
      })),
    },
  };
}

const GROUPS: Readonly<Record<string, (item: SeedItem) => readonly string[]>> =
  {
    "collections[]": (item) => item.collections,
    "tags[].name": (item) => item.tags ?? [],
  };

async function pluginData(
  stored?: unknown,
  actionItem?: Item,
  navigation?: Layer.Layer<NoteFeature | Workspace | ZoteroPref>,
) {
  setMockPlatform({ isMacOS: true });
  cleanup.defer(resetMockPlatform);
  const host = createObsidianHost({});
  const plugin = new PluginStub(host.app as unknown as App, {
    __VERSION__: 10,
    ...(stored !== undefined && { "library.document": stored }),
  });
  const settings = cleanup.use(
    await buildSettings({
      plugin,
      migrateLegacy: (raw) => raw,
      migrateV1: (raw) => raw,
      migrateV2: (raw) => raw,
      migrateV3: (raw) => raw,
      migrateV4: (raw) => raw,
      migrateV5: (raw) => raw,
      migrateV6: (raw) => raw,
      migrateV7: (raw) => raw,
      migrateV8: (raw) => raw,
      migrateV9: (raw) => raw,
      migrateV10: (raw) => raw,
    }),
  );
  const database = { items: SEED };
  const run = vi.fn((request: QueryViewRequest, _signal: AbortSignal) =>
    Promise.resolve(answer(database.items, request)),
  );
  const reads = testEvents<Record<string, () => void>>([
    "changed",
    "degraded",
    "refresh-failed",
    "db-file-missing",
    "refreshing",
  ]);
  const database_ = {
    state: "ready" as "ready" | "degraded",
    error: null as DbUnavailable | null,
    moved: false,
  };
  const sourceReads = cleanup.use(stubbedReads());
  vi.spyOn(sourceReads.reads, "CollectionPaths").mockImplementation(
    ({ libraryIDs }) =>
      Effect.succeed(libraryIDs.flatMap((id) => PATHS.get(id) ?? [])),
  );
  vi.spyOn(sourceReads.reads, "ConnectionReadout").mockImplementation(() =>
    Effect.succeed({ itemCount: 8 }),
  );
  vi.spyOn(sourceReads.reads, "ItemsByIndexedKeys").mockImplementation(() =>
    Effect.succeed(
      new Map(actionItem ? [[actionItem.indexedKey, actionItem]] : []),
    ),
  );
  const readApi = stubService<ZoteroReads["Service"]["reads"]>("ZoteroReads", {
    ItemsByIndexedKeys: sourceReads.reads.ItemsByIndexedKeys,
    CollectionPaths: sourceReads.reads.CollectionPaths,
    ConnectionReadout: sourceReads.reads.ConnectionReadout,
  });
  const readsDeps = stubService<QueryHostDeps["reads"]>("ZoteroReads", {
    ...reads.streams,
    get state() {
      return database_.state;
    },
    get error() {
      return database_.error;
    },
    get moved() {
      return database_.moved;
    },
    get dbFileMissing() {
      return false;
    },
    get activeReadMode() {
      return null;
    },
    acquireRead: async () => ({
      reads: readApi,
      [Symbol.asyncDispose]: async () => {},
    }),
  });
  const vaultOn = host.vault.on.bind(host.vault) as App["vault"]["on"];
  const setupActions = {
    openSettings: vi.fn(),
    pickFolder: vi.fn(),
    locateZotero: vi.fn(),
  };
  const notes = new Set(NOTED);
  const nativeNotes = testEvent<NoteIndexChange>();
  const notesChanged = testEvent<void>();
  const literatureNotes = {
    ...noLiteratureNotes(),
    find: (itemKey: string) =>
      notes.has(itemKey) ? { path: `${itemKey}.md`, basename: itemKey } : null,
    on: (event: "changed" | "frontmatter-changed", listener: () => void) =>
      event === "changed"
        ? subscribe(runtime, notesChanged.stream, listener)
        : () => {},
    itemKeys: () => [...notes],
    open: vi.fn(),
  };
  const items = {
    openNote: vi.fn(() => Promise.resolve()),
    openPdf: vi.fn(() => Promise.resolve()),
    insertCitation: vi.fn(() => Promise.resolve()),
    copyCitationKey: vi.fn(() => Promise.resolve()),
    showInZotero: vi.fn(),
  };
  const scopeEvents = testEvents<{
    changed: () => void;
    "libraries-changed": () => void;
  }>(["changed", "libraries-changed"]);
  const libraryScope = {
    ...scopeEvents.streams,
    effective: {
      mode: "selected",
      libraries: [
        ...LIBRARIES.slice(0, 2).map(({ selector }) => selector),
        GONE,
      ],
    } as LibraryScope,
    current: {
      mode: "selected",
      invalid: false,
      available: LIBRARIES.slice(0, 2),
      unavailable: [GONE],
    } as ResolvedLibraryScope,
    libraries: LIBRARIES,
  };
  const searches: { query: string; libraries: number[] }[] = [];
  const search = (
    query: string,
    opts?: SearchOptions,
    _signal?: AbortSignal,
  ) => {
    const libraries = (opts?.libraries ?? []).map((l) => l.libraryID);
    searches.push({ query, libraries });
    const words = query.toLowerCase().split(" ");
    return Promise.resolve(
      database.items
        .filter(
          ({ libraryID, title }) =>
            libraries.includes(libraryID) &&
            words.every((word) => title?.toLowerCase().includes(word)),
        )
        .toReversed()
        .map(
          ({ key, libraryID }) =>
            ({
              item: { key, indexedKey: key, libraryID },
              matches: [],
              library: null,
            }) as unknown as SearchHit,
        ),
    );
  };
  const app = stubService<App>("App", {
    ...keymapApp(),
    workspace: stubService<App["workspace"]>("Workspace", {}),
    vault: stubService<App["vault"]>("Vault", {
      getFolderByPath: host.vault.getFolderByPath.bind(host.vault),
      getAbstractFileByPath: host.vault.getAbstractFileByPath.bind(host.vault),
      on: vaultOn,
      offref: host.vault.offref.bind(host.vault),
    }),
  });
  const runtime = testRuntime();
  const current = Effect.sync(() => ({
    ...database_,
    dbFileMissing: false,
    activeReadMode: null,
  }));
  const nativeEvents = testEvent<ZoteroReadsEvent>();
  const nativeStates =
    testEvent<
      import("@zotlit/zotero-reads/client/service.ts").ZoteroReadsState
    >();
  const events = nativeEvents.stream;
  const publish = (event: ZoteroReadsEvent) => {
    nativeStates.emit({
      ...database_,
      dbFileMissing: false,
      activeReadMode: null,
    });
    nativeEvents.emit(event);
  };
  const uses = { current: {} as Ledger };
  const usesChanged = testEvent<Ledger>();
  const searchRun = { search };
  const welcomeHost = cleanup.use(
    await makeLibraryHost({
      services: Layer.mergeAll(
        layerHost({
          vault: app.vault,
          workspace: Object.assign(new MemoryWorkspace(), {
            trigger: (name: string, ...args: unknown[]) =>
              app.workspace.trigger(name, ...args),
          }),
        }),
        Layer.succeed(PluginSettings, settings),
        Layer.mock(NoteIndex, {
          whenIndexed: Effect.void,
          getNotesByItemKey: () => Effect.succeed([]),
          getIndexedItemKeys: Effect.sync(() => [...notes]),
          changes: nativeNotes.stream,
        }),
        Layer.mock(UseLedger, {
          changes: Stream.concat(
            Stream.suspend(() => Stream.make(uses.current)),
            usesChanged.stream,
          ),
        }),
        Layer.mock(ItemLookup, {
          search: (words, options) =>
            Effect.promise((signal) =>
              searchRun.search(words, options, signal),
            ),
        }),
        Layer.mock(QueryService, {
          run: (request) => Effect.promise((signal) => run(request, signal)),
        }),
        Layer.mock(LibraryScopeService, {
          libraries: Effect.sync(() => libraryScope.libraries),
          changes: Stream.concat(
            Stream.suspend(() =>
              Stream.make({
                current: libraryScope.current,
                all: {
                  ...libraryScope.current,
                  available: libraryScope.libraries,
                },
                invalid: false,
                effective: libraryScope.effective,
                libraryRows: null,
              }),
            ),
            Stream.map(scopeEvents.streams.changed, () => ({
              current: libraryScope.current,
              all: {
                ...libraryScope.current,
                available: libraryScope.libraries,
              },
              invalid: false,
              effective: libraryScope.effective,
              libraryRows: null,
            })),
          ),
        }),
        Layer.mock(ZoteroReads, {
          current,
          reads: readApi,
          snapshot: Effect.succeed(readApi),
          changes: Stream.concat(
            Stream.fromEffect(current),
            nativeStates.stream,
          ),
          events,
        }),
        navigation ?? Layer.empty,
      ),
    }),
  );

  cleanup.defer(welcomeHost.registry.mount(notedItemKeysAtom));
  cleanup.defer(welcomeHost.registry.mount(zoteroRevisionAtom));
  cleanup.defer(welcomeHost.registry.mount(zoteroStateAtom));
  cleanup.defer(welcomeHost.registry.mount(resolvedLibraryScopeAtom));
  await waitFor(() =>
    expect(welcomeHost.registry.get(resolvedLibraryScopeAtom)).toBe(
      libraryScope.current,
    ),
  );

  await waitFor(() => expect(nativeEvents.subscribers).toBeGreaterThan(0));

  const deps = stubService<LibraryViewDeps & QueryHostDeps>("LibraryViewDeps", {
    runtime,
    registry: welcomeHost.registry,
    app,
    reads: readsDeps,
    libraryScope: stubService<QueryHostDeps["libraryScope"]>("LibraryScope", {
      changed: Stream.map(
        scopeEvents.streams.changed,
        () => libraryScope.current,
      ),
      "libraries-changed": scopeEvents.streams["libraries-changed"],
      get current() {
        return libraryScope.current;
      },
    }),
    query: fakeQuery(run),
    cardFocus: { hold: () => ({ [Symbol.dispose]: () => {} }) },
    items,
    welcome: { registry: welcomeHost.registry, setupActions },
    literatureNotes,
    opener: { open: () => Effect.succeed({ kind: "reader" as const }) },
  });
  const change = async (items: readonly SeedItem[]) => {
    const revision = welcomeHost.registry.get(zoteroRevisionAtom);
    database.items = items;
    reads.emit("changed");
    publish({ _tag: "changed" });
    await waitFor(() =>
      expect(welcomeHost.registry.get(zoteroRevisionAtom)).toBeGreaterThan(
        revision,
      ),
    );
  };
  const lose = async () => {
    database_.state = "degraded";
    database_.error = new DbUnavailable({
      message: "No zotero.sqlite in the data folder",
    });
    reads.emit("degraded");
    publish({ _tag: "degraded", error: database_.error });
    await waitFor(() =>
      expect(welcomeHost.registry.get(zoteroStateAtom).state).toBe("degraded"),
    );
  };
  const refreshFails = async () => {
    database_.error = new DbUnavailable({ message: "EACCES: zotero.sqlite" });
    database_.moved = false;
    reads.emit("refresh-failed");
    publish({
      _tag: "refresh-failed",
      error: database_.error,
      moved: database_.moved,
    });
    await waitFor(() =>
      expect(welcomeHost.registry.get(zoteroStateAtom).error).toBe(
        database_.error,
      ),
    );
  };
  const moveFails = async () => {
    database_.error = new DbUnavailable({ message: "ENOENT: zotero.sqlite" });
    database_.moved = true;
    reads.emit("refresh-failed");
    publish({
      _tag: "refresh-failed",
      error: database_.error,
      moved: database_.moved,
    });
    await waitFor(() =>
      expect(welcomeHost.registry.get(zoteroStateAtom).error).toBe(
        database_.error,
      ),
    );
  };
  const locate = async () => {
    database_.state = "ready";
    database_.error = null;
    database_.moved = false;
    reads.emit("changed");
    publish({ _tag: "changed" });
    await waitFor(() =>
      expect(welcomeHost.registry.get(zoteroStateAtom).state).toBe("ready"),
    );
  };
  const addNote = async (itemKey: string) => {
    notes.add(itemKey);
    notesChanged.emit();
    nativeNotes.emit({ type: "indexed" });
    await waitFor(() =>
      expect(welcomeHost.registry.get(notedItemKeysAtom).has(itemKey)).toBe(
        true,
      ),
    );
  };
  const rescope = async (
    available: readonly AvailableLibrary[],
    missing: readonly LibrarySelector[] = [],
  ) => {
    libraryScope.effective = {
      mode: "selected",
      libraries: [...available.map(({ selector }) => selector), ...missing],
    };
    libraryScope.current = {
      ...libraryScope.current,
      available,
      unavailable: missing,
    };
    scopeEvents.emit("changed");
    await waitFor(() =>
      expect(welcomeHost.registry.get(resolvedLibraryScopeAtom)).toBe(
        libraryScope.current,
      ),
    );
  };
  return {
    deps,
    host,
    run,
    settings,
    change,
    addNote,
    searches,
    rescope,
    items,
    lose,
    refreshFails,
    moveFails,
    locate,
    setupActions,
    uses,
    setUse: async (key: string, kind: UseKind, iso: string) => {
      uses.current = { ...uses.current, [key]: useAt(kind, iso) };
      usesChanged.emit(uses.current);
      await waitFor(() =>
        expect(welcomeHost.registry.get(useLedgerAtom)).toBe(uses.current),
      );
    },
    searchRun,
  };
}

function listRuns(run: Awaited<ReturnType<typeof pluginData>>["run"]) {
  return run.mock.calls
    .map(([request]) => request)
    .filter((request) => (request.fields ?? []).length > 0)
    .filter((request) => !cardRun(request));
}

function cardRun(request: QueryViewRequest): boolean {
  return (
    request.from === "annotations" ||
    (request.fields ?? []).includes("abstractNote")
  );
}

function row(view: LibraryView, node: LibraryNode): HTMLElement {
  const found = [
    ...view.contentEl.querySelectorAll<HTMLElement>("[data-library-node]"),
  ].find((el) => el.dataset.libraryNode === nodeKey(node));
  if (!found) throw new Error(`No tree row for ${nodeKey(node)}`);
  return found;
}

async function press(view: LibraryView, el: HTMLElement) {
  await act(async () => {
    el.click();
    await view.searched;
    await view.query.settled;
    await view.tree.settled;
  });
}

const PERSONAL = { type: "personal" } as const;
const GONE = { type: "group", groupID: 9999 } as const;
const LAB = { type: "group", groupID: 4815 } as const;
const ARCHIVE = { type: "group", groupID: 77 } as const;
const THESIS: LibraryNode = {
  kind: "collection",
  library: PERSONAL,
  path: ["Thesis"],
};

function header(view: LibraryView) {
  const el = view.contentEl.querySelector("[data-library-heading]");
  if (!el) return undefined;
  return [
    "[data-library-heading-path]",
    "[data-library-header]",
    "[data-library-header-count]",
  ]
    .map((part) => el.querySelector(part)?.textContent ?? "")
    .filter((text) => text !== "")
    .join(" | ");
}

function filterChips(view: LibraryView) {
  return [
    ...view.contentEl.querySelectorAll<HTMLElement>("[data-library-filter]"),
  ].map((chip) => chip.dataset.libraryFilter);
}

function accessibleName(el: Element): string {
  return (el.getAttribute("aria-labelledby") ?? "")
    .split(" ")
    .filter((id) => id !== "")
    .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "")
    .join(" ");
}

function tree(view: LibraryView) {
  return [
    ...view.contentEl.querySelectorAll<HTMLElement>("[data-library-node]"),
  ].map(
    (node) =>
      `${"  ".repeat(Number(node.getAttribute("aria-level")) - 1)}${
        node.querySelector("[data-library-label]")!.textContent
      }${[...node.querySelectorAll("[data-library-count]")].map((count) => ` ${count.textContent}`).join("")}`,
  );
}

async function openTab(deps: LibraryViewDeps) {
  const root = stubService<WorkspaceItem>("WorkspaceItem", {});
  const leaf = stubService<WorkspaceLeaf & { app: App }>("WorkspaceLeaf", {
    app: deps.app,
    getRoot: () => root,
    updateHeader: () => {},
  });
  const view = new OpenView(leaf, deps);
  document.body.append(view.contentEl);
  await act(async () => {
    await view.open();
    await view.query.settled;
    await view.tree.settled;
  });
  cleanup.defer(() => view.close());
  return view;
}

const RECENT: LibraryNode = { kind: "recent" };
const MY_LIBRARY: LibraryNode = { kind: "library", library: PERSONAL };

it("opens on Recent, every Library in the Library Scope newest activity first, where plugin data holds no document", async () => {
  const { deps, run } = await pluginData();
  const view = await openTab(deps);
  expect(listRuns(run)).toHaveLength(1);
  const [request] = listRuns(run) as [QueryViewRequest];
  expect(request).toMatchObject({
    from: "items",
    libraries: { mode: "selected", libraries: [PERSONAL, LAB] },
    sort: [{ field: "lastActivity", direction: "desc" }],
  });
  expect(row(view, RECENT).getAttribute("aria-selected")).toBe("true");
  expect(header(view)).toBe("Recent | 7 papers");
  expect(request.limit).toBe(1000);
  expect(request).not.toHaveProperty("filter");
  expect(request).not.toHaveProperty("context");
});

it("shows the newest Zotero activity only on Recent and stops requesting it on other nodes", async () => {
  const { deps, change, run } = await pluginData();
  await change([
    {
      ...SEED[0]!,
      fields: {
        lastActivity: "2025-02-01T00:00:00Z",
        lastActivitySource: "read",
      },
    },
  ]);
  const view = await openTab(deps);
  expect(view.contentEl.textContent).toContain("in Zotero");
  expect(listRuns(run).at(-1)?.fields).toContain("lastActivitySource");
  await press(view, row(view, MY_LIBRARY));
  expect(view.contentEl.textContent).not.toContain("in Zotero");
  expect(listRuns(run).at(-1)?.fields).not.toContain("lastActivitySource");
});

it.each([
  [
    { lastActivity: "2025-01-01T00:00:00Z", lastActivitySource: "added" },
    undefined,
    "added to Zotero 1 day ago",
  ],
  [
    { lastActivity: "2025-01-01T00:00:00Z", lastActivitySource: "note" },
    undefined,
    "notes edited in Zotero 1 day ago",
  ],
  [
    { lastActivity: "2025-01-01T00:00:00Z", lastActivitySource: "annotation" },
    undefined,
    "notes edited in Zotero 1 day ago",
  ],
  [
    { lastActivity: "2025-01-01T12:00:00Z", lastActivitySource: "read" },
    "opened",
    "read 12 hours ago in Zotero",
  ],
  [
    { lastActivity: "2025-01-01T00:00:00Z", lastActivitySource: "use" },
    "read",
    "read 1 day ago in Obsidian",
  ],
  [
    { lastActivity: "2025-01-01T00:00:00Z", lastActivitySource: "use" },
    "opened",
    "opened 1 day ago in Obsidian",
  ],
  [
    { lastActivity: "2025-01-01T00:00:00Z", lastActivitySource: "use" },
    "cited",
    "cited 1 day ago in Obsidian",
  ],
] as const)(
  "ends a Recent row with its winning activity %#",
  async (fields, kind, expected) => {
    const paper = await recentRow(fields, kind);
    const metadata = paper.querySelector("[data-query-papers-title]")!
      .parentElement!.children[1]!;
    expect(metadata.textContent.endsWith(expected)).toBe(true);
  },
);

it.each([
  [
    { lastActivity: "2024-12-01T00:00:00Z", lastActivitySource: "use" },
    "cited",
  ],
  [{ lastActivity: "invalid", lastActivitySource: "added" }, undefined],
] as const)("gives a Recent row no reason %#", async (fields, kind) => {
  const paper = await recentRow(fields, kind);
  expect(paper.textContent).not.toMatch(/ ago/);
});

async function recentRow(
  fields: Readonly<Record<string, string>>,
  kind: UseKind | undefined,
): Promise<Element> {
  const now = holdNow("2025-01-02T00:00:00Z");
  cleanup.defer(() => now.mockRestore());
  const { deps, change, uses } = await pluginData();
  const item = SEED[0]!;
  await change([{ ...item, fields }]);
  uses.current = kind
    ? { [item.key]: useAt(kind, "2025-01-01T00:00:00Z") }
    : {};
  const view = await openTab(deps);
  return view.contentEl.querySelector(`[data-query-papers-row="${item.key}"]`)!;
}

it("updates a Recent reason on a Use change without another list read", async () => {
  const now = holdNow("2025-01-02T00:00:00Z");
  cleanup.defer(() => now.mockRestore());
  const { deps, change, uses, setUse, run } = await pluginData();
  const item = SEED[0]!;
  const iso = "2025-01-01T00:00:00Z";
  await change([
    { ...item, fields: { lastActivity: iso, lastActivitySource: "use" } },
  ]);
  uses.current = { [item.key]: useAt("opened", iso) };
  const view = await openTab(deps);
  const before = listRuns(run).length;
  expect(itemRow(view, item.key).textContent).toContain(
    m.library_recent_opened({ time: "1 day ago" }),
  );
  await act(() => setUse(item.key, "cited", iso));
  expect(itemRow(view, item.key).textContent).toContain(
    m.library_recent_cited({ time: "1 day ago" }),
  );
  expect(listRuns(run)).toHaveLength(before);
});

it("opens on the document plugin data holds, once it has loaded", async () => {
  const { deps, run } = await pluginData({
    node: {
      kind: "collection",
      library: { type: "group", groupID: 4815 },
      path: ["Thesis"],
    },
    facets: [],
    search: "",
    sort: [{ property: "title", direction: "ASC" }],
  });
  await openTab(deps);
  expect(listRuns(run)).toHaveLength(1);
  expect(listRuns(run)[0]).toMatchObject({
    libraries: {
      mode: "selected",
      libraries: [{ type: "group", groupID: 4815 }],
    },
    filter: 'collections.within("Thesis")',
    sort: [{ field: "title", direction: "asc" }],
  });
});

it("opens on every field of the document plugin data holds that it can read, where one facet is unknown, and on Papers where an earlier build stored the Table", async () => {
  const { deps, run } = await pluginData({
    node: { kind: "library", library: PERSONAL },
    facets: ["annotated", "starred"],
    search: "",
    sort: [{ property: "title", direction: "ASC" }],
    layout: "table",
    order: ["title"],
  });
  const view = await openTab(deps);
  expect(listRuns(run).at(-1)).toMatchObject({
    libraries: { mode: "selected", libraries: [PERSONAL] },
    filter: "annotations.length > 0",
    sort: [{ field: "title", direction: "asc" }],
  });
  expect(view.query.state.getState().view?.type).toBe("papers");
  expect(view.query.state.getState().view?.order).toBeUndefined();
});

it("opens again on a sort the toolbar changed, and runs the query the toolbar ran", async () => {
  const { deps, run } = await pluginData();
  const first = await openTab(deps);
  await act(async () => {
    first.query.document.editView({
      sort: [{ property: "title", direction: "ASC" }],
    });
    await first.query.flush();
    await first.query.settled;
  });
  const changed = listRuns(run).at(-1)!;
  expect(changed.sort).toEqual([{ field: "title", direction: "asc" }]);
  await act(() => first.close());

  run.mockClear();
  await openTab(deps);
  expect(listRuns(run)).toEqual([changed]);
});

it("lists the libraries in the Library Scope with their Collections, each counting the Items of its subtree once", async () => {
  const { deps } = await pluginData();
  const view = await openTab(deps);
  expect(tree(view)).toEqual([
    "Recent",
    "My Library 5",
    "  Reading list 1",
    "  Thesis 3",
    "Lab 2",
    "  Thesis 1",
  ]);
});

it("opens a Collection to its subcollections, each counted alone", async () => {
  const { deps } = await pluginData();
  const view = await openTab(deps);
  await press(view, row(view, THESIS).querySelector("[data-library-expand]")!);
  expect(tree(view)).toEqual([
    "Recent",
    "My Library 5",
    "  Reading list 1",
    "  Thesis 3",
    "    Chapter 1 1",
    "    Chapter 2 2",
    "Lab 2",
    "  Thesis 1",
  ]);
});

it("keeps the nodes the researcher opens and closes in the document, and opens on them again", async () => {
  const { deps, settings } = await pluginData();
  const first = await openTab(deps);
  await press(
    first,
    row(first, THESIS).querySelector("[data-library-expand]")!,
  );
  await press(
    first,
    row(first, { kind: "library", library: LAB }).querySelector(
      "[data-library-expand]",
    )!,
  );
  await act(() => settings.bridge.runPromise(settings.flush));
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"]?.expanded,
  ).toEqual([
    JSON.stringify(["personal", "Thesis"]),
    `closed:${JSON.stringify(["group:4815"])}`,
  ]);
  await act(() => first.close());
  const view = await openTab(deps);
  expect(tree(view)).toEqual([
    "Recent",
    "My Library 5",
    "  Reading list 1",
    "  Thesis 3",
    "    Chapter 1 1",
    "    Chapter 2 2",
    "Lab 2",
  ]);
  await press(view, row(view, THESIS).querySelector("[data-library-expand]")!);
  await act(() => settings.bridge.runPromise(settings.flush));
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"]?.expanded,
  ).toEqual([`closed:${JSON.stringify(["group:4815"])}`]);
});

it("drops the open nodes Zotero no longer has from the document, and keeps the rest", async () => {
  const { deps, settings } = await pluginData({
    node: { kind: "recent" },
    expanded: [
      JSON.stringify(["personal", "Thesis"]),
      JSON.stringify(["personal", "Old name"]),
      JSON.stringify(["group:77", "Drafts"]),
    ],
  });
  const view = await openTab(deps);
  expect(tree(view)).toContain("    Chapter 1 1");
  await act(() => settings.bridge.runPromise(settings.flush));
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"]?.expanded,
  ).toEqual([
    JSON.stringify(["personal", "Thesis"]),
    JSON.stringify(["group:77", "Drafts"]),
  ]);
});

it("lists a Collection with its subcollections' Items, names it in the header, and keeps it", async () => {
  const { deps, run, settings } = await pluginData();
  const view = await openTab(deps);
  await press(view, row(view, THESIS));
  expect(listRuns(run).at(-1)).toMatchObject({
    libraries: { mode: "selected", libraries: [PERSONAL] },
    filter: 'collections.within("Thesis")',
  });
  expect(row(view, THESIS).getAttribute("aria-selected")).toBe("true");
  expect(header(view)).toBe("My Library› | Thesis | 3 papers · 1 unread");
  await settings.bridge.runPromise(settings.flush);
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"]?.node,
  ).toEqual(THESIS);
});

it("lists a group library on its own, with no filter", async () => {
  const { deps, run } = await pluginData();
  const view = await openTab(deps);
  await press(view, row(view, THESIS));
  await press(view, row(view, { kind: "library", library: LAB }));
  const last = listRuns(run).at(-1)!;
  expect(last.libraries).toEqual({ mode: "selected", libraries: [LAB] });
  expect(last).not.toHaveProperty("filter");
  expect(header(view)).toBe("Lab | 2 papers · 2 unread");
});

it("shows the libraries outside the Library Scope on request, and lists one", async () => {
  const { deps, run } = await pluginData();
  const view = await openTab(deps);
  const all = () =>
    view.contentEl.querySelector<HTMLElement>("[data-library-all]")!;
  expect(all().textContent).toBe("Show all libraries");
  expect(all().previousElementSibling?.getAttribute("role")).toBe("tree");
  await press(view, all());
  expect(tree(view)).toEqual([
    "Recent",
    "My Library 5",
    "  Reading list 1",
    "  Thesis 3",
    "Lab 2",
    "  Thesis 1",
    "Archive 1",
  ]);
  await press(view, row(view, { kind: "library", library: ARCHIVE }));
  expect(listRuns(run).at(-1)!.libraries).toEqual({
    mode: "selected",
    libraries: [ARCHIVE],
  });
  await act(() =>
    view.contentEl
      .querySelector<HTMLElement>('[data-query-expand="item:HHHHHHHH"]')!
      .click(),
  );
  await vi.waitFor(() =>
    expect(
      view.contentEl.querySelector('[data-query-papers-child="attachment"]')
        ?.textContent,
    ).toBe("HPDFHPDF"),
  );
  expect(all().textContent).toBe("Hide other libraries");
  await press(view, all());
  expect(tree(view).at(-1)).toBe("Archive 1");
});

it("lets go of Show all libraries once the Library Scope holds every Library, and offers it again when the scope narrows", async () => {
  const { deps, rescope } = await pluginData();
  const view = await openTab(deps);
  const all = () =>
    view.contentEl.querySelector<HTMLElement>("[data-library-all]");
  await press(view, all()!);
  expect(all()?.dataset.libraryAll).toBe("on");
  await act(async () => {
    await rescope(LIBRARIES);
    await view.tree.settled;
  });
  expect(all()).toBeNull();
  await act(async () => {
    await rescope(LIBRARIES.slice(0, 1));
    await view.tree.settled;
  });
  expect(all()?.dataset.libraryAll).toBe("off");
  expect(tree(view)).not.toContain("Archive 1");
});

it("opens again on the node the tree selected", async () => {
  const { deps, run } = await pluginData();
  const first = await openTab(deps);
  await press(first, row(first, { kind: "library", library: LAB }));
  const selected = listRuns(run).at(-1)!;
  await act(() => first.close());
  run.mockClear();
  const view = await openTab(deps);
  expect(listRuns(run)).toEqual([selected]);
  expect(header(view)).toBe("Lab | 2 papers · 2 unread");
});

it("counts again after a database change", async () => {
  const { deps, change } = await pluginData();
  const view = await openTab(deps);
  await act(async () => {
    await change([
      ...SEED,
      { key: "JJJJJJJJ", libraryID: 1, collections: ["Thesis/Chapter 1"] },
    ]);
    await view.tree.settled;
  });
  expect(tree(view).slice(0, 4)).toEqual([
    "Recent",
    "My Library 6",
    "  Reading list 1",
    "  Thesis 4",
  ]);
});

it("moves the selection up to its library where Zotero no longer has the Collection", async () => {
  const { deps, run, settings } = await pluginData({
    node: { kind: "collection", library: PERSONAL, path: ["Old name"] },
    facets: [],
    search: "",
    sort: [{ property: "dateModified", direction: "DESC" }],
  });
  const view = await openTab(deps);
  await act(() => view.query.settled);
  expect(listRuns(run).at(-1)).not.toHaveProperty("filter");
  expect(header(view)).toBe("My Library | 5 papers · 2 unread");
  await settings.bridge.runPromise(settings.flush);
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"]?.node,
  ).toEqual({
    kind: "library",
    library: PERSONAL,
  });
});

it("names the tree and the facets for a screen reader, with no tooltip over them", async () => {
  const { deps } = await pluginData();
  const view = await openTab(deps);
  const pane = view.contentEl.querySelector("[data-library-tree]")!;
  expect(
    pane.querySelectorAll("[aria-label]:not([data-library-tree-resizer])"),
  ).toHaveLength(0);
  expect(accessibleName(pane.querySelector("nav")!)).toBe("");
  expect(accessibleName(pane.querySelector("[role=tree]")!)).toBe("Libraries");
  expect(accessibleName(pane.querySelector("[role=group]")!)).toBe(
    m.library_view_facets_label(),
  );
});

it("collapses the tree beside a wide list from its button, pressed while it shows, and keeps it collapsed when the tab opens again", async () => {
  const { deps, settings } = await pluginData();
  const first = await openTab(deps);
  const collapse = (view: LibraryView) =>
    view.contentEl.querySelector<HTMLElement>("[data-library-tree-collapse]")!;
  const shell = (view: LibraryView) =>
    view.contentEl.querySelector("[data-library-shell]")!;
  expect(collapse(first).getAttribute("aria-pressed")).toBe("true");
  await press(first, collapse(first));
  expect(shell(first).hasAttribute("data-tree-collapsed")).toBe(true);
  expect(collapse(first).getAttribute("aria-pressed")).toBe("false");
  await act(() => settings.bridge.runPromise(settings.flush));
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"]
      ?.treeCollapsed,
  ).toBe(true);
  await act(() => first.close());
  const view = await openTab(deps);
  expect(shell(view).hasAttribute("data-tree-collapsed")).toBe(true);
  await press(view, collapse(view));
  expect(shell(view).hasAttribute("data-tree-collapsed")).toBe(false);
});

it("puts the open tree away on Escape from inside it, on a Scope above the list's", async () => {
  const { deps } = await pluginData();
  const app = keymapApp();
  Object.assign(deps.app, { keymap: app.keymap });
  const view = await openTab(deps);
  const pane = view.contentEl.querySelector<HTMLElement>(
    "[data-library-tree]",
  )!;
  const shell = view.contentEl.querySelector("[data-library-shell]")!;
  const escape = async (target: Element, init: KeyboardEventInit = {}) => {
    let event: KeyboardEvent | undefined;
    await act(() => {
      event = pressTop(app, { key: "Escape", ...init }, target);
    });
    return event!;
  };

  row(view, THESIS).dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  expect(app.scopes).toEqual([]);

  await press(
    view,
    view.contentEl.querySelector<HTMLElement>("[data-library-tree-toggle]")!,
  );
  expect(shell.hasAttribute("data-tree-open")).toBe(true);
  row(view, THESIS).dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  expect(app.scopes).toHaveLength(1);

  await act(() => view.tree.setTagFilter("method"));
  const filter = pane.querySelector<HTMLInputElement>(
    "[data-library-tags-filter]",
  )!;
  expect((await escape(filter)).defaultPrevented).toBe(true);
  expect(view.tree.state.tagFilter).toBe("");
  expect(shell.hasAttribute("data-tree-open")).toBe(true);

  await escape(row(view, THESIS), { isComposing: true });
  expect(shell.hasAttribute("data-tree-open")).toBe(true);

  expect((await escape(row(view, THESIS))).defaultPrevented).toBe(true);
  expect(shell.hasAttribute("data-tree-open")).toBe(false);
  expect(app.scopes).toEqual([]);
});

it("says where Zotero's data folder cannot be found, offers to locate it, and lists the papers once it is set", async () => {
  const { deps, lose, locate, setupActions } = await pluginData();
  await lose();
  const view = await openTab(deps);
  const shell = view.contentEl.querySelector("[data-library-shell]")!;
  const notFound = (part: "tree" | "list") =>
    view.contentEl.querySelector<HTMLElement>(
      `[data-library-not-found="${part}"]`,
    )!;
  expect(shell.hasAttribute("data-zotero-missing")).toBe(true);
  expect(notFound("tree").textContent).toBe("Zotero not found");
  expect(notFound("tree").querySelectorAll("button")).toHaveLength(0);
  expect(notFound("list").querySelector('[role="heading"]')?.textContent).toBe(
    "Zotero not found",
  );
  expect(notFound("list").closest("[data-pane-state]")).not.toBeNull();
  expect(notFound("tree").closest("[data-pane-state]")).toBeNull();
  const toggle = view.contentEl.querySelector<HTMLElement>(
    "[data-library-tree-toggle]",
  )!;
  await press(view, toggle);
  expect(shell.hasAttribute("data-tree-open")).toBe(true);
  expect(notFound("tree").textContent).toBe("Zotero not found");
  const button = (part: "tree" | "list", text: string) =>
    [...notFound(part).querySelectorAll("button")].find(
      (el) => el.textContent === text,
    )!;
  await press(view, button("list", "Locate data folder"));
  await press(view, button("list", "Open settings"));
  expect(setupActions.locateZotero).toHaveBeenCalledOnce();
  expect(setupActions.openSettings).toHaveBeenCalledOnce();
  expect(view.contentEl.textContent).not.toMatch(/Better BibTeX/);

  await act(async () => {
    await locate();
    await view.tree.settled;
    await view.query.settled;
  });
  expect(shell.hasAttribute("data-zotero-missing")).toBe(false);
  expect(tree(view)).toContain("My Library 5");
});

it("keeps the last rows with a note where a refresh of the database fails, and drops the note once it reads again", async () => {
  const { deps, refreshFails, locate } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  const rows = shown(view);
  const shell = view.contentEl.querySelector("[data-library-shell]")!;
  const note = () =>
    view.contentEl.querySelector<HTMLElement>("[data-library-refresh-failed]");
  await act(async () => {
    await refreshFails();
    await view.query.settled;
  });
  expect(shell.hasAttribute("data-zotero-missing")).toBe(false);
  expect(shown(view)).toEqual(rows);
  expect(note()?.textContent).toContain("Couldn't refresh from Zotero");
  await act(async () => {
    await locate();
    await view.query.settled;
  });
  expect(note()).toBeNull();
});

it("says Zotero is not found where the data folder changes to one that does not read, though the earlier database still serves", async () => {
  const { deps, moveFails } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  const shell = view.contentEl.querySelector("[data-library-shell]")!;
  await act(async () => {
    await moveFails();
    await view.query.settled;
  });
  expect(shell.hasAttribute("data-zotero-missing")).toBe(true);
  expect(
    view.contentEl.querySelector("[data-library-refresh-failed]"),
  ).toBeNull();
});

it("reads the new Library Scope on Recent once the researcher changes it", async () => {
  const { deps, run, rescope } = await pluginData();
  const view = await openTab(deps);
  await act(async () => {
    await rescope([LIBRARIES[1]!]);
    await view.query.settled;
  });
  expect(listRuns(run).at(-1)!.libraries).toEqual({
    mode: "selected",
    libraries: [LAB],
  });
});

it("reads the saved Library Scope on Recent where the database holds none of its Libraries, so the view names the one missing", async () => {
  const { deps, run, rescope } = await pluginData();
  const view = await openTab(deps);
  await act(async () => {
    await rescope([], [GONE]);
    await view.query.settled;
  });
  expect(listRuns(run).at(-1)!.libraries).toEqual({
    mode: "selected",
    libraries: [GONE],
  });
});

it("keeps Recent selected through a sort change, and selecting it again sorts newest activity first", async () => {
  const { deps, run, settings } = await pluginData();
  const view = await openTab(deps);
  await act(async () => {
    view.query.document.editView({
      sort: [{ property: "title", direction: "ASC" }],
    });
    await view.query.flush();
    await view.query.settled;
  });
  expect(row(view, RECENT).getAttribute("aria-selected")).toBe("true");
  expect(listRuns(run).at(-1)!.sort).toEqual([
    { field: "title", direction: "asc" },
  ]);
  await press(view, row(view, { kind: "library", library: LAB }));
  expect(listRuns(run).at(-1)!.sort).toEqual([
    { field: "title", direction: "asc" },
  ]);
  await press(view, row(view, RECENT));
  expect(listRuns(run).at(-1)).toMatchObject({
    libraries: { mode: "selected", libraries: [PERSONAL, LAB] },
    sort: [{ field: "lastActivity", direction: "desc" }],
  });
  expect(header(view)).toBe("Recent | 7 papers");
  await settings.bridge.runPromise(settings.flush);
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"],
  ).toMatchObject({
    node: RECENT,
    sort: [{ property: "lastActivity", direction: "DESC" }],
  });
});

it("marks the Sort button as set only for a sort other than the one the selected node writes", async () => {
  const { deps, run, settings } = await pluginData();
  const view = await openTab(deps);
  const sort = () => {
    const button = view.contentEl.querySelector<HTMLElement>(
      '[data-query-toolbar="sort"]',
    )!;
    return {
      set: button.hasAttribute("data-active"),
      text: button.textContent,
    };
  };
  expect(sort()).toEqual({ set: false, text: "Sort" });
  await act(async () => {
    view.query.document.editView({
      sort: [{ property: "title", direction: "ASC" }],
    });
    await view.query.flush();
    await view.query.settled;
  });
  expect(sort()).toEqual({ set: true, text: "Sort1" });
  await press(view, row(view, RECENT));
  expect(sort()).toEqual({ set: false, text: "Sort" });
  await press(view, row(view, { kind: "library", library: LAB }));
  expect(sort()).toEqual({ set: false, text: "Sort" });
  expect(listRuns(run).at(-1)).not.toHaveProperty("sort");
  await settings.bridge.runPromise(settings.flush);
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"],
  ).toMatchObject({
    node: { kind: "library", library: LAB },
    sort: [],
  });
});

it("keeps a sort the researcher changed on Recent once they leave it", async () => {
  const { deps, run, settings } = await pluginData();
  const view = await openTab(deps);
  await act(async () => {
    view.query.document.editView({
      sort: [{ property: "title", direction: "ASC" }],
    });
    await view.query.flush();
    await view.query.settled;
  });
  await press(view, row(view, { kind: "library", library: LAB }));
  expect(
    view.contentEl
      .querySelector('[data-query-toolbar="sort"]')!
      .hasAttribute("data-active"),
  ).toBe(true);
  expect(listRuns(run).at(-1)!.sort).toEqual([
    { field: "title", direction: "asc" },
  ]);
  await settings.bridge.runPromise(settings.flush);
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"],
  ).toMatchObject({
    node: { kind: "library", library: LAB },
    sort: [{ property: "title", direction: "ASC" }],
  });
});

it("marks the Sort button again on a switch between Recent and My Library that leaves the query text as it was", async () => {
  const { deps, rescope } = await pluginData({
    ...ON_MY_LIBRARY,
    sort: [{ property: "lastActivity", direction: "DESC" }],
  });
  const view = await openTab(deps);
  await act(async () => {
    await rescope([LIBRARIES[0]!]);
    await view.query.settled;
  });
  const set = () =>
    view.contentEl
      .querySelector('[data-query-toolbar="sort"]')!
      .hasAttribute("data-active");
  const text = view.query.document.text;
  expect(set()).toBe(true);
  await press(view, row(view, RECENT));
  expect(view.query.document.text).toBe(text);
  expect(set()).toBe(false);
});

function sortTwice(view: LibraryView) {
  view.query.document.editView({
    sort: [{ property: "title", direction: "ASC" }],
  });
  view.query.document.editView({
    sort: [{ property: "title", direction: "DESC" }],
  });
}

it("selects Recent with its own sort after two quick sorts, on screen and in plugin data", async () => {
  const { deps, run, settings } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  await act(async () => {
    sortTwice(view);
    row(view, RECENT).click();
    await view.query.flush();
    await view.searched;
    await view.query.settled;
  });
  expect(listRuns(run).at(-1)!.sort).toEqual([
    { field: "lastActivity", direction: "desc" },
  ]);
  await settings.bridge.runPromise(settings.flush);
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"],
  ).toMatchObject({
    node: RECENT,
    sort: [{ property: "lastActivity", direction: "DESC" }],
  });
});

it("keeps the last of two quick sorts once the search is cleared", async () => {
  const { deps, run, settings } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  await type(view, "figures");
  await act(async () => {
    sortTwice(view);
    view.search.clear();
    await view.query.flush();
    await view.searched;
    await view.query.settled;
  });
  expect(listRuns(run).at(-1)!.sort).toEqual([
    { field: "title", direction: "desc" },
  ]);
  await settings.bridge.runPromise(settings.flush);
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"],
  ).toMatchObject({
    sort: [{ property: "title", direction: "DESC" }],
  });
});

it("reads only the Library Scope on Recent while the tree shows every Library", async () => {
  const { deps, run } = await pluginData();
  const view = await openTab(deps);
  await press(
    view,
    view.contentEl.querySelector<HTMLElement>("[data-library-all]")!,
  );
  await press(view, row(view, RECENT));
  expect(listRuns(run).at(-1)!.libraries).toEqual({
    mode: "selected",
    libraries: [PERSONAL, LAB],
  });
});

function listed(view: LibraryView) {
  return [
    ...view.contentEl.querySelectorAll<HTMLElement>("[data-query-papers-row]"),
  ].map((el) => el.dataset.queryPapersRow);
}

function facet(view: LibraryView, id: string): HTMLElement {
  const found = view.contentEl.querySelector<HTMLElement>(
    `[data-library-facet="${id}"]`,
  );
  if (!found) throw new Error(`No facet ${id}`);
  return found;
}

describe("Reading State facets", () => {
  it.each([
    ["unread", ["BBBBBBBB", "EEEEEEEE"]],
    ["annotated", ["AAAAAAAA", "CCCCCCCC"]],
    ["has-note", ["AAAAAAAA", "DDDDDDDD"]],
    ["pdf", ["AAAAAAAA", "BBBBBBBB"]],
  ])("narrows My Library to the Items %s holds", async (id, keys) => {
    const { deps } = await pluginData();
    const view = await openTab(deps);
    await press(view, row(view, MY_LIBRARY));
    expect(listed(view)).toEqual([
      "AAAAAAAA",
      "BBBBBBBB",
      "CCCCCCCC",
      "DDDDDDDD",
      "EEEEEEEE",
    ]);
    await press(view, facet(view, id));
    expect(facet(view, id).getAttribute("aria-pressed")).toBe("true");
    expect(listed(view)).toEqual(keys);
    expect(header(view)).toBe("My Library | 2 of 5 papers · 2 unread");
    await press(view, facet(view, id));
    expect(listed(view)).toHaveLength(5);
  });

  it("narrows Recent, over every Library in the Library Scope", async () => {
    const { deps, run } = await pluginData();
    const view = await openTab(deps);
    await press(view, facet(view, "unread"));
    expect(listRuns(run).at(-1)).toMatchObject({
      libraries: { mode: "selected", libraries: [PERSONAL, LAB] },
      filter: expect.stringContaining("annotations.isEmpty()"),
    });
    expect(listed(view)).toEqual([
      "BBBBBBBB",
      "EEEEEEEE",
      "FFFFFFFF",
      "GGGGGGGG",
    ]);
  });

  it("combines with the Collection selected and with each other", async () => {
    const { deps } = await pluginData();
    const view = await openTab(deps);
    await press(view, row(view, THESIS));
    await press(view, facet(view, "pdf"));
    expect(listed(view)).toEqual(["AAAAAAAA", "BBBBBBBB"]);
    await press(view, facet(view, "has-note"));
    expect(listed(view)).toEqual(["AAAAAAAA"]);
  });

  it("counts the node's papers of each facet in one line of the item details while no paper is selected, Recent over the Library Scope, and leaves out a facet none passes", async () => {
    const { deps } = await pluginData();
    const view = await openTab(deps);
    const stats = () =>
      [
        ...view.contentEl.querySelectorAll<HTMLElement>(
          "[data-library-card-stat]",
        ),
      ].map((el) => el.textContent);
    await vi.waitFor(() =>
      expect(stats()).toEqual([
        "Unread 4",
        "Annotated 2",
        "Has note 2",
        "PDF 2",
      ]),
    );
    await press(view, row(view, MY_LIBRARY));
    await vi.waitFor(() =>
      expect(stats()).toEqual([
        "Unread 2",
        "Annotated 2",
        "Has note 2",
        "PDF 2",
      ]),
    );
    await press(view, row(view, { kind: "library", library: LAB }));
    await vi.waitFor(() => expect(stats()).toEqual(["Unread 2"]));
    await act(async () => {
      itemRow(view, "FFFFFFFF").click();
      await view.card.settled;
    });
    expect(stats()).toEqual([]);
  });

  it("counts the unread Items of the selection in the header, once the vault answers for their notes", async () => {
    const { deps, addNote } = await pluginData();
    const view = await openTab(deps);
    expect(header(view)).toBe("Recent | 7 papers");
    await press(view, row(view, MY_LIBRARY));
    expect(header(view)).toBe("My Library | 5 papers · 2 unread");
    await press(view, row(view, THESIS));
    expect(header(view)).toBe("My Library› | Thesis | 3 papers · 1 unread");
    await press(view, facet(view, "unread"));
    expect(listed(view)).toEqual(["BBBBBBBB"]);
    await act(async () => {
      await addNote("BBBBBBBB");
      await view.query.settled;
      await view.tree.settled;
    });
    expect(listed(view)).toEqual([]);
    expect(header(view)).toBe("My Library› | Thesis | 0 of 3 papers");
  });

  it("opens again with the facets the researcher left on", async () => {
    const { deps, settings } = await pluginData();
    const first = await openTab(deps);
    await press(first, facet(first, "pdf"));
    await press(first, facet(first, "annotated"));
    await settings.bridge.runPromise(settings.flush);
    expect(
      settings.bridge.runSync(settings.current)?.["library.document"]?.facets,
    ).toEqual(["annotated", "pdf"]);
    await act(() => first.close());

    const view = await openTab(deps);
    expect(facet(view, "annotated").getAttribute("aria-pressed")).toBe("true");
    expect(facet(view, "pdf").getAttribute("aria-pressed")).toBe("true");
    expect(facet(view, "unread").getAttribute("aria-pressed")).toBe("false");
    expect(listed(view)).toEqual(["AAAAAAAA"]);
  });
});

function itemRows(view: LibraryView): string[] {
  return [
    ...view.contentEl.querySelectorAll<HTMLElement>("[data-query-item-row]"),
  ].map(
    (el) =>
      `${el.dataset.queryItemRow}${el.hasAttribute("data-selected") ? " *" : ""}`,
  );
}

function itemRow(view: LibraryView, key: string): HTMLElement {
  const found = view.contentEl.querySelector<HTMLElement>(
    `[data-query-item-row="${key}"]`,
  );
  if (!found) throw new Error(`No Item row for ${key}`);
  return found;
}

async function pressKey(
  view: LibraryView,
  target: Element,
  [key, modifiers = []]: [key: string, modifiers?: string[]],
): Promise<boolean> {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: modifiers.includes("Mod"),
    shiftKey: modifiers.includes("Shift"),
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "target", { value: target });
  const { handlers } = view.scope as unknown as {
    handlers: {
      modifiers: string[] | null;
      key: string | null;
      func: (event: KeyboardEvent) => unknown;
    }[];
  };
  let handled = false;
  await act(() => {
    for (const handler of handlers) {
      const fits =
        (handler.key === null || handler.key === key) &&
        (handler.modifiers === null ||
          handler.modifiers.join() === modifiers.join());
      if (fits && handler.func(event) === false) {
        handled = true;
        return;
      }
    }
  });
  return handled;
}

const A = "AAAAAAAA";
const B = "BBBBBBBB";
const C = "CCCCCCCC";
const D = "DDDDDDDD";
const E = "EEEEEEEE";

it("expands a paper whose only child is its Literature Note, to that note", async () => {
  const { deps } = await pluginData();
  const view = await openTab(deps);
  await act(() =>
    view.contentEl
      .querySelector<HTMLElement>('[data-query-expand="item:DDDDDDDD"]')!
      .click(),
  );
  expect(
    view.contentEl
      .querySelector('[data-query-papers-row="DDDDDDDD"]')!
      .querySelector('[data-query-papers-child="literature-note"]')
      ?.textContent,
  ).toContain("DDDDDDDD");
});

it("selects a row on a click and moves the selection with the arrow keys", async () => {
  const { deps, items } = await pluginData();
  const view = await openTab(deps);
  expect(itemRows(view)).toEqual([
    A,
    B,
    C,
    "DDDDDDDD",
    "EEEEEEEE",
    "FFFFFFFF",
    "GGGGGGGG",
  ]);
  await act(() => itemRow(view, B).click());
  expect(itemRows(view).slice(0, 3)).toEqual([A, `${B} *`, C]);
  expect(items.openNote).not.toHaveBeenCalled();
  expect(items.openPdf).not.toHaveBeenCalled();
  expect(await pressKey(view, itemRow(view, B), ["ArrowDown"])).toBe(true);
  expect(itemRows(view).slice(0, 3)).toEqual([A, B, `${C} *`]);
  expect(await pressKey(view, itemRow(view, C), ["ArrowUp"])).toBe(true);
  expect(await pressKey(view, itemRow(view, B), ["ArrowUp"])).toBe(true);
  expect(itemRows(view).slice(0, 3)).toEqual([`${A} *`, B, C]);
});

it("lets the keyboard enter the list at its first row while none is selected, and names the selected row to assistive technology", async () => {
  const { deps } = await pluginData();
  const view = await openTab(deps);
  const stops = () =>
    [...view.contentEl.querySelectorAll<HTMLElement>("[data-query-item-row]")]
      .filter((el) => el.tabIndex === 0)
      .map((el) => el.dataset.queryItemRow);
  expect(stops()).toEqual([A]);
  await act(() => itemRow(view, C).click());
  expect(stops()).toEqual([C]);
  expect(itemRow(view, C).getAttribute("aria-current")).toBe("true");
  expect(itemRow(view, A).hasAttribute("aria-current")).toBe(false);
  expect(itemRow(view, C).getAttribute("role")).toBe("group");
  expect(itemRow(view, C).hasAttribute("aria-label")).toBe(false);
  expect(accessibleName(itemRow(view, C))).toBe("Figures that work");
});

it("selects the row the keyboard enters the list at, so its keys act on it", async () => {
  const { deps, items } = await pluginData();
  const view = await openTab(deps);
  await act(() => itemRow(view, A).focus());
  expect(view.selected).toEqual({ key: A });
  expect(await pressKey(view, itemRow(view, A), ["Enter"])).toBe(true);
  expect(items.openNote).toHaveBeenLastCalledWith(A, false);
  expect(await pressKey(view, itemRow(view, A), [" "])).toBe(true);
  expect(view.selected).toEqual({ key: A });
});

it("selects a row whose expand button is clicked", async () => {
  const { deps } = await pluginData();
  const view = await openTab(deps);
  const expand = itemRow(view, A).querySelector<HTMLElement>(
    "button[data-query-expand]",
  )!;
  await act(() => expand.click());
  expect(view.selected).toEqual({ key: A });
});

it("answers the quick switcher's keys on the selected row: Enter the note, Mod+Enter the note in a new pane, Shift+Enter the PDF", async () => {
  const { deps, items } = await pluginData();
  const view = await openTab(deps);
  await act(() => itemRow(view, B).click());
  const row = itemRow(view, B);
  expect(await pressKey(view, row, ["Enter"])).toBe(true);
  expect(items.openNote).toHaveBeenLastCalledWith(B, false);
  expect(await pressKey(view, row, ["Enter", ["Mod"]])).toBe(true);
  expect(items.openNote).toHaveBeenLastCalledWith(B, "tab");
  expect(await pressKey(view, row, ["Enter", ["Shift"]])).toBe(true);
  expect(items.openPdf).toHaveBeenLastCalledWith(B, false);
  expect(await pressKey(view, row, ["Enter", ["Mod", "Shift"]])).toBe(true);
  expect(items.openPdf).toHaveBeenLastCalledWith(B, "tab");
  expect(items.openNote).toHaveBeenCalledTimes(2);
  expect(items.openPdf).toHaveBeenCalledTimes(2);
});

it("leaves Enter and the arrow keys to a field, a button and the Library Tree", async () => {
  const { deps, items } = await pluginData();
  const view = await openTab(deps);
  await act(() => itemRow(view, B).click());
  const field = view.contentEl.createEl("input");
  const button =
    itemRow(view, B).querySelector("button") ??
    view.contentEl.createEl("button");
  const tree = view.contentEl.querySelector("[role=tree] [data-library-node]")!;
  for (const target of [field, button, tree]) {
    expect(await pressKey(view, target, ["Enter"])).toBe(false);
    expect(await pressKey(view, target, ["ArrowDown"])).toBe(false);
  }
  expect(items.openNote).not.toHaveBeenCalled();
  expect(itemRows(view)[1]).toBe(`${B} *`);
});

it("opens the PDF on a double click", async () => {
  const { deps, items } = await pluginData();
  const view = await openTab(deps);
  await act(() => {
    itemRow(view, C).dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true }),
    );
  });
  expect(items.openPdf).toHaveBeenCalledExactlyOnceWith(C, false);
});

it("lists the row's actions in its menu, which other plugins add to", async () => {
  const { deps, items } = await pluginData();
  const trigger = vi.fn();
  deps.app.workspace.trigger = trigger;
  const view = await openTab(deps);
  await act(() => {
    itemRow(view, B).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  });
  const menu = Menu.instances.at(-1)!;
  expect(menu.items.map((item) => [item.section, item.title])).toEqual([
    ["open", "Open PDF"],
    ["open", "Open PDF to the right"],
    ["open", "Write literature note"],
    ["insert", "Insert citation"],
    ["clipboard", "Copy citation key"],
    ["zotero", "Show in Zotero"],
  ]);
  expect(menu.items.every((item) => item.icon !== null)).toBe(true);
  expect(trigger).toHaveBeenCalledExactlyOnceWith("zotlit:item-menu", menu, {
    source: "library-view",
    indexedKey: B,
  });
  expect(itemRows(view)[1]).toBe(`${B} *`);
  expect(view.selected).toEqual({ key: B });
  menu.items[1]!.click();
  expect(items.openPdf).toHaveBeenCalledExactlyOnceWith(B, "split");
  menu.items[5]!.click();
  expect(items.showInZotero).toHaveBeenCalledExactlyOnceWith(B);
});

it("offers no PDF to open in the menu of a row whose Item has no PDF", async () => {
  const { deps } = await pluginData();
  deps.app.workspace.trigger = vi.fn();
  const view = await openTab(deps);
  await act(() => {
    itemRow(view, C).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  });
  expect(Menu.instances.at(-1)!.items.map((item) => item.title)).toEqual([
    "Write literature note",
    "Insert citation",
    "Copy citation key",
    "Show in Zotero",
  ]);
});

it("shows an Item in its first Collection, selected, with its Reading Card", async () => {
  const { deps, run } = await pluginData();
  const view = await openTab(deps);
  await act(async () => {
    await view.reveal(A);
  });
  expect(listRuns(run).at(-1)).toMatchObject({
    libraries: { mode: "selected", libraries: [PERSONAL] },
    filter: 'collections.within("Thesis/Chapter 1")',
  });
  expect(header(view)).toBe("My Library›Thesis› | Chapter 1 | 1 paper");
  expect(itemRows(view)).toContain(`${A} *`);
  expect(view.selected).toEqual({ key: A });
});

it("flashes the row it shows until the flash ends, and again on the next Show in Library", async () => {
  const { deps } = await pluginData();
  const view = await openTab(deps);
  await act(async () => {
    await view.reveal(A);
  });
  const row = itemRow(view, A);
  expect(row.hasAttribute("data-revealed")).toBe(true);
  row.dispatchEvent(new Event("animationend", { bubbles: true }));
  expect(row.hasAttribute("data-revealed")).toBe(false);

  await act(async () => {
    await view.reveal(A);
  });
  expect(itemRow(view, A).hasAttribute("data-revealed")).toBe(true);
});

it("turns the Reading State facets off to show an Item they leave out", async () => {
  const { deps, run, settings } = await pluginData();
  const view = await openTab(deps);
  await press(view, facet(view, "unread"));
  await press(view, facet(view, "pdf"));
  await act(async () => {
    await view.reveal(A);
  });
  expect(listRuns(run).at(-1)).toMatchObject({
    filter: 'collections.within("Thesis/Chapter 1")',
  });
  expect(facet(view, "unread").getAttribute("aria-pressed")).toBe("false");
  expect(facet(view, "pdf").getAttribute("aria-pressed")).toBe("false");
  expect(itemRows(view)).toContain(`${A} *`);
  await settings.bridge.runPromise(settings.flush);
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"]?.facets,
  ).toEqual([]);
});

it("says it cannot show an Item past the rows the list holds, and selects nothing", async () => {
  const { deps, change } = await pluginData();
  const octal = (n: number) =>
    Array.from(n.toString(8).padStart(6, "0"))
      .map((digit) => "ABCDEFGH"[Number(digit)])
      .join("");
  const many = Array.from({ length: 1000 }, (_, n) => ({
    key: `ZZ${octal(n)}`,
    libraryID: 1,
    collections: [] as string[],
  }));
  await change([...many, { key: "YYYYYYYY", libraryID: 1, collections: [] }]);
  const view = await openTab(deps);
  for (const _ of [1, 2]) {
    let outcome: unknown;
    await act(async () => {
      outcome = await view.reveal("YYYYYYYY");
    });
    expect(outcome).toBe("not-listed");
    expect(view.selected).toEqual({ key: null });
  }
});

it.each([
  ["a key no Library holds", "QQQQQQQQ"],
  ["a group outside the Library Scope", "QQQQQQQQg999"],
])(
  "says it cannot find %s, and keeps the search and facets",
  async (_, indexedKey) => {
    const { deps } = await pluginData();
    const view = await openTab(deps);
    await press(view, facet(view, "pdf"));
    await type(view, "kernel");
    let outcome: unknown;
    await act(async () => {
      outcome = await view.reveal(indexedKey);
    });
    expect(outcome).toBe("not-found");
    expect(searchBox(view).value).toBe("kernel");
    expect(facet(view, "pdf").getAttribute("aria-pressed")).toBe("true");
  },
);

it("shows an Item filed in no Collection in its Library", async () => {
  const { deps, run } = await pluginData();
  const view = await openTab(deps);
  await press(view, row(view, THESIS));
  await act(async () => {
    await view.reveal("EEEEEEEE");
  });
  expect(listRuns(run).at(-1)!.libraries).toEqual({
    mode: "selected",
    libraries: [PERSONAL],
  });
  expect(listRuns(run).at(-1)).not.toHaveProperty("filter");
  expect(itemRows(view)).toContain("EEEEEEEE *");
});

const ON_MY_LIBRARY = {
  node: { kind: "library", library: PERSONAL },
  facets: [],
  search: "",
  sort: [{ property: "dateModified", direction: "DESC" }],
};

function searchAll(view: LibraryView) {
  return view.contentEl.querySelector<HTMLElement>("[data-library-search-all]");
}

function searchBox(view: LibraryView): HTMLInputElement {
  return view.contentEl.querySelector("[data-library-search] input")!;
}

async function type(view: LibraryView, text: string) {
  await act(async () => {
    const input = searchBox(view);
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await view.searched;
    await view.query.settled;
  });
}

function shown(view: LibraryView) {
  return (view.query.state.getState().results?.rows ?? []).map(
    (r) => r.indexedKey,
  );
}

it("offers no toolbar search of the rows on screen beside its own search box", async () => {
  const { deps } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  expect(
    view.contentEl.querySelector('[data-query-toolbar="search"]'),
  ).toBeNull();
});

it("keeps Sort in place but off while a search lists its hits in rank order, and turns it on again once the search is cleared", async () => {
  const { deps } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  const sort = () =>
    view.contentEl.querySelector<HTMLElement>('[data-query-toolbar="sort"]');
  const state = () =>
    sort() === null
      ? "gone"
      : sort()!.getAttribute("aria-disabled") === "true"
        ? "off"
        : "on";
  expect(state()).toBe("on");
  await type(view, "figures");
  expect(state()).toBe("off");
  expect(sort()!.getAttribute("aria-label")).toBe(m.query_view_sort_ranked());
  await act(() => sort()!.click());
  expect(document.querySelector('[data-query-popover="sort"]')).toBeNull();
  await type(view, "");
  expect(state()).toBe("on");
});

async function bringForward(view: LibraryView) {
  const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
    view,
    updateHeader: () => {},
  });
  await openLibraryView(
    stubService<App>("App", {
      workspace: stubService<App["workspace"]>("Workspace", {
        getLeavesOfType: () => [leaf],
        setActiveLeaf: () => {},
        revealLeaf: () => Promise.resolve(),
      }),
    }),
  );
}

it("has the search box focused when the command brings the tab forward", async () => {
  const { deps, host } = await pluginData();
  host.vault.addFile("literatures/Paper.md", "");
  const view = await openTab(deps);
  await act(() => view.welcome.settled);
  expect(document.activeElement).not.toBe(searchBox(view));
  await bringForward(view);
  expect(document.activeElement).toBe(searchBox(view));
});

it("leaves the search box unfocused when the command brings the tab forward under the Welcome View banner", async () => {
  const { deps } = await pluginData();
  const view = await openTab(deps);
  await act(() => view.welcome.settled);
  expect(view.contentEl.querySelector("[data-welcome-banner]")).not.toBeNull();
  await bringForward(view);
  expect(document.activeElement).not.toBe(searchBox(view));
});

async function holdReadout(deps: LibraryViewDeps & QueryHostDeps) {
  const ready = Promise.withResolvers<{ itemCount: number }>();
  await using lease = await deps.reads.acquireRead();
  Object.assign(lease.reads, {
    ConnectionReadout: () => Effect.promise(() => ready.promise),
  });
  return async (view: LibraryView) => {
    await act(async () => {
      ready.resolve({ itemCount: 8 });
      await view.welcome.settled;
    });
    await act(() => view.arrived);
  };
}

it("leaves the search box unfocused when the command brings the tab forward before the banner's readout lands, and the banner comes to show", async () => {
  const { deps } = await pluginData();
  const land = await holdReadout(deps);
  const view = await openTab(deps);
  await bringForward(view);
  await land(view);
  expect(view.contentEl.querySelector("[data-welcome-banner]")).not.toBeNull();
  expect(document.activeElement).not.toBe(searchBox(view));
});

it("has the search box focused once the banner's readout lands where no banner comes to show", async () => {
  const { deps, host } = await pluginData();
  host.vault.addFile("literatures/Paper.md", "");
  const land = await holdReadout(deps);
  const view = await openTab(deps);
  await bringForward(view);
  await land(view);
  expect(view.contentEl.querySelector("[data-welcome-banner]")).toBeNull();
  expect(document.activeElement).toBe(searchBox(view));
});

it("leaves the cursor where the researcher moved it while the banner's readout was pending", async () => {
  const { deps, host } = await pluginData();
  host.vault.addFile("literatures/Paper.md", "");
  const land = await holdReadout(deps);
  const view = await openTab(deps);
  await bringForward(view);
  const elsewhere = document.body.createEl("input");
  cleanup.defer(() => elsewhere.remove());
  elsewhere.focus();
  await land(view);
  expect(document.activeElement).toBe(elsewhere);
});

it("puts the cursor in its own search box from the Welcome View banner's Search your library", async () => {
  const { deps } = await pluginData();
  const view = await openTab(deps);
  await act(() => view.welcome.settled);
  expect(document.activeElement).not.toBe(searchBox(view));
  const button = [
    ...view.contentEl.querySelectorAll<HTMLElement>(
      "[data-welcome-banner] button",
    ),
  ].find((el) => el.textContent === m.welcome_action_search());
  expect(button).toBeInstanceOf(HTMLElement);
  await act(() => button!.click());
  expect(document.activeElement).toBe(searchBox(view));
});

it("lists a search's hits in the rank of the worker search, inside the selected node", async () => {
  const { deps, searches } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  expect(shown(view)).toEqual([
    "AAAAAAAA",
    "BBBBBBBB",
    "CCCCCCCC",
    "DDDDDDDD",
    "EEEEEEEE",
  ]);
  await type(view, "figures");
  expect(searches.at(-1)).toEqual({ query: "figures", libraries: [1] });
  expect(shown(view)).toEqual(["DDDDDDDD", "CCCCCCCC", "AAAAAAAA"]);
  expect(header(view)).toBe(
    "My Library› | 3 matches for “figures” | Search all libraries",
  );
  expect(searchAll(view)?.textContent).toBe("Search all libraries");
  await press(view, row(view, THESIS));
  expect(shown(view)).toEqual(["CCCCCCCC", "AAAAAAAA"]);
  expect(header(view)).toBe(
    "My Library›Thesis› | 2 matches for “figures” | Search all libraries",
  );
  expect(searchAll(view)?.textContent).toBe("Search all libraries");
});

it("announces the search's match count as a status, and not a tree selection", async () => {
  const { deps } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  const status = () =>
    view.contentEl.querySelectorAll<HTMLElement>('[role="status"]');
  expect([...status()].map((el) => el.textContent)).toEqual([""]);
  await press(view, row(view, THESIS));
  expect(status()[0]!.textContent).toBe("");
  await type(view, "figures");
  expect(status()[0]!.textContent).toBe("2 matches in Thesis");
  await type(view, "");
  expect(status()[0]!.textContent).toBe("");
});

it("searches all libraries in the Library Scope on request, past the selected Collection", async () => {
  const { deps, run, searches } = await pluginData();
  const view = await openTab(deps);
  await press(view, row(view, THESIS));
  await type(view, "figures");
  await press(
    view,
    view.contentEl.querySelector<HTMLElement>("[data-library-search-all]")!,
  );
  expect(searches.at(-1)).toEqual({ query: "figures", libraries: [1, 2] });
  expect(shown(view)).toEqual(["FFFFFFFF", "DDDDDDDD", "CCCCCCCC", "AAAAAAAA"]);
  expect(listRuns(run).at(-1)!.libraries).toEqual({
    mode: "selected",
    libraries: [PERSONAL, LAB],
  });
  expect(header(view)).toBe("All libraries› | 4 matches for “figures”");
  const selected = () =>
    [
      ...view.contentEl.querySelectorAll<HTMLElement>(
        '[role="treeitem"][aria-selected="true"]',
      ),
    ].map((el) => el.dataset.libraryNode);
  expect(selected()).toEqual([]);
  expect(
    view.contentEl.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]')
      ?.dataset.libraryNode,
  ).toBe(nodeKey(THESIS));
  await type(view, "");
  expect(selected()).toEqual([nodeKey(THESIS)]);
});

it("narrows a tag: token to the Items with that tag, in the list's order", async () => {
  const { deps, searches } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  const before = searches.length;
  await type(view, "tag:method");
  expect(searches).toHaveLength(before);
  expect(shown(view)).toEqual(["AAAAAAAA", "CCCCCCCC", "EEEEEEEE"]);
  await type(view, "tag:method figures");
  expect(shown(view)).toEqual(["CCCCCCCC", "AAAAAAAA"]);
});

it("asks the search again after a database change, so a renamed Item joins its hits", async () => {
  const { deps, change } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  await type(view, "figures");
  expect(shown(view)).toEqual(["DDDDDDDD", "CCCCCCCC", "AAAAAAAA"]);
  await act(async () => {
    await change(
      SEED.map((item) =>
        item.key === B ? { ...item, title: "Figures of attention" } : item,
      ),
    );
    await view.searched;
    await view.query.settled;
  });
  expect(shown(view)).toEqual(["DDDDDDDD", "CCCCCCCC", B, "AAAAAAAA"]);
});

it("clears the search on Escape, and lists the selected node again", async () => {
  const { deps, settings } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  await type(view, "figures");
  await act(async () => {
    searchBox(view).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await view.searched;
    await view.query.settled;
  });
  expect(searchBox(view).value).toBe("");
  expect(shown(view)).toEqual([
    "AAAAAAAA",
    "BBBBBBBB",
    "CCCCCCCC",
    "DDDDDDDD",
    "EEEEEEEE",
  ]);
  expect(header(view)).toBe("My Library | 5 papers · 2 unread");
  await act(() => view.close());
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"]?.search,
  ).toBe("");
});

it("says how to recover from a search that finds nothing, offering to search all libraries, then to clear it, with no filter hint", async () => {
  const { deps } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  const empty = () =>
    view.contentEl.querySelector<HTMLElement>("[data-query-empty]");
  await type(view, "Engelbart");
  expect(shown(view)).toEqual([]);
  expect(view.contentEl.querySelector("[data-query-empty-hint]")).toBeNull();
  expect(empty()?.textContent).toBe(
    `${m.library_view_empty_search_widen()}${m.library_view_search_everywhere()}`,
  );
  expect(searchAll(view)).toBeNull();
  expect(empty()?.closest("[data-pane-state]")).not.toBeNull();
  const action = () =>
    empty()?.querySelector<HTMLElement>("[data-library-empty-action]");
  expect(action()?.textContent).toBe(m.library_view_search_everywhere());
  await act(async () => {
    action()!.click();
    await view.searched;
    await view.query.settled;
  });
  expect(shown(view)).toEqual([]);
  expect(empty()?.textContent).toBe(
    `${m.library_view_empty_search_clear()}${m.library_view_search_clear()}`,
  );
  expect(action()?.textContent).toBe(m.library_view_search_clear());
  await act(async () => {
    action()!.click();
    await view.searched;
    await view.query.settled;
  });
  expect(searchBox(view).value).toBe("");
  expect(shown(view)).toHaveLength(5);
});

it("says the facets left nothing to list where no paper passes them", async () => {
  const { deps } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  await press(view, facet(view, "has-note"));
  await press(view, facet(view, "unread"));
  expect(shown(view)).toEqual([]);
  expect(view.contentEl.querySelector("[data-query-empty-hint]")).toBeNull();
  expect(view.contentEl.querySelector("[data-query-empty]")?.textContent).toBe(
    m.library_view_empty_facets(),
  );
});

it("keeps a search inside the active facets, the vault's among them, in the search's rank", async () => {
  const { deps } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  await type(view, "figures");
  expect(shown(view)).toEqual(["DDDDDDDD", "CCCCCCCC", "AAAAAAAA"]);
  await press(view, facet(view, "has-note"));
  expect(shown(view)).toEqual(["DDDDDDDD", "AAAAAAAA"]);
  await press(view, facet(view, "annotated"));
  expect(shown(view)).toEqual(["AAAAAAAA"]);
  expect(header(view)).toBe(
    "My Library› | 1 match for “figures” | Search all libraries",
  );
  expect(searchAll(view)?.textContent).toBe("Search all libraries");
});

it("keeps a search of all libraries inside the active facets", async () => {
  const { deps } = await pluginData();
  const view = await openTab(deps);
  await press(view, row(view, THESIS));
  await press(view, facet(view, "unread"));
  await type(view, "figures");
  await press(
    view,
    view.contentEl.querySelector<HTMLElement>(
      '[data-library-empty-action="widen"]',
    )!,
  );
  expect(shown(view)).toEqual(["FFFFFFFF"]);
});

it("lists nothing more once the tab closed during a search", async () => {
  const { deps, run, searchRun } = await pluginData();
  const gate = Promise.withResolvers<void>();
  const search = searchRun.search;
  searchRun.search = async (words, options, signal) => {
    await gate.promise;
    if (signal?.aborted) return [];
    return search(words, options);
  };
  const view = await openTab(deps);
  const before = listRuns(run).length;
  await act(async () => {
    const input = searchBox(view);
    input.value = "figures";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await view.close();
    gate.resolve();
    await view.searched;
  });
  expect(listRuns(run)).toHaveLength(before);
});

it("keeps the search text, and opens again on its hits", async () => {
  const { deps, settings } = await pluginData(ON_MY_LIBRARY);
  const first = await openTab(deps);
  await type(first, "figures");
  await act(() => first.close());
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"]?.search,
  ).toBe("figures");
  const view = await openTab(deps);
  expect(searchBox(view).value).toBe("figures");
  expect(shown(view)).toEqual(["DDDDDDDD", "CCCCCCCC", "AAAAAAAA"]);
});

it("searches every Library in the Library Scope on Recent, with no offer to widen", async () => {
  const { deps, searches } = await pluginData();
  const view = await openTab(deps);
  await type(view, "figures");
  expect(searches.at(-1)).toEqual({ query: "figures", libraries: [1, 2] });
  expect(shown(view)).toEqual(["FFFFFFFF", "DDDDDDDD", "CCCCCCCC", "AAAAAAAA"]);
  expect(header(view)).toBe("Recent› | 4 matches for “figures”");
  expect(view.contentEl.querySelector("[data-library-search-all]")).toBeNull();
});

it("leaves Enter and the arrow keys to the Welcome View banner's controls", async () => {
  const { deps, items } = await pluginData();
  const view = await openTab(deps);
  await act(() => itemRow(view, B).click());
  const dismiss = view.contentEl.querySelector("[data-welcome-dismiss]")!;
  expect(dismiss).not.toBeNull();
  expect(await pressKey(view, dismiss, ["Enter"])).toBe(false);
  expect(await pressKey(view, dismiss, ["ArrowDown"])).toBe(false);
  expect(items.openNote).not.toHaveBeenCalled();
  expect(itemRows(view)[1]).toBe(`${B} *`);
});

describe("Welcome View banner once setup is complete", () => {
  const banner = (view: LibraryView) =>
    [
      ...view.contentEl.querySelectorAll(
        '[data-welcome-banner] [role="heading"]',
      ),
    ].map((el) => el.textContent);

  async function setUp() {
    const harness = await pluginData();
    harness.host.vault.addFile("literatures/Paper.md", "");
    const view = await openTab(harness.deps);
    await act(() => view.welcome.settled);
    return { ...harness, view };
  }

  it("shows the setup steps on Open welcome view", async () => {
    const { view } = await setUp();
    const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
      view,
      updateHeader: () => {},
    });
    await act(() =>
      openWelcomeView(
        stubService<App>("App", {
          workspace: stubService<App["workspace"]>("Workspace", {
            getLeavesOfType: () => [leaf],
            setActiveLeaf: () => {},
            revealLeaf: () => Promise.resolve(),
          }),
        }),
      ),
    );
    expect(banner(view)).toContain(m.welcome_step_connect_title());
    expect(banner(view)).toContain(m.welcome_step_folder_title());
  });

  it("toggles the banner from the Welcome & help view action, which reads as pressed while the banner shows", async () => {
    const { view, settings } = await setUp();
    await act(() => {
      settings.bridge.runSync(settings.update({ "welcome.dismissed": true }));
    });
    const { actions } = view as unknown as { actions: HTMLElement[] };
    expect(actions.map((a) => a.getAttribute("aria-label"))).toEqual([
      m.library_view_help_action(),
    ]);
    const [help] = actions as [HTMLElement];
    expect(view.contentEl.querySelector("[data-welcome-help-row]")).toBeNull();
    expect(help.classList.contains("is-active")).toBe(false);
    expect(help.getAttribute("aria-pressed")).toBe("false");

    await act(() => help.click());
    expect(
      settings.bridge.runSync(settings.current)?.["welcome.dismissed"],
    ).toBe(false);
    expect(banner(view)).toContain(m.welcome_step_connect_title());
    expect(banner(view)).toContain(m.welcome_step_folder_title());
    expect(view.contentEl.ownerDocument.activeElement).toBe(
      view.contentEl.querySelector("[data-welcome-banner]"),
    );
    expect(help.classList.contains("is-active")).toBe(true);
    expect(help.getAttribute("aria-pressed")).toBe("true");

    await act(() => help.click());
    expect(
      settings.bridge.runSync(settings.current)?.["welcome.dismissed"],
    ).toBe(true);
    expect(banner(view)).toEqual([]);
    expect(help.classList.contains("is-active")).toBe(false);
    expect(help.getAttribute("aria-pressed")).toBe("false");

    await act(() => view.welcome.request());
    expect(help.getAttribute("aria-pressed")).toBe("true");
    await act(() =>
      view.contentEl
        .querySelector<HTMLElement>("[data-welcome-dismiss]")!
        .click(),
    );
    expect(help.getAttribute("aria-pressed")).toBe("false");
    expect(help.classList.contains("is-active")).toBe(false);
  });

  it("offers the template conversion while it is pending", async () => {
    const { view, settings } = await setUp();
    await act(() => {
      settings.bridge.runSync(
        settings.update({ "note.template-conversion-pending": true }),
      );
    });
    expect(banner(view)).toContain(m.welcome_template_conversion_title());
  });
});

it("asks the database nothing from the search box while Zotero's data folder is missing, and searches once it is set", async () => {
  const { deps, searches, lose, locate } = await pluginData(ON_MY_LIBRARY);
  const view = await openTab(deps);
  await lose();
  await act(async () => {
    view.search.type("figures");
    await view.searched;
  });
  expect(searches).toEqual([]);
  await act(async () => {
    await locate();
    await view.searched;
    await view.query.settled;
  });
  expect(searches.at(-1)).toEqual({ query: "figures", libraries: [1] });
  expect(shown(view)).toEqual(["DDDDDDDD", "CCCCCCCC", "AAAAAAAA"]);
});

it("lets go of the selected row once a search leaves it out, and the item details show no paper", async () => {
  const { deps } = await pluginData();
  const view = await openTab(deps);
  await act(() => itemRow(view, A).click());
  expect(view.selected.key).toBe(A);
  await type(view, "attention");
  expect(itemRows(view)).toEqual([B]);
  expect(view.selected.key).toBeNull();
  expect(
    view.contentEl.querySelector("[data-library-card-empty]")?.textContent,
  ).toContain(m.library_view_card_empty());
});

it("opens a new tab with no paper selected, and keeps no selection in the document", async () => {
  const { deps, settings } = await pluginData();
  const first = await openTab(deps);
  await act(() => itemRow(first, C).click());
  await act(() => settings.bridge.runPromise(settings.flush));
  expect(
    settings.bridge.runSync(settings.current)?.["library.document"] ?? {},
  ).not.toHaveProperty("selected");
  await act(() => first.close());
  const view = await openTab(deps);
  expect(view.selected).toEqual({ key: null });
  expect(itemRows(view).some((key) => key.endsWith("*"))).toBe(false);
  expect(
    view.contentEl.querySelector("[data-library-card-empty]"),
  ).not.toBeNull();
});

describe("Reading Card", () => {
  const card = (view: LibraryView) =>
    view.contentEl.querySelector<HTMLElement>("[data-library-card]")!;
  const shownCard = (view: LibraryView) => {
    const el = card(view);
    if (el.hidden || el.querySelector("[data-library-card-empty]")) return null;
    const part = (name: string) =>
      el.querySelector(`[data-library-card-${name}]`)?.textContent ?? null;
    return {
      title: part("title"),
      creators: part("creators"),
      venue: part("venue"),
      abstract: part("abstract"),
    };
  };
  const button = (view: LibraryView, action: string) =>
    card(view).querySelector<HTMLElement>(
      `[data-library-card-action="${action}"]`,
    )!;

  it("shows no paper while no row is selected, and shows the selected Item's title, creators in full, publication with year, and abstract", async () => {
    const { deps } = await pluginData();
    const view = await openTab(deps);
    expect(shownCard(view)).toBeNull();
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    expect(shownCard(view)).toEqual({
      title: "Notes on attention",
      creators: "Ashish Vaswani, Noam Shazeer",
      venue: "Advances in Neural Information Processing Systems · 2017",
      abstract: "Attention alone carries a sequence model.",
    });
    await act(async () => {
      itemRow(view, C).click();
      await view.card.settled;
    });
    expect(shownCard(view)).toEqual({
      title: "Figures that work",
      creators: null,
      venue: null,
      abstract: null,
    });
  });

  it("reads the selected Item again after a database change", async () => {
    const { deps, change } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    await act(async () => {
      await change(
        SEED.map((item) =>
          item.key === B ? { ...item, title: "Attention, renamed" } : item,
        ),
      );
      await view.query.settled;
      await view.card.settled;
    });
    expect(shownCard(view)?.title).toBe("Attention, renamed");
  });

  it("opens its row menu under the more button", async () => {
    const { deps } = await pluginData();
    deps.app.workspace.trigger = vi.fn();
    const view = await openTab(deps);
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    await act(() => button(view, "more").click());
    const menu = Menu.instances.at(-1)!;
    expect(menu.parentEl).toBe(button(view, "more"));
    expect(menu.position).not.toBeNull();
  });

  it("shows none of the last Item's Annotations while it reads another's, and says so where that read fails", async () => {
    const { deps, run, change } = await pluginData();
    const view = await openTab(deps);
    const annotated = SEED.map((item) =>
      item.key === B ? { ...item, annotations: 1 } : item,
    );
    await act(async () => {
      await change(annotated);
      await view.query.settled;
    });
    await select(view, A);
    await open(view, "annotations");
    expect(view.card.query.state.getState().results).not.toBeNull();
    const failing = Promise.withResolvers<QueryViewOutcome>();
    run.mockImplementation((request) =>
      request.from === "annotations" &&
      request.context?.item === B &&
      request.limit == null
        ? failing.promise
        : Promise.resolve(answer(annotated, request)),
    );
    await act(() => itemRow(view, B).click());
    await vi.waitFor(() =>
      expect(view.card.state.item?.title).toBe("Notes on attention"),
    );
    expect(view.card.query.state.getState().results).toBeNull();
    await act(async () => {
      failing.reject(new Error("The database is busy"));
      await view.card.settled;
    });
    expect(view.card.query.state.getState().results).toBeNull();
    expect(
      card(view).querySelector("[data-library-card-failed]"),
    ).not.toBeNull();
  });

  it("lists the selected Item's Annotations with the Item as the Query Context, from the Item's Library", async () => {
    const { deps, run } = await pluginData();
    const view = await openTab(deps);
    await select(view, A);
    await open(view, "annotations");
    await select(view, C);
    const annotations = run.mock.calls
      .map(([request]) => request)
      .filter((request) => request.from === "annotations");
    expect(annotations.at(-1)).toMatchObject({
      filter: "item == this.item",
      context: { item: C },
      libraries: { mode: "selected", libraries: [PERSONAL] },
    });
  });

  it("shows no paper once the researcher picks another node in the tree", async () => {
    const { deps } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    expect(shownCard(view)).not.toBeNull();
    await press(view, row(view, THESIS));
    expect(shownCard(view)).toBeNull();
  });

  it("opens the PDF and opens or writes the Literature Note, and cites from its More menu, as the row menu does", async () => {
    const { deps, items, addNote } = await pluginData();
    deps.app.workspace.trigger = vi.fn();
    const view = await openTab(deps);
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    expect(
      [
        ...card(view).querySelectorAll<HTMLElement>(
          "[data-library-card-action]",
        ),
      ].map((el) => el.dataset.libraryCardAction),
    ).toEqual(["pdf", "note", "more", "sidebar"]);
    expect(button(view, "note").textContent).toBe("Write literature note");
    await act(() => {
      button(view, "pdf").click();
      button(view, "note").click();
      button(view, "more").click();
    });
    expect(items.openPdf).toHaveBeenCalledExactlyOnceWith(B, false);
    expect(items.openNote).toHaveBeenCalledExactlyOnceWith(B, false);
    Menu.instances
      .at(-1)!
      .items.find((item) => item.title === "Insert citation")!
      .click();
    expect(items.insertCitation).toHaveBeenCalledExactlyOnceWith(B);
    await act(() => addNote(B));
    expect(button(view, "note").textContent).toBe("Open literature note");
  });

  it("offers no Open PDF for an Item with no PDF, and makes its Literature Note the primary button, from the row's header on", async () => {
    const { deps, addNote } = await pluginData();
    deps.app.workspace.trigger = vi.fn();
    const view = await openTab(deps);
    const actions = () =>
      [
        ...card(view).querySelectorAll<HTMLElement>(
          "[data-library-card-action]",
        ),
      ].map(
        (el) =>
          `${el.dataset.libraryCardAction}${el.classList.contains("mod-cta") ? " (primary)" : ""}`,
      );
    await act(() => itemRow(view, C).click());
    expect(actions()).toEqual(["note (primary)", "more", "sidebar"]);
    await act(() => view.card.settled);
    expect(actions()).toEqual(["note (primary)", "more", "sidebar"]);
    await act(() => button(view, "more").click());
    expect(
      Menu.instances.at(-1)!.items.map((item) => item.title),
    ).not.toContain("Open PDF");
    await act(() => addNote(C));
    expect(actions()).toEqual(["note (primary)", "more", "sidebar"]);
    expect(button(view, "note").textContent).toBe("Open literature note");
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    expect(actions()).toEqual(["pdf (primary)", "note", "more", "sidebar"]);
  });

  it("turns off from its close button, gives the focus back to the row, and keeps it off", async () => {
    const { deps, settings } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    const close = card(view).querySelector<HTMLElement>(
      "[data-library-card-close]",
    )!;
    expect(close.getAttribute("aria-label")).toBe(m.library_view_card_close());
    await act(() => close.click());
    expect(view.selected).toEqual({ key: B });
    expect(document.activeElement).toBe(itemRow(view, B));
    expect(shownCard(view)).toBeNull();
    await act(() => settings.bridge.runPromise(settings.flush));
    expect(
      settings.bridge.runSync(settings.current)?.["library.document"]
        ?.cardClosed,
    ).toBe(true);
  });

  it("stays off while the arrow keys or a click move the selection, and shows again from the Details button, pressed while on", async () => {
    const { deps, settings } = await pluginData();
    const view = await openTab(deps);
    const details = () =>
      view.contentEl.querySelector<HTMLElement>(
        "[data-library-details-toggle]",
      )!;
    expect(details().getAttribute("aria-label")).toBe(
      m.library_view_details_toggle(),
    );
    expect(details().getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    await act(() =>
      card(view)
        .querySelector<HTMLElement>("[data-library-card-close]")!
        .click(),
    );
    expect(details().getAttribute("aria-pressed")).toBe("false");
    expect(await pressKey(view, itemRow(view, B), ["ArrowDown"])).toBe(true);
    expect(view.selected).toEqual({ key: C });
    expect(shownCard(view)).toBeNull();
    await act(() => itemRow(view, D).click());
    expect(view.selected).toEqual({ key: D });
    expect(shownCard(view)).toBeNull();
    await act(async () => {
      details().click();
      await view.card.settled;
    });
    expect(details().getAttribute("aria-pressed")).toBe("true");
    expect(shownCard(view)).not.toBeNull();
    await act(() => settings.bridge.runPromise(settings.flush));
    expect(
      settings.bridge.runSync(settings.current)?.["library.document"],
    ).not.toHaveProperty("cardClosed");
    expect(await pressKey(view, itemRow(view, D), ["ArrowUp"])).toBe(true);
    expect(shownCard(view)).not.toBeNull();
  });

  it("turns on and off on Space on the selected row, and leaves the row selected", async () => {
    const { deps, items } = await pluginData({
      node: { kind: "recent" },
      cardClosed: true,
    });
    const view = await openTab(deps);
    expect(await pressKey(view, itemRow(view, A), [" "])).toBe(false);
    expect(await pressKey(view, itemRow(view, A), ["ArrowDown"])).toBe(true);
    const key = view.selected.key!;
    expect(key).not.toBeNull();
    expect(shownCard(view)).toBeNull();
    const inside = itemRow(view, key).createEl("button");
    expect(await pressKey(view, inside, [" "])).toBe(false);
    expect(shownCard(view)).toBeNull();
    expect(await pressKey(view, itemRow(view, key), [" "])).toBe(true);
    expect(shownCard(view)).not.toBeNull();
    expect(await pressKey(view, itemRow(view, key), [" "])).toBe(true);
    expect(shownCard(view)).toBeNull();
    expect(view.selected).toEqual({ key });
    expect(items.openNote).not.toHaveBeenCalled();
    expect(items.openPdf).not.toHaveBeenCalled();
  });

  const parts = (view: LibraryView) =>
    [
      ...card(view).querySelectorAll<HTMLElement>("[data-library-card-part]"),
    ].map((el) => el.dataset.libraryCardPart);
  const toggle = (view: LibraryView, name: string) =>
    card(view).querySelector<HTMLElement>(
      `[data-library-card-toggle="${name}"]`,
    );
  const pairs = (view: LibraryView, part: string) => {
    const list = card(view).querySelector(`[data-library-card-part="${part}"]`);
    if (!list) return null;
    return [...list.querySelectorAll("dt")].map((dt) => [
      dt.textContent,
      dt.nextElementSibling?.textContent,
    ]);
  };
  const annotationRuns = (run: Awaited<ReturnType<typeof pluginData>>["run"]) =>
    run.mock.calls.filter(([request]) => request.from === "annotations");
  async function select(view: LibraryView, key: string) {
    await act(async () => {
      itemRow(view, key).click();
      await view.card.settled;
    });
  }
  async function open(view: LibraryView, name: string) {
    await act(async () => {
      toggle(view, name)!.click();
      await view.card.settled;
    });
  }

  const FILLED: readonly SeedItem[] = SEED.map((item): SeedItem => {
    if (item.key === A)
      return {
        ...item,
        card: {
          "attachments[].indexedKey": ["APDFAPDF", "AWEBAWEB"],
          "attachments[].title": ["Full text PDF", "Snapshot"],
          "attachments[].fileType": ["pdf", "web"],
          notes: [{ indexedKey: "ANTEANTE", title: "Reading notes" }],
          abstractNote: "Drawing graphs for figures.",
          citationKey: "drawing2020",
          language: "en",
        },
      };
    if (item.key === B)
      return {
        ...item,
        card: {
          volume: "30",
          issue: "1",
          pages: "5998–6008",
          DOI: "10.5555/attention",
          url: "",
          citationKey: "vaswani2017",
          ISSN: "1049-5258",
          journalAbbreviation: "NeurIPS",
          language: "en",
          eventPlace: "Long Beach",
          dateAdded: "2024-03-10T12:00:00Z",
        },
      };
    if (item.key === C) return { ...item, card: { language: "de" } };
    if (item.key === D)
      return {
        ...item,
        itemType: "letter",
        fields: {
          creators: [
            {
              role: "author",
              family: "Darwin",
              given: "Charles",
              literal: null,
              fullName: "Charles Darwin",
            },
          ],
          date: {
            kind: "date",
            value: "1859-11-24",
            year: 1859,
            month: 11,
            day: 24,
            text: null,
            raw: "1859-11-24 24 November 1859",
          },
        },
        card: {
          letterType: "Personal letter",
          type: "Personal letter",
          eventPlace: "Down House",
          DOI: "10.1000/letter",
          url: "https://example.org/letter",
          accessDate: "2024-05-01",
          archive: "Darwin Correspondence Project",
          archiveLocation: "DCP-LETT-2575",
          citationKey: "darwin1859",
          language: "en",
          rights: "CC BY",
          extra: "Original in Cambridge",
          volume: "3",
          dateAdded: "2024-05-01T12:00:00Z",
          dateModified: "2024-06-02T12:00:00Z",
        },
      };
    return item;
  });

  it("shows its parts in order under the buttons, with All fields and Annotations closed and the Annotations unread until opened", async () => {
    const { deps, run, change } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      await change(FILLED);
      await view.query.settled;
    });
    await select(view, A);
    expect(parts(view)).toEqual([
      "type",
      "ids",
      "abstract",
      "where",
      "tags",
      "files",
      "notes",
      "footer",
      "annotations",
    ]);
    expect(
      card(view).querySelector('[data-library-card-part="type"]')!.textContent,
    ).toBe("Journal Article");
    for (const name of ["fields", "annotations"]) {
      const button = toggle(view, name)!;
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("aria-expanded")).toBe("false");
      expect(button.getAttribute("aria-controls")).toBeTruthy();
    }
    expect(toggle(view, "annotations")!.textContent).toBe(
      "See all 2 annotations",
    );
    expect(annotationRuns(run).map(([request]) => request)).toEqual([
      expect.objectContaining({
        filter: "item == this.item",
        context: { item: A },
        limit: 2,
      }),
    ]);
    expect(
      card(view).querySelector("[data-library-card-annotations]"),
    ).toBeNull();

    await open(view, "annotations");
    const button = toggle(view, "annotations")!;
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.getElementById(button.getAttribute("aria-controls")!),
    ).not.toBeNull();
    expect(annotationRuns(run).at(-1)?.[0]).toMatchObject({
      filter: "item == this.item",
      context: { item: A },
    });
  });

  it("lists the files, which open in their reader, the Zotero notes, which link to Zotero, and the tags as chips", async () => {
    const { deps, change } = await pluginData();
    const open = vi.fn(() => Effect.succeed({ kind: "reader" as const }));
    Object.assign(deps, { opener: { open } });
    const view = await openTab(deps);
    await act(async () => {
      await change(FILLED);
      await view.query.settled;
    });
    await select(view, A);
    const files = [
      ...card(view).querySelectorAll<HTMLAnchorElement>(
        '[data-library-card-part="files"] a',
      ),
    ];
    expect(files.map((a) => a.textContent)).toEqual([
      "Full text PDF",
      "Snapshot",
    ]);
    await act(() => files[0]!.click());
    expect(open).toHaveBeenCalledExactlyOnceWith(
      { kind: "attachment", attachmentKey: "APDFAPDF" },
      false,
    );
    const note = card(view).querySelector<HTMLAnchorElement>(
      '[data-library-card-part="notes"] a',
    )!;
    expect(note.textContent).toBe("Reading notes");
    expect(note.getAttribute("href")).toBe(
      "zotero://select/library/items/ANTEANTE",
    );
    expect(
      [
        ...card(view).querySelectorAll('[data-library-card-part="tags"] li'),
      ].map((el) => el.textContent),
    ).toEqual(["method", "figure"]);
  });

  it("shows where the Item sits as its Library and each Collection path", async () => {
    const { deps } = await pluginData();
    const view = await openTab(deps);
    await select(view, A);
    expect(
      [...card(view).querySelectorAll("[data-library-card-path]")].map(
        (el) => el.textContent,
      ),
    ).toEqual([
      "My Library › Thesis › Chapter 1",
      "My Library › Thesis › Chapter 2",
    ]);
    await select(view, E);
    expect(
      [...card(view).querySelectorAll("[data-library-card-path]")].map(
        (el) => el.textContent,
      ),
    ).toEqual(["My Library"]);
  });

  const ids = (view: LibraryView) => {
    const doi = card(view).querySelector<HTMLAnchorElement>(
      "[data-library-card-doi]",
    );
    return {
      doi: doi && { text: doi.textContent, href: doi.getAttribute("href") },
      citationKey:
        card(view).querySelector("[data-library-card-citekey]")?.textContent ??
        null,
    };
  };
  const added = (view: LibraryView) =>
    card(view).querySelector("[data-library-card-added]")?.textContent ?? null;

  it("shows a journal article's Venue with volume, issue, pages and year, its DOI and citation key as chips, the date added, and its other filled fields under All fields with Zotero's labels", async () => {
    const { deps, change, items } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      await change(FILLED);
      await view.query.settled;
    });
    await select(view, B);
    expect(shownCard(view)?.venue).toBe(
      "Advances in Neural Information Processing Systems, 30(1), 5998–6008 · 2017",
    );
    expect(ids(view)).toEqual({
      doi: {
        text: "doi:10.5555/attention",
        href: "https://doi.org/10.5555/attention",
      },
      citationKey: "vaswani2017",
    });
    await act(() =>
      card(view)
        .querySelector<HTMLElement>("[data-library-card-copy]")!
        .click(),
    );
    expect(items.copyCitationKey).toHaveBeenCalledExactlyOnceWith(B);
    expect(added(view)).toBe("Added March 10, 2024");
    expect(pairs(view, "fields")).toBeNull();
    await open(view, "fields");
    expect(pairs(view, "fields")).toEqual([
      ["Creators", "Ashish Vaswani; Noam Shazeer; Isabelle Guyon"],
      ["Journal Abbr", "NeurIPS"],
      ["ISSN", "1049-5258"],
      ["Language", "en"],
    ]);
  });

  it("names every author in full up to ten, then et al., with the rest under All fields", async () => {
    const { deps, change } = await pluginData();
    const view = await openTab(deps);
    const authors = Array.from({ length: 12 }, (_, index) => ({
      role: "author",
      family: `Author${index + 1}`,
      given: "Ada",
      literal: null,
    }));
    await act(async () => {
      await change(
        SEED.map((item) =>
          item.key === C ? { ...item, fields: { creators: authors } } : item,
        ),
      );
      await view.query.settled;
    });
    await select(view, C);
    expect(shownCard(view)?.creators).toBe(
      "Ada Author1, Ada Author2, Ada Author3, Ada Author4, Ada Author5, Ada Author6, Ada Author7, Ada Author8, Ada Author9, Ada Author10 et al.",
    );
    await open(view, "fields");
    expect(pairs(view, "fields")?.[0]?.[1]).toContain(
      "Ada Author11; Ada Author12",
    );
  });

  it("shows a letter's year under its title, and its full date, URL and other filled fields in a letter's order", async () => {
    const { deps, change } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      await change(FILLED);
      await view.query.settled;
    });
    await select(view, D);
    expect(
      card(view).querySelector('[data-library-card-part="type"]')!.textContent,
    ).toBe("Letter");
    expect(shownCard(view)).toMatchObject({
      creators: "Charles Darwin",
      venue: "1859",
    });
    expect(ids(view)).toEqual({
      doi: {
        text: "doi:10.1000/letter",
        href: "https://doi.org/10.1000/letter",
      },
      citationKey: "darwin1859",
    });
    expect(added(view)).toBe("Added May 1, 2024");
    await open(view, "fields");
    expect(pairs(view, "fields")).toEqual([
      ["Type", "Personal letter"],
      ["Date", "November 24, 1859"],
      ["Event Place", "Down House"],
      ["URL", "https://example.org/letter"],
      ["Accessed", "May 1, 2024"],
      ["Archive", "Darwin Correspondence Project"],
      ["Loc. in Archive", "DCP-LETT-2575"],
      ["Language", "en"],
      ["License", "CC BY"],
      ["Extra", "Original in Cambridge"],
      ["Modified", "June 2, 2024"],
    ]);
    expect(
      card(view)
        .querySelector('[data-library-card-fact="url"] a')
        ?.getAttribute("href"),
    ).toBe("https://example.org/letter");
  });

  it("remembers All fields and Annotations open for the Library View, across Items and when the tab opens again", async () => {
    const { deps, settings, run, change } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      await change(FILLED);
      await view.query.settled;
    });
    await select(view, A);
    await open(view, "fields");
    await open(view, "annotations");
    await select(view, C);
    expect(toggle(view, "fields")!.getAttribute("aria-expanded")).toBe("true");
    expect(toggle(view, "annotations")!.getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(annotationRuns(run).at(-1)?.[0]).toMatchObject({
      context: { item: C },
    });
    await act(() => settings.bridge.runPromise(settings.flush));
    expect(
      settings.bridge.runSync(settings.current)?.["library.document"],
    ).toMatchObject({
      card: { allFields: true, annotations: true },
    });
    await act(() => view.close());
    const again = await openTab(deps);
    await select(again, A);
    expect(toggle(again, "fields")!.getAttribute("aria-expanded")).toBe("true");
    await open(again, "fields");
    expect(toggle(again, "fields")!.getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  const MARKED: readonly SeedItem[] = SEED.map((item) =>
    item.key === A
      ? {
          ...item,
          marks: [
            {
              key: "AANNOT01",
              values: {
                type: "highlight",
                color: "#FFD400",
                text: "Scientific visualization is classically defined.",
                comment: "",
                pageLabel: "1",
              },
            },
            {
              key: "AANNOT02",
              values: {
                type: "note",
                color: "#5fb236",
                text: "",
                comment: "Making figures is hard",
                pageLabel: "1",
              },
            },
            {
              key: "AANNOT03",
              values: { type: "image", color: "#ff6666", pageLabel: "3" },
            },
            {
              key: "AANNOT04",
              values: { type: "highlight", color: "#ffd400", text: "Later" },
            },
          ],
        }
      : item,
  );
  const quotes = (view: LibraryView) =>
    [
      ...card(view).querySelectorAll<HTMLElement>("[data-library-card-quote]"),
    ].map((el) => [el.dataset.libraryCardQuote, el.textContent]);
  const colours = (view: LibraryView) =>
    [
      ...card(view).querySelectorAll<HTMLElement>("[data-library-card-colour]"),
    ].map((el) => el.textContent);

  it("previews the first two Annotations as quotes with their page, under the count of each colour as text, and mounts every Annotation Card from See all", async () => {
    const { deps, run, change } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      await change(MARKED);
      await view.query.settled;
    });
    await select(view, A);
    expect(
      card(view).querySelector(
        '[data-library-card-part="annotations"] [role="heading"]',
      )?.textContent,
    ).toBe("Your annotations");
    expect(colours(view)).toEqual(["Yellow: 2", "Red: 1", "Green: 1"]);
    expect(quotes(view)).toEqual([
      [
        "quote",
        `“Scientific visualization is classically defined.”${m.annot_view_page({ page: "1" })}`,
      ],
      [
        "note",
        `Making figures is hard${m.annot_view_page({ page: "1" })} · note`,
      ],
    ]);
    expect(annotationRuns(run).at(-1)?.[0]).toMatchObject({
      limit: 2,
      fields: ["type", "text", "comment", "color", "pageLabel"],
    });
    expect(
      card(view).querySelector("[data-library-card-annotations]"),
    ).toBeNull();
    const runs = annotationRuns(run).length;
    await open(view, "annotations");
    expect(
      card(view).querySelector("[data-library-card-annotations]"),
    ).not.toBeNull();
    expect(annotationRuns(run)).toHaveLength(runs + 1);
    expect(annotationRuns(run).at(-1)?.[0]).toMatchObject({
      filter: "item == this.item",
      context: { item: A },
    });
    expect(annotationRuns(run).at(-1)?.[0].limit ?? null).toBeNull();
    expect(quotes(view)).toEqual([]);
    expect(toggle(view, "annotations")!.textContent).toBe("Hide annotations");
  });

  it("previews an area as an image and an ink drawing as a drawing, each with its page", async () => {
    const { deps, change } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      await change(
        MARKED.map((item) =>
          item.key === A
            ? {
                ...item,
                marks: [
                  item.marks![2]!,
                  {
                    key: "AANNOT05",
                    values: { type: "ink", color: "#2ea8e5", pageLabel: "4" },
                  },
                ],
              }
            : item,
        ),
      );
      await view.query.settled;
    });
    await select(view, A);
    expect(quotes(view)).toEqual([
      ["image", `Image · ${m.annot_view_page({ page: "3" })}`],
      ["image", `Drawing · ${m.annot_view_page({ page: "4" })}`],
    ]);
    expect(toggle(view, "annotations")!.textContent).toBe(
      "See all 2 annotations",
    );
  });

  it("leaves out every part an Item has nothing for", async () => {
    const { deps } = await pluginData();
    const view = await openTab(deps);
    await select(view, E);
    expect(parts(view)).toEqual(["type", "where", "tags"]);
    expect(toggle(view, "fields")).toBeNull();
    expect(toggle(view, "annotations")).toBeNull();
    expect(card(view).textContent).not.toMatch(/\b0\b/);
  });

  it("cuts a long abstract to a few lines, with Show more and Show less", async () => {
    const { deps, change } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      await change(
        SEED.map((item) =>
          item.key === B
            ? {
                ...item,
                card: {
                  abstractNote:
                    "Attention alone carries a sequence model. ".repeat(8),
                },
              }
            : item,
        ),
      );
      await view.query.settled;
    });
    await select(view, B);
    const abstract = card(view).querySelector<HTMLElement>(
      "[data-library-card-abstract]",
    )!;
    expect(abstract.className).toContain("line-clamp-4");
    const more = toggle(view, "abstract")!;
    expect(more.textContent).toBe("Show more");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    await act(() => more.click());
    expect(abstract.className).not.toContain("line-clamp-4");
    expect(toggle(view, "abstract")!.textContent).toBe("Show less");
  });

  it("leaves Enter and the arrow keys inside the card to the card", async () => {
    const { deps, items } = await pluginData();
    const view = await openTab(deps);
    await act(async () => {
      itemRow(view, B).click();
      await view.card.settled;
    });
    const inside = card(view).createDiv();
    expect(await pressKey(view, inside, ["Enter"])).toBe(false);
    expect(await pressKey(view, inside, ["ArrowDown"])).toBe(false);
    expect(items.openNote).not.toHaveBeenCalled();
  });
});

it("says in the Save as query file dialog, from the toolbar button, what the file leaves out, and offers the selected Collection's name", async () => {
  const { deps } = await pluginData();
  Object.assign(deps.app, {
    fileManager: {
      getNewFileParent: () => ({ isRoot: () => true, path: "/" }),
    },
  });
  deps.app.workspace.getActiveFile = () => null;
  Object.assign(deps.app, {
    keymap: { pushScope: () => {}, popScope: () => {} },
  });
  const view = await openTab(deps);
  await press(view, row(view, THESIS));
  await press(view, facet(view, "has-note"));
  await type(view, "figures");
  Modal.instances.length = 0;
  await act(() =>
    view.contentEl.querySelector<HTMLElement>("[data-query-save-as]")!.click(),
  );
  await vi.waitFor(() => expect(Modal.instances).toHaveLength(1));
  const modal = Modal.instances[0]!;
  modal.onOpen();
  expect(
    [...modal.contentEl.querySelectorAll("[data-save-left-out]")].map(
      (el) => el.textContent,
    ),
  ).toEqual([
    m.library_view_save_leaves_out_facets({
      facets: m.library_view_facet_has_note(),
    }),
    m.library_view_save_leaves_out_search(),
  ]);
  const name = [...modal.contentEl.querySelectorAll<HTMLElement>("label")]
    .flatMap((label) => controlsOf(label.lastElementChild as HTMLElement))
    .find((control) => control instanceof TextComponent);
  expect(name?.getValue()).toBe("Thesis");
  modal.close();
});

describe("Tag Selector", () => {
  function tags(view: LibraryView) {
    return [
      ...view.contentEl.querySelectorAll<HTMLElement>("[data-library-tag]"),
    ].map((el) => el.dataset.libraryTag);
  }

  function pressed(view: LibraryView) {
    return [
      ...view.contentEl.querySelectorAll<HTMLElement>(
        '[data-library-tag][aria-pressed="true"]',
      ),
    ].map((el) => el.dataset.libraryTag);
  }

  function tag(view: LibraryView, name: string): HTMLElement {
    const found = [
      ...view.contentEl.querySelectorAll<HTMLElement>("[data-library-tag]"),
    ].find((el) => el.dataset.libraryTag === name);
    if (!found) throw new Error(`No tag ${name}`);
    return found;
  }

  function deselectAll(view: LibraryView) {
    return view.contentEl.querySelector<HTMLElement>(
      "[data-library-tags-clear]",
    );
  }

  async function filterTags(view: LibraryView, text: string) {
    await act(async () => {
      const input = view.contentEl.querySelector<HTMLInputElement>(
        "[data-library-tags-filter]",
      )!;
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await view.tree.settled;
    });
  }

  it("lists the tags of the Items the selected node lists, by name", async () => {
    const { deps } = await pluginData();
    const view = await openTab(deps);
    expect(tags(view)).toEqual(["figure", "lab-meeting", "method", "talk"]);
    await press(view, row(view, MY_LIBRARY));
    expect(tags(view)).toEqual(["figure", "method", "talk"]);
    await press(view, row(view, { ...THESIS, path: ["Reading list"] }));
    expect(tags(view)).toEqual(["figure"]);
  });

  it("narrows the list to the Items with a tag, and with every tag selected", async () => {
    const { deps } = await pluginData();
    const view = await openTab(deps);
    await press(view, row(view, MY_LIBRARY));
    await press(view, tag(view, "method"));
    expect(pressed(view)).toEqual(["method"]);
    expect(listed(view)).toEqual(["AAAAAAAA", "CCCCCCCC", "EEEEEEEE"]);
    expect(tags(view)).toEqual(["figure", "method"]);
    await press(view, tag(view, "figure"));
    expect(pressed(view)).toEqual(["figure", "method"]);
    expect(listed(view)).toEqual(["AAAAAAAA"]);
    await press(view, tag(view, "method"));
    expect(listed(view)).toEqual(["AAAAAAAA", "DDDDDDDD"]);
  });

  it("shows the selected tags as chips under the heading, on Recent too", async () => {
    const { deps } = await pluginData();
    const view = await openTab(deps);
    expect(filterChips(view)).toEqual([]);
    await press(view, tag(view, "method"));
    expect(header(view)).toBe("Recent | 3 papers");
    expect(filterChips(view)).toEqual(["tag:method"]);
    await press(view, row(view, MY_LIBRARY));
    await press(view, tag(view, "figure"));
    expect(header(view)).toBe("My Library | 1 of 5 papers · 2 unread");
    expect(filterChips(view)).toEqual(["tag:figure", "tag:method"]);
  });

  it("removes a facet or a tag from its chip under the heading, which names what it removes", async () => {
    const { deps, settings } = await pluginData(ON_MY_LIBRARY);
    const view = await openTab(deps);
    await press(view, facet(view, "annotated"));
    await press(view, tag(view, "figure"));
    expect(listed(view)).toEqual(["AAAAAAAA"]);
    expect(filterChips(view)).toEqual(["facet:annotated", "tag:figure"]);
    const chip = (key: string) =>
      view.contentEl.querySelector<HTMLElement>(
        `[data-library-filter="${key}"]`,
      )!;
    expect(chip("tag:figure").getAttribute("role")).toBe("button");
    expect(chip("tag:figure").getAttribute("aria-label")).toBe(
      m.library_view_heading_remove_filter({ name: "figure" }),
    );
    await press(view, chip("facet:annotated"));
    expect(facet(view, "annotated").getAttribute("aria-pressed")).toBe("false");
    expect(listed(view)).toEqual(["AAAAAAAA", "DDDDDDDD"]);
    expect(filterChips(view)).toEqual(["tag:figure"]);
    await press(view, chip("tag:figure"));
    expect(pressed(view)).toEqual([]);
    expect(listed(view)).toHaveLength(5);
    expect(filterChips(view)).toEqual([]);
    expect(
      view.contentEl.querySelector("[data-library-filter-clear]"),
    ).toBeNull();
    await act(() => settings.bridge.runPromise(settings.flush));
    expect(
      settings.bridge.runSync(settings.current)?.["library.document"],
    ).toMatchObject({
      facets: [],
      tags: [],
    });
  });

  it("clears every facet and tag from Clear all, in one run of the list", async () => {
    const { deps, run, settings } = await pluginData(ON_MY_LIBRARY);
    const view = await openTab(deps);
    await press(view, facet(view, "pdf"));
    await press(view, tag(view, "method"));
    expect(listed(view)).toEqual(["AAAAAAAA"]);
    const runs = listRuns(run).length;
    await press(
      view,
      view.contentEl.querySelector<HTMLElement>("[data-library-filter-clear]")!,
    );
    expect(listRuns(run)).toHaveLength(runs + 1);
    expect(listed(view)).toHaveLength(5);
    expect(pressed(view)).toEqual([]);
    expect(facet(view, "pdf").getAttribute("aria-pressed")).toBe("false");
    expect(header(view)).toBe("My Library | 5 papers · 2 unread");
    await act(() => settings.bridge.runPromise(settings.flush));
    expect(
      settings.bridge.runSync(settings.current)?.["library.document"],
    ).toMatchObject({
      facets: [],
      tags: [],
    });
  });

  it("deselects every tag at once, and offers that only while one is selected", async () => {
    const { deps } = await pluginData(ON_MY_LIBRARY);
    const view = await openTab(deps);
    expect(deselectAll(view)).toBeNull();
    await press(view, tag(view, "method"));
    await press(view, tag(view, "figure"));
    await press(view, deselectAll(view)!);
    expect(pressed(view)).toEqual([]);
    expect(listed(view)).toHaveLength(5);
    expect(header(view)).toBe("My Library | 5 papers · 2 unread");
    expect(deselectAll(view)).toBeNull();
  });

  it("selects a tag the Reading Card shows, beside those selected already", async () => {
    const { deps, settings } = await pluginData(ON_MY_LIBRARY);
    const view = await openTab(deps);
    await press(view, tag(view, "method"));
    await act(async () => {
      itemRow(view, "AAAAAAAA").click();
      await view.card.settled;
    });
    const chip = (name: string) =>
      view.contentEl.querySelector<HTMLElement>(
        `[data-library-card] [data-library-card-tag="${name}"]`,
      )!;
    expect(chip("figure").getAttribute("role")).toBe("button");
    await press(view, chip("figure"));
    expect(pressed(view)).toEqual(["figure", "method"]);
    expect(listed(view)).toEqual(["AAAAAAAA"]);
    expect(header(view)).toBe("My Library | 1 of 5 papers · 2 unread");
    expect(filterChips(view)).toEqual(["tag:figure", "tag:method"]);
    expect(
      settings.bridge.runSync(settings.current)?.["library.document"]?.tags,
    ).toEqual(["figure", "method"]);
    await press(view, chip("method"));
    expect(pressed(view)).toEqual(["figure", "method"]);
  });

  it("filters the tag names it shows, never the papers, and keeps a selected tag in view", async () => {
    const { deps, run } = await pluginData(ON_MY_LIBRARY);
    const view = await openTab(deps);
    await press(view, tag(view, "talk"));
    const runs = listRuns(run).length;
    await filterTags(view, "FIG");
    expect(tags(view)).toEqual(["talk"]);
    await press(view, deselectAll(view)!);
    await filterTags(view, "FIG");
    expect(tags(view)).toEqual(["figure"]);
    expect(listed(view)).toHaveLength(5);
    expect(listRuns(run)).toHaveLength(runs + 1);
  });

  it("keeps the selected tags on another node, where they still show though no Item there has them", async () => {
    const { deps, settings } = await pluginData(ON_MY_LIBRARY);
    const view = await openTab(deps);
    await press(view, tag(view, "talk"));
    await press(view, row(view, { ...THESIS, path: ["Reading list"] }));
    expect(listed(view)).toEqual([]);
    expect(tags(view)).toEqual(["talk"]);
    expect(pressed(view)).toEqual(["talk"]);
    expect(
      view.contentEl.querySelector("[data-query-empty]")?.textContent,
    ).toBe(m.library_view_empty_facets());
    await settings.bridge.runPromise(settings.flush);
    expect(
      settings.bridge.runSync(settings.current)?.["library.document"]?.tags,
    ).toEqual(["talk"]);
  });

  it("opens again with the tags the researcher left selected", async () => {
    const { deps } = await pluginData({
      ...ON_MY_LIBRARY,
      tags: ["figure", "method"],
    });
    const view = await openTab(deps);
    expect(pressed(view)).toEqual(["figure", "method"]);
    expect(listed(view)).toEqual(["AAAAAAAA"]);
  });

  it("lists the tags again after a database change", async () => {
    const { deps, change } = await pluginData(ON_MY_LIBRARY);
    const view = await openTab(deps);
    await act(async () => {
      await change([
        ...SEED,
        { key: "JJJJJJJJ", libraryID: 1, collections: [], tags: ["pitfall"] },
      ]);
      await view.tree.settled;
    });
    expect(tags(view)).toEqual(["figure", "method", "pitfall", "talk"]);
  });

  it("lets go of the selected tags to show an Item they leave out", async () => {
    const { deps } = await pluginData(ON_MY_LIBRARY);
    const view = await openTab(deps);
    await press(view, tag(view, "talk"));
    await act(async () => {
      await view.reveal(A);
    });
    expect(pressed(view)).toEqual([]);
    expect(itemRows(view)).toContain(`${A} *`);
  });

  it("names the tags for a screen reader by their heading, each a toggle button, with one stop for Tab and the arrow keys between them", async () => {
    const { deps } = await pluginData(ON_MY_LIBRARY);
    const view = await openTab(deps);
    const pane = view.contentEl.querySelector("[data-library-tree]")!;
    expect(
      pane.querySelectorAll("[aria-label]:not([data-library-tree-resizer])"),
    ).toHaveLength(0);
    const group = pane.querySelector("[data-library-tags]")!;
    expect(group.getAttribute("role")).toBe("group");
    expect(accessibleName(group)).toBe(m.library_view_tags_label());
    const names = [
      ...group.querySelectorAll<HTMLElement>("[data-library-tag]"),
    ];
    expect(names.map((el) => el.getAttribute("role"))).toEqual([
      "button",
      "button",
      "button",
    ]);
    expect(names.map((el) => el.tabIndex)).toEqual([0, -1, -1]);
    const input = pane.querySelector("[data-library-tags-filter]")!;
    expect(accessibleName(input)).toBe(m.library_view_tags_filter());
    await act(async () => {
      names[0]!.focus();
      names[0]!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(tag(view, "method"));
    expect(tag(view, "method").tabIndex).toBe(0);
    await act(async () => {
      tag(view, "method").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await view.query.settled;
      await view.tree.settled;
    });
    expect(pressed(view)).toEqual(["method"]);
  });
});

effectIt.live(
  "opens the created note after the last Library tab closes during creation planning",
  () =>
    Effect.promise(async () => {
      const item = makeItem({ itemType: "journalArticle", title: "Paper" });
      let created = Promise.withResolvers<TFile>();
      let cancelled = false;
      const planCreations = vi.fn<NoteFeature["Service"]["planCreations"]>(
        (keys) =>
          Effect.promise((signal) => {
            signal.addEventListener(
              "abort",
              () => {
                cancelled = true;
              },
              { once: true },
            );
            return created.promise.then(
              (file) =>
                new Map(
                  keys.map((key) => [
                    key,
                    {
                      item,
                      selection: {
                        selector: "default" as const,
                        source: "match" as const,
                        shouldAsk: false,
                        reason: "Fixture match",
                      },
                      previews: [
                        {
                          selector: "default" as const,
                          label: undefined,
                          folder: "literatures",
                          citationStyle: null,
                          document: undefined,
                          path: file.path,
                          create: () =>
                            Effect.succeed({
                              outcome: "created" as const,
                              file,
                            }),
                        },
                      ],
                    },
                  ]),
                ),
            );
          }),
      );
      const workspace = new MemoryWorkspace();
      const openLinkText = vi.spyOn(workspace, "openLinkText");
      const { deps, host } = await pluginData(
        undefined,
        item,
        Layer.mergeAll(
          Layer.mock(NoteFeature, { planCreations }),
          layerWorkspaceFrom(workspace),
          Layer.mock(ZoteroPref, {
            current: Effect.succeed(
              stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
                dataDir: "",
              }),
            ),
          }),
        ),
      );
      const pluginLifetime = new DisposableStack();
      cleanup.defer(() => pluginLifetime.dispose());
      registerLibraryView(
        stubService<Plugin>("Plugin", {
          app: deps.app,
          register: (release) => pluginLifetime.defer(release),
          registerView: () => {},
          addCommand: (command) => command,
          addRibbonIcon: () => document.createElement("div"),
        }),
        deps,
      );
      const view = await openTab(deps);
      const actions = itemActions({
        app: deps.app,
        registry: deps.registry,
        opener: deps.opener,
        noteFeature: { renderCitation: () => "" },
        creation: {
          app: deps.app,
          createProfile: vi.fn(),
          importProfile: vi.fn(),
        },
      });
      actions.openNote(item.indexedKey, "tab");
      await waitFor(() => expect(planCreations).toHaveBeenCalledOnce());
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      cleanup.defer(() => void vi.useRealTimers());
      await view.close();
      await vi.advanceTimersByTimeAsync(10);
      const file = host.vault.addFile("literatures/paper.md", "Paper");
      created.resolve(file);
      await vi.waitFor(() =>
        expect(openLinkText).toHaveBeenCalledWith(file.path, "", "tab", {
          active: true,
        }),
      );
      created = Promise.withResolvers<TFile>();
      actions.openNote(item.indexedKey, "tab");
      await waitFor(() => expect(planCreations).toHaveBeenCalledTimes(2));
      pluginLifetime.dispose();
      await vi.advanceTimersByTimeAsync(10);
      await vi.waitFor(() => expect(cancelled).toBe(true));
      created.resolve(file);
      expect(openLinkText).toHaveBeenCalledOnce();
    }),
);
