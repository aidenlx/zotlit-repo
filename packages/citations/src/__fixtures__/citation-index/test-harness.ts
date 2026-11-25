import type { Context } from "effect";
import { Effect, Stream } from "effect";
import { basename } from "node:path/posix";
import { TFile } from "obsidian";
import type {
  App,
  CachedMetadata,
  EventRef,
  Events,
  FileStats,
  LinkCache,
  TAbstractFile,
  TFolder,
} from "obsidian";

import type { Library, LibraryCitekey } from "@zotlit/db";
import type { HostSources } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import { MemoryWorkspace } from "@zotlit/obsidian-kit/__fixtures__/obsidian-workspace.ts";
import type { MetadataCacheSource } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import type { VaultSource } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { testEvent } from "@zotlit/plugin-kernel/__fixtures__/event-stream.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import {
  FIELD_CITEKEY,
  FIELD_ZOTERO_KEY,
} from "@zotlit/plugin-kernel/constants.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { testClock } from "@zotlit/plugin-services/__fixtures__/query-test-clock.ts";
import { queryClientsFixture } from "@zotlit/plugin-services/core/query-client/__fixtures__.ts";
import type { QueryClients } from "@zotlit/plugin-services/core/query-client/service.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import type { LibraryScopeEvents } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { buildNoteIndex } from "@zotlit/plugin-services/obsidian/note-index/__fixtures__.ts";
import {
  inProcessReadsService,
  memoryOpener,
} from "@zotlit/zotero-reads/__fixtures__/in-process.ts";
import type { TestReads } from "@zotlit/zotero-reads/__fixtures__/reads.ts";
import type {
  ZoteroReads,
  ZoteroReadsState,
} from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReadLease } from "@zotlit/zotero-reads/client/service.ts";
import { resolveLibraryScope } from "@zotlit/zotero-reads/contract/library-scope.ts";
import type {
  LibraryScope,
  AvailableLibrary,
  ResolvedLibraryScope,
} from "@zotlit/zotero-reads/contract/library-scope.ts";
import type { ZoteroReadsClient } from "@zotlit/zotero-reads/contract/rpc.ts";
import { DbUnavailable } from "@zotlit/zotero-reads/contract/rpc.ts";

import type { ParseClient } from "#core/citation-parse/client.ts";
import { inProcessParseClient } from "#core/citation-parse/in-process.ts";
import { buildSeededSettings } from "#__fixtures__/settings.ts";
import type { SettingsFixture } from "#__fixtures__/settings.ts";

import { citationIndexFixture, citationLookupFixture } from "#__fixtures__/citation-index.ts";
import { CitationLookup } from "#obsidian/citation-index/lookup-service.ts";
import type { CitationIndex } from "#obsidian/citation-index/service.ts";
import type { CitekeyRecord, CitekeyStore } from "#obsidian/citation-index/service.ts";

export const KEY_A = "ABCD2345";
export const KEY_B = "ZZZ99999g7";

export const MY_LIBRARY_ID = 1;
export const GROUP_LIBRARY_ID = 4;

export function personalLibrary(
  libraryID: number = MY_LIBRARY_ID,
): AvailableLibrary {
  return { selector: { type: "personal" }, libraryID, name: null };
}

export function groupLibrary({
  groupID = 7,
  libraryID = GROUP_LIBRARY_ID,
  name = "Shared group",
}: {
  groupID?: number;
  libraryID?: number;
  name?: string;
} = {}): AvailableLibrary {
  return { selector: { type: "group", groupID }, libraryID, name };
}

type Callback = (...args: unknown[]) => void;

export class MockMetadataCache implements MetadataCacheSource {
  readonly fileCache = new Map<string, CachedMetadata>();
  readonly files = new Map<string, TFile>();
  readonly resolvedLinks: Record<string, Record<string, number>> = {};
  vault?: MockVault;

  readonly #listeners: Record<string, Set<Callback>> = {
    changed: new Set(),
    deleted: new Set(),
    resolve: new Set(),
    resolved: new Set(),
  };

  getFileCache(file: TFile): CachedMetadata | null {
    return this.fileCache.get(file.path) ?? null;
  }

  getCache(path: string): CachedMetadata | null {
    return this.fileCache.get(path) ?? null;
  }

  onCleanCache(callback: () => void): void {
    callback();
  }

  getFirstLinkpathDest(linkpath: string, _sourcePath: string): TFile | null {
    return this.files.get(`${linkpath}.md`) ?? null;
  }

  on(name: string, callback: Callback): EventRef {
    this.#listeners[name]!.add(callback);
    return { e: this, name, callback };
  }

  offref(ref: EventRef): void {
    const { name, callback } = ref as unknown as {
      name: string;
      callback: Callback;
    };
    this.#listeners[name]!.delete(callback);
  }

  change(file: TFile, body: string, links: LinkCache[] = []): void {
    this.vault?.write(file, body);
    this.files.set(file.path, file);
    const cache: CachedMetadata = { links };
    this.fileCache.set(file.path, cache);
    this.#emit("changed", file, body, cache);
  }

  setFrontmatter(
    file: TFile,
    frontmatter: Record<string, unknown> | undefined,
  ): void {
    const cache: CachedMetadata = {
      ...this.fileCache.get(file.path),
      frontmatter,
    };
    this.fileCache.set(file.path, cache);
    this.#emit("changed", file, this.vault?.bodies.get(file.path) ?? "", cache);
  }

  delete(file: TFile): void {
    this.fileCache.delete(file.path);
    this.files.delete(file.path);
    this.#emit("deleted", file, null);
  }

  resolve(file: TFile): void {
    this.#emit("resolve", file);
  }

  resolved(): void {
    this.#emit("resolved");
  }

  #emit(name: string, ...args: unknown[]): void {
    for (const callback of this.#listeners[name]!) callback(...args);
  }
}

type VaultEventName = "create" | "modify" | "rename" | "delete";

export class MockVault implements VaultSource {
  readonly bodies = new Map<string, string>();
  readonly reads: string[] = [];
  readonly #listeners: Record<VaultEventName, Set<Callback>> = {
    create: new Set(),
    modify: new Set(),
    rename: new Set(),
    delete: new Set(),
  };
  readonly #held = new Map<string, PromiseWithResolvers<void>>();
  readonly #failures = new Map<string, Error>();

  readonly metadataCache: MockMetadataCache;

  constructor(metadataCache: MockMetadataCache) {
    this.metadataCache = metadataCache;

    metadataCache.vault = this;
  }

  getMarkdownFiles(): TFile[] {
    return [...this.metadataCache.files.values()].filter(
      (file) => file.extension === "md",
    );
  }

  getFolderByPath(_path: string): TFolder | null {
    return null;
  }

  getAbstractFileByPathInsensitive(path: string): TAbstractFile | null {
    return this.getAbstractFileByPath(path);
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.getFileByPath(path);
  }

  read(file: TFile): Promise<string> {
    return Promise.resolve(this.bodies.get(file.path) ?? "");
  }

  readonly adapter = {
    getResourcePath: (path: string) => `app://test/${path}`,
    read: (path: string): Promise<string> =>
      Promise.reject(new Error(`The harness reads no path: ${path}`)),
  };

  process(file: TFile): Promise<string> {
    return Promise.reject(
      new Error(`The harness writes no note: ${file.path}`),
    );
  }

  create(path: string): Promise<TFile> {
    return Promise.reject(new Error(`The harness writes no note: ${path}`));
  }

  createFolder(path: string): Promise<TFolder> {
    return Promise.reject(new Error(`The harness writes no folder: ${path}`));
  }

  trash(file: TAbstractFile): Promise<void> {
    return Promise.reject(
      new Error(`The harness writes no note: ${file.path}`),
    );
  }

  getFileByPath(path: string): TFile | null {
    return this.metadataCache.files.get(path) ?? null;
  }

  cachedRead(file: TFile): Promise<string> {
    this.reads.push(file.path);
    const failure = this.#failures.get(file.path);
    if (failure) return Promise.reject(failure);
    const body = this.bodies.get(file.path) ?? "";
    const gate = this.#held.get(file.path);
    if (!gate) return Promise.resolve(body);
    this.#held.delete(file.path);
    return gate.promise.then(() => body);
  }

  hold(path: string): () => void {
    const gate = Promise.withResolvers<void>();
    this.#held.set(path, gate);
    return () => gate.resolve();
  }

  fail(path: string, error: Error = new Error("read failed")): void {
    this.#failures.set(path, error);
  }

  write(file: TFile, body: string): void {
    this.bodies.set(file.path, body);
    file.stat = statOf(body);
  }

  on(name: VaultEventName, callback: Callback): EventRef {
    this.#listeners[name].add(callback);
    return { e: this, name, callback };
  }

  offref(ref: EventRef): void {
    const { name, callback } = ref as unknown as {
      name: VaultEventName;
      callback: Callback;
    };
    this.#listeners[name].delete(callback);
  }

  deleteFile(file: TFile): void {
    this.bodies.delete(file.path);
    this.metadataCache.delete(file);
  }

  rename(file: TFile, path: string): void {
    const oldPath = file.path;
    const cache = this.metadataCache.fileCache.get(oldPath);
    this.metadataCache.files.delete(oldPath);
    this.metadataCache.fileCache.delete(oldPath);
    this.bodies.set(path, this.bodies.get(oldPath) ?? "");
    this.bodies.delete(oldPath);
    updateFilePath(file, path);
    this.metadataCache.files.set(path, file);
    if (cache) this.metadataCache.fileCache.set(path, cache);
    for (const callback of this.#listeners.rename) callback(file, oldPath);
  }
}

export class DatabaseStub implements AsyncDisposable {
  state: "loading" | "ready" | "degraded" = "ready";
  readonly citekeys = new CitekeysStub(defaultCitekeys());
  itemReads = 0;
  libraries = () => [personalLibrary(), groupLibrary()];
  snapshotError: DbUnavailable | null = null;
  readonly #service: TestReads;
  readonly #changed = testEvent<void>();
  readonly #degraded = testEvent<DbUnavailable>();
  readonly changed = this.#changed.stream;
  readonly degraded = this.#degraded.stream;
  readonly "refresh-failed" = Stream.empty;
  readonly refreshing = Stream.empty;
  readonly "db-file-missing" = Stream.empty;
  readonly "refresh-requested" = Stream.empty;
  readonly current: Effect.Effect<ZoteroReadsState> = Effect.sync(() => ({
    state: this.state,
    error: null,
    moved: false,
    dbFileMissing: false,
    activeReadMode: null,
  }));
  readonly events = Stream.merge(
    this.changed.pipe(Stream.map(() => ({ _tag: "changed" as const }))),
    this.degraded.pipe(
      Stream.map((error) => ({ _tag: "degraded" as const, error })),
    ),
  );
  readonly #ready = Promise.withResolvers<void>();

  constructor({
    readyImmediately = true,
    seed,
  }: { readyImmediately?: boolean; seed?: string } = {}) {
    if (readyImmediately) this.#ready.resolve();
    this.#seed = seed;
    this.#service = inProcessReadsService(
      memoryOpener(() => this.#sql()).open,
      {
        wrap: (client) => ({
          ...client,
          ItemsByIndexedKeys: (...args) => {
            this.itemReads += 1;
            return client.ItemsByIndexedKeys(...args);
          },
        }),
      },
    );
  }

  #seed?: string;
  #lastSql: string | null = null;
  #refresh: Promise<void> | null = null;

  #sql(): string {
    if (this.#seed !== undefined) return this.#seed;
    const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
    const statements = [
      "insert into itemTypes (itemTypeID, typeName) values (1, 'journalArticle');",
      "insert into fieldsCombined (fieldID, fieldName, custom) values (11, 'citationKey', 0);",
    ];
    const libraries = this.libraries();
    for (const library of libraries) {
      statements.push(
        `insert into libraries (libraryID, type) values (${library.libraryID}, '${library.selector.type === "personal" ? "user" : "group"}');`,
      );
      if (library.selector.type === "group")
        statements.push(
          `insert into groups (groupID, libraryID, name) values (${library.selector.groupID}, ${library.libraryID}, ${quote(library.name ?? "")});`,
        );
    }
    const used = new Set<number>();
    let next = Math.max(0, ...this.citekeys.rows.map((row) => row.itemID));
    for (const row of this.citekeys.rows) {
      const library = libraries.find(
        (entry) => entry.libraryID === row.libraryID,
      );
      if (!library) continue;
      const itemID = used.has(row.itemID) ? ++next : row.itemID;
      used.add(itemID);
      const suffix =
        library.selector.type === "group" ? `g${library.selector.groupID}` : "";
      const key =
        suffix && row.indexedKey.endsWith(suffix)
          ? row.indexedKey.slice(0, -suffix.length)
          : row.indexedKey;
      statements.push(
        `insert into items (itemID, itemTypeID, libraryID, key, dateAdded, dateModified) values (${itemID}, 1, ${row.libraryID}, ${quote(key)}, '2024-01-01 00:00:00', '2024-01-01 00:00:00');`,
      );
      statements.push(
        `insert into itemDataValues (valueID, value) values (${itemID}, ${quote(row.citekey)});`,
      );
      statements.push(
        `insert into itemData (itemID, fieldID, valueID) values (${itemID}, 11, ${itemID});`,
      );
    }
    return statements.join("\n");
  }

  #lookupBarrier: {
    entered: PromiseWithResolvers<void>;
    release: PromiseWithResolvers<void>;
  } | null = null;

  holdLookup() {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    this.#lookupBarrier = { entered, release };
    return { entered: entered.promise, release: () => release.resolve() };
  }

  readonly #client = () =>
    Effect.map(
      Effect.promise(() => this.#service.ready),
      ({ client }) =>
        ({
          ...client,
          CitationLookup: (payload, options) =>
            Effect.gen({ self: this }, function* () {
              yield* Effect.promise(() => this.#ready.promise);
              const barrier = this.#lookupBarrier;
              this.#lookupBarrier = null;
              if (barrier) {
                barrier.entered.resolve();
                yield* Effect.promise(() => barrier.release.promise);
              }
              if (this.state === "degraded" || this.citekeys.error)
                return yield* new DbUnavailable({
                  message:
                    this.citekeys.error instanceof Error
                      ? this.citekeys.error.message
                      : "Database unavailable",
                });
              const sql = this.#sql();
              if (sql !== this.#lastSql) {
                this.#lastSql = sql;
                this.citekeys.calls.push(
                  ...this.libraries().map((library) => library.libraryID),
                );
                this.#refresh = this.#service.bridge.runPromise(
                  this.#service.refresh,
                );
              }
              yield* Effect.promise(() => this.#refresh ?? Promise.resolve());
              return yield* client.CitationLookup(payload, options);
            }),
        }) as ZoteroReadsClient,
    );

  get ready(): TestReads["ready"] {
    return this.#ready.promise.then(async () => ({
      ...(await this.#service.ready),
      client: await Effect.runPromise(this.#client()),
    }));
  }

  get reads() {
    const CitationLookup = ((
      ...args: Parameters<ZoteroReadsClient["CitationLookup"]>
    ) =>
      Effect.flatMap(this.#client(), (client) =>
        client.CitationLookup(...args),
      )) as ZoteroReads["Service"]["reads"]["CitationLookup"];
    return stubService<ZoteroReads["Service"]["reads"]>("ZoteroReads.reads", {
      ...this.#service.reads,
      CitationLookup,
    });
  }

  async acquireRead(): Promise<ZoteroReadLease> {
    await this.#ready.promise;
    return this.#service.acquireRead();
  }

  get snapshot(): ZoteroReads["Service"]["snapshot"] {
    return Effect.andThen(
      Effect.promise(() => this.#ready.promise),
      Effect.suspend(() =>
        this.snapshotError
          ? Effect.fail(this.snapshotError)
          : this.#service.snapshot,
      ),
    );
  }

  settle(): void {
    this.#ready.resolve();
  }

  notifyChanged(): void {
    this.#changed.emit();
  }

  async replaceRows(seed: string): Promise<void> {
    this.#seed = seed;
    this.#lastSql = seed;
    await this.#service.bridge.runPromise(this.#service.refresh);
    this.notifyChanged();
  }

  degrade(): void {
    this.state = "degraded";
    const error = new DbUnavailable({ message: "Database unavailable" });
    this.#degraded.emit(error);
  }

  [Symbol.asyncDispose](): Promise<void> {
    return Promise.resolve(this.#service[Symbol.asyncDispose]());
  }
}

export class CitekeysStub {
  rows: LibraryCitekey[];
  error: unknown = null;
  readonly calls: number[] = [];

  constructor(rows: LibraryCitekey[]) {
    this.rows = rows;
  }
}

export class LibraryScopeStub {
  libraries: AvailableLibrary[];
  ready = Promise.resolve();
  readonly #changed = testEvent<ResolvedLibraryScope | null>();
  readonly #libraries = testEvent<void>();
  readonly changed = this.#changed.stream;
  readonly "libraries-changed" = this.#libraries.stream;
  #current: ResolvedLibraryScope | null;

  constructor(libraries: AvailableLibrary[] = [personalLibrary()]) {
    this.libraries = libraries;
    this.#current = allOf(libraries);
  }

  resolveLibraries(libraries: readonly Library[]): ResolvedLibraryScope {
    const scope = this.#current;
    return resolveLibraryScope(
      libraries,
      scope?.mode === "selected"
        ? {
            mode: "selected",
            libraries: [
              ...scope.available.map((library) => library.selector),
              ...scope.unavailable,
            ],
          }
        : { mode: "all" },
    );
  }

  get effective(): LibraryScope {
    const scope = this.#current;
    return scope?.mode === "selected"
      ? {
          mode: "selected",
          libraries: [
            ...scope.available.map((library) => library.selector),
            ...scope.unavailable,
          ],
        }
      : { mode: "all" };
  }

  get current(): ResolvedLibraryScope | null {
    return this.#current;
  }

  holdLibraries(libraries: AvailableLibrary[]): void {
    this.libraries = libraries;
    this.#emit("libraries-changed");
  }

  select(available: AvailableLibrary[]): void {
    this.#current = {
      mode: "selected",
      invalid: false,
      available,
      unavailable: [],
    };
    this.#emit();
  }

  selectAll(libraries: AvailableLibrary[] = this.libraries): void {
    this.libraries = libraries;
    this.#current = allOf(libraries);
    this.#emit();
  }

  #emit(event: keyof LibraryScopeEvents = "changed"): void {
    if (event === "changed") this.#changed.emit(this.#current);
    else this.#libraries.emit();
  }
}

function allOf(libraries: AvailableLibrary[]): ResolvedLibraryScope {
  return { mode: "all", invalid: false, available: libraries, unavailable: [] };
}

function defaultCitekeys(): LibraryCitekey[] {
  return [
    {
      itemID: 1,
      libraryID: MY_LIBRARY_ID,
      key: "DOE2024",
      indexedKey: KEY_A,
      citekey: "doe2024",
    },
    {
      itemID: 2,
      libraryID: GROUP_LIBRARY_ID,
      key: "ZZZ99999",
      indexedKey: KEY_B,
      citekey: "roe2025",
    },
  ];
}

export class MemoryStore implements CitekeyStore {
  readonly records = new Map<string, CitekeyRecord>();
  readonly writes: string[] = [];

  load(): Promise<CitekeyRecord[]> {
    return Promise.resolve([...this.records.values()]);
  }

  put(record: CitekeyRecord): Promise<void> {
    this.writes.push(record.path);
    this.records.set(record.path, structuredClone(record));
    return Promise.resolve();
  }

  drop(path: string): Promise<void> {
    this.records.delete(path);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.records.clear();
    return Promise.resolve();
  }

  [Symbol.dispose](): void {}
}

export interface CitationIndexHarness extends AsyncDisposable {
  host: HostSources & {
    metadataCache: MockMetadataCache;
    vault: MockVault;
    workspace: MemoryWorkspace;
  };
  draft: TFile;
  index: CitationIndex["Service"] & {
    bridge: EffectBridge;
    runtime: import("@zotlit/plugin-kernel/effect-stream.ts").SubscriptionRuntime;
  };
  ready: Promise<void>;
  runtime: ReturnType<typeof citationIndexFixture>["runtime"];
  closeIndex: () => Promise<void>;
  lookup: Awaited<ReturnType<typeof citationLookupFixture>>;
  metadataCache: MockMetadataCache;
  noteIndex: ReturnType<typeof buildNoteIndex>;
  settings: SettingsFixture;
  settingsBridge: SettingsFixture["bridge"];
  store: MemoryStore;
  vault: MockVault;
  workspace: MemoryWorkspace;
  db: DatabaseStub;
  citekeys: CitekeysStub;
  libraryScope: LibraryScopeStub;
  queryClient: QueryClients["Service"];
  passCooldown: () => void;
}

export interface CitationIndexHarnessOptions {
  context?: Context.Context<never>;
  parseClient?: ParseClient;
  openStore?: () => Promise<CitekeyStore>;
  settings?: Partial<Settings>;
  store?: MemoryStore;
  citekeys?: LibraryCitekey[];
  db?: DatabaseStub;
  zoteroRows?: string;
  notes?: boolean;
  settingsService?: SettingsFixture;
  awaitReady?: boolean;
  libraryScope?: LibraryScopeStub;
}

export async function createCitationIndexHarness(
  documents: Record<string, string>,
  options: CitationIndexHarnessOptions = {},
): Promise<CitationIndexHarness> {
  await using stack = new AsyncDisposableStack();
  const metadataCache = new MockMetadataCache();
  const vault = new MockVault(metadataCache);
  const workspace = new MemoryWorkspace();
  const store = options.store ?? new MemoryStore();
  const db = stack.use(
    options.db ?? new DatabaseStub({ seed: options.zoteroRows }),
  );
  const { citekeys } = db;
  if (options.citekeys) citekeys.rows = options.citekeys;
  const libraryScope =
    options.libraryScope ??
    new LibraryScopeStub([personalLibrary(), groupLibrary()]);

  db.libraries = () => [...libraryScope.libraries];

  const addFile = (path: string, body: string): TFile => {
    const added = makeFile(path, body);
    metadataCache.files.set(path, added);
    vault.bodies.set(path, body);
    return added;
  };
  if (options.notes ?? true) {
    for (const [citekey, indexedKey] of [
      ["doe2024", KEY_A],
      ["roe2025", KEY_B],
    ] as const) {
      const path = citekey === "doe2024" ? "Doe 2024.md" : "Roe 2025.md";
      addFile(path, "");
      metadataCache.fileCache.set(path, {
        frontmatter: {
          [FIELD_ZOTERO_KEY]: indexedKey,
          [FIELD_CITEKEY]: citekey,
        },
      });
    }
  }
  for (const [path, body] of Object.entries(documents)) {
    addFile(path, body);
    metadataCache.fileCache.set(path, { links: [] });
  }

  const host = { metadataCache, vault, workspace };
  const noteIndex = buildNoteIndex(
    {
      metadataCache,
      vault,
      workspace: new MemoryWorkspace({ layoutReady: true }),
    },
    stack,
  );
  const settings =
    options.settingsService ??
    stack.use(await buildSeededSettings(options.settings));
  const clock = testClock();
  const queryClient = stack.use(queryClientsFixture(clock.now));
  const lookup = stack.use(
    await citationLookupFixture({
      reads: db,
      libraryScope,
      queryClient,
    }),
  );
  const fixture = citationIndexFixture(
    {
      host,
      db,
      libraryScope,
      noteIndex,
      settings,
      lookup: lookup.runtime.runSync(CitationLookup),
      parseClient: options.parseClient ?? inProcessParseClient,
      openStore: options.openStore ?? (() => Promise.resolve(store)),
      context: options.context,
    },
    stack,
  );
  let index: CitationIndex["Service"] & {
    bridge: EffectBridge;
    runtime: import("@zotlit/plugin-kernel/effect-stream.ts").SubscriptionRuntime;
  };
  const ready = fixture.ready.then((value) => {
    index = value;
  });
  const awaitReady = options.awaitReady ?? true;
  if (awaitReady) await ready;
  if (awaitReady && !options.db)
    await lookup.bridge.runPromise(lookup.whenResolved);
  vault.reads.length = 0;
  store.writes.length = 0;
  const resources = stack.move();

  return {
    host,
    draft: metadataCache.files.get("draft.md")!,
    get index() {
      return index;
    },
    ready,
    runtime: fixture.runtime,
    closeIndex: () => fixture.runtime.dispose(),
    lookup,
    metadataCache,
    noteIndex,
    settings,
    settingsBridge: settings.bridge,
    store,
    vault,
    workspace,
    db,
    citekeys,
    libraryScope,
    queryClient,
    passCooldown: clock.passCooldown,
    [Symbol.asyncDispose]: () => resources.disposeAsync(),
  };
}

type Listener = (...data: never[]) => unknown;

function listenOn(source: Pick<Events, "on">) {
  return (name: string, callback: Listener): EventRef =>
    source.on(name, (...data: unknown[]) =>
      Reflect.apply(callback, undefined, data),
    );
}

export function harnessApp(
  { metadataCache, vault }: CitationIndexHarness["host"],
  workspace: App["workspace"],
): App {
  return stubService<App>("App", {
    metadataCache: stubService<App["metadataCache"]>("MetadataCache", {
      getFileCache: (file) => metadataCache.getFileCache(file),
      getCache: (path) => metadataCache.getCache(path),
      getFirstLinkpathDest: (linkpath, sourcePath) =>
        metadataCache.getFirstLinkpathDest(linkpath, sourcePath),
      on: listenOn(metadataCache),
      offref: (ref) => metadataCache.offref(ref),
    }),
    vault: stubService<App["vault"]>("Vault", {
      getFileByPath: (path) => vault.getFileByPath(path),
      getAbstractFileByPath: (path) => vault.getAbstractFileByPath(path),
      getAbstractFileByPathInsensitive: (path) =>
        vault.getAbstractFileByPathInsensitive(path),
      getMarkdownFiles: () => vault.getMarkdownFiles(),
      cachedRead: (file) => vault.cachedRead(file),
      read: (file) => vault.read(file),
      on: listenOn(vault),
      offref: (ref) => vault.offref(ref),
    }),
    workspace,
  });
}

export function link(
  target: string,
  offset: number,
  original?: string,
): LinkCache {
  const raw = original ?? `[[${target}]]`;
  return {
    link: target,
    original: raw,
    position: {
      start: { line: 0, col: offset, offset },
      end: {
        line: 0,
        col: offset + raw.length,
        offset: offset + raw.length,
      },
    },
  };
}

export function makeFile(path: string, body: string): TFile {
  const added = new TFile();
  added.stat = statOf(body);
  updateFilePath(added, path);
  return added;
}

function statOf(body: string): FileStats {
  let mtime = 0;
  for (let at = 0; at < body.length; at += 1) {
    mtime = (mtime * 31 + body.charCodeAt(at)) | 0;
  }
  return { ctime: 0, mtime: mtime >>> 0, size: body.length };
}

function updateFilePath(file: TFile, path: string): void {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  file.path = path;
  file.name = name;
  file.basename = dot === -1 ? name : name.slice(0, dot);
  file.extension = dot === -1 ? "" : name.slice(dot + 1);
}
