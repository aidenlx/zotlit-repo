import { Stream } from "effect";
import { Layer } from "effect";
import type { App } from "obsidian";
import { Scope } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";

import { makeAnnotHost } from "@zotlit/annotations/__fixtures__/annot-view/host.ts";
import { PluginStub } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host.ts";
// @vitest-environment happy-dom
import {
  resetMockPlatform,
  setMockPlatform,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { testRuntime } from "@zotlit/plugin-kernel/__fixtures__/runtime.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import type { QueryHostDeps } from "@zotlit/query-views/__fixtures__/query-view/host.ts";
import { makeQueryHost } from "@zotlit/query-views/__fixtures__/query-view/host.ts";
import { noLiteratureNotes } from "@zotlit/query-views/__fixtures__/query-view/literature-notes.ts";
import { fakeQuery } from "@zotlit/query-views/__fixtures__/query-view/query-run.ts";
import { QueryView } from "@zotlit/query-views/desktop/query-view/view.tsx";
import type { QueryViewDeps } from "@zotlit/query-views/desktop/query-view/view.tsx";
import type { QueryViewOutcome } from "@zotlit/query-views/worker/item-query/query-view.ts";

import type { LibraryViewDocument } from "./document.ts";
import {
  DEFAULT_LIBRARY_VIEW_DOCUMENT,
  libraryViewQuery,
  withCardWidth,
  withExpanded,
  withSearch,
} from "./document.ts";
import { LibraryViewStorage } from "./storage.ts";

import { makeLibraryHost } from "#__fixtures__/library.ts";
import { buildSettings } from "#__fixtures__/settings.ts";
import { layerUnreadViewServices } from "#__fixtures__/view-atoms.ts";

const LABELS = {
  papers: "Papers",
};

const EMPTY: QueryViewOutcome = {
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
};

const STORED = {
  node: {
    kind: "collection",
    library: { type: "personal" },
    path: ["Thesis", "Chapter 2"],
  },
  facets: ["annotated"],
  search: "",
  sort: [{ property: "dateModified", direction: "DESC" }],
  card: { allFields: false, annotations: false },
};

const STORED_EARLIER = {
  ...STORED,
  layout: "table",
  order: ["title", "creators"],
};

let cleanup = new AsyncDisposableStack();
afterEach(async () => {
  await cleanup.disposeAsync();
  cleanup = new AsyncDisposableStack();
  document.body.replaceChildren();
});

async function openLibrary() {
  setMockPlatform({ isMacOS: true });
  cleanup.defer(resetMockPlatform);
  const app = stubService<App>("App", {});
  const plugin = new PluginStub(app, {
    __VERSION__: 10,
    "library.document": STORED_EARLIER,
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
  await settings.bridge.runPromise(settings.loaded);
  const saveData = vi.spyOn(plugin, "saveData");
  const runtime = testRuntime();
  const cardsHost = cleanup.use(makeAnnotHost(layerUnreadViewServices));
  const deps = stubService<QueryViewDeps & QueryHostDeps>("QueryViewDeps", {
    registry: cardsHost.registry,
    runtime,
    app,
    opener: stubService<QueryViewDeps["opener"]>("TargetOpener", {}),
    reads: stubService<QueryHostDeps["reads"]>("ZoteroReads", {
      changed: Stream.empty,
      degraded: Stream.empty,
      "refresh-failed": Stream.empty,
      refreshing: Stream.empty,
      "db-file-missing": Stream.empty,
      "refresh-requested": Stream.empty,
    }),
    libraryScope: stubService<QueryHostDeps["libraryScope"]>("LibraryScope", {
      changed: Stream.empty,
      "libraries-changed": Stream.empty,
      current: null,
    }),
    query: fakeQuery(() => Promise.resolve(EMPTY)),
    cardFocus: { hold: () => ({ [Symbol.dispose]: () => {} }) },
    literatureNotes: noLiteratureNotes(),
  });
  const queryHost = cleanup.use(
    await makeQueryHost(layerUnreadViewServices, deps),
  );
  deps.registry = queryHost.registry;
  const toolbar = { text: (): string | null => null };
  const host = cleanup.use(
    await makeLibraryHost({
      services: Layer.succeed(PluginSettings, settings),
    }),
  );
  const storage = new LibraryViewStorage(host.registry, () => toolbar.text());
  cleanup.defer(() => storage.close());
  await storage.load();
  const query = new QueryView(deps, {
    scope: new Scope(),
    sourcePath: () => "",
    context: () => undefined,
    save: () => storage.save(),
  });
  toolbar.text = () => query.document.text;
  const el = document.body.createDiv();
  query.load();
  query.render(el);
  cleanup.defer(() => query.unload());
  await act(async () => {
    query.setText(
      libraryViewQuery(storage.document(), {
        labels: LABELS,
        scope: { mode: "all" },
      }).text,
    );
    await query.settled;
  });
  return { query, plugin, saveData, storage, registry: host.registry };
}

const saved = (plugin: PluginStub) =>
  (plugin.data as Record<string, unknown>)["library.document"];

it("reads the document that plugin data holds", async () => {
  const { storage, query } = await openLibrary();
  expect(storage.document()).toEqual<LibraryViewDocument>({
    ...DEFAULT_LIBRARY_VIEW_DOCUMENT,
    sort: [{ property: "dateModified", direction: "DESC" }],
    node: {
      kind: "collection",
      library: { type: "personal" },
      path: ["Thesis", "Chapter 2"],
    },
    facets: ["annotated"],
    expanded: [JSON.stringify(["personal", "Thesis"])],
  });
  expect(query.state.getState().file?.filters).toEqual({
    and: ['collections.within("Thesis/Chapter 2")', "annotations.length > 0"],
  });
});

it("writes a toolbar change to the document in plugin data at once", async () => {
  const { query, plugin, storage } = await openLibrary();
  await act(async () => {
    query.document.editView({
      sort: [{ property: "title", direction: "ASC" }],
    });
    await query.flush();
  });
  expect(saved(plugin)).toEqual({
    ...STORED,
    tags: [],
    expanded: [JSON.stringify(["personal", "Thesis"])],
    sort: [{ property: "title", direction: "ASC" }],
  });
  expect(storage.document().sort).toEqual([
    { property: "title", direction: "ASC" },
  ]);
  expect(query.state.getState().view?.sort).toEqual([
    { property: "title", direction: "ASC" },
  ]);
  expect(query.state.getState().saveFailed).toBe(false);
});

it("says a change is not saved when the write fails, until a later write succeeds", async () => {
  const { query, saveData } = await openLibrary();
  saveData.mockRejectedValueOnce(new Error("disk full"));
  await act(async () => {
    query.document.editView({
      sort: [{ property: "title", direction: "ASC" }],
    });
    await query.flush();
  });
  expect(query.state.getState().saveFailed).toBe(true);
  expect(query.state.getState().view?.sort).toEqual([
    { property: "title", direction: "ASC" },
  ]);

  await act(async () => {
    query.document.editView({
      sort: [{ property: "title", direction: "DESC" }],
    });
    await query.flush();
  });
  expect(query.state.getState().saveFailed).toBe(false);
});

it("writes the changes of one task to disk once, holding the last of them", async () => {
  const { plugin, saveData, storage } = await openLibrary();
  saveData.mockClear();
  const reading = JSON.stringify(["personal", "Reading"]);
  await Promise.all([
    storage.change((doc) => withExpanded(doc, [...doc.expanded, reading])),
    storage.change((doc) => withSearch(doc, "attention")),
  ]);
  expect(saveData).toHaveBeenCalledTimes(1);
  expect(saved(plugin)).toMatchObject({
    expanded: [JSON.stringify(["personal", "Thesis"]), reading],
    search: "attention",
  });
});

it("writes once more after a write that runs, holding the last change asked for meanwhile", async () => {
  const { plugin, saveData, storage } = await openLibrary();
  saveData.mockClear();
  const disk = Promise.withResolvers<void>();
  saveData.mockImplementationOnce(async (data) => {
    await disk.promise;
    plugin.data = data;
  });
  const first = storage.change((doc) => withSearch(doc, "attention"));
  await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(1));
  const rest = [
    storage.change((doc) => withSearch(doc, "attention is")),
    storage.change((doc) => withSearch(doc, "attention is all")),
  ];
  disk.resolve();
  await Promise.all([first, ...rest]);
  expect(saveData).toHaveBeenCalledTimes(2);
  expect(saved(plugin)).toMatchObject({ search: "attention is all" });
});

it("writes the Reading Card's width to disk at once, and drops it on a reset", async () => {
  const { plugin, saveData, storage } = await openLibrary();
  saveData.mockClear();
  await storage.change((doc) => withCardWidth(doc, 456));
  expect(saveData).toHaveBeenCalledTimes(1);
  expect(saved(plugin)).toMatchObject({ cardWidth: 456 });
  await storage.change((doc) => withCardWidth(doc, undefined));
  expect(saveData).toHaveBeenCalledTimes(2);
  expect(saved(plugin)).not.toHaveProperty("cardWidth");
  expect(storage.document()).not.toHaveProperty("cardWidth");
});

it("finishes a write that has started when the view closes", async () => {
  const { plugin, saveData, storage } = await openLibrary();
  saveData.mockClear();
  const disk = Promise.withResolvers<void>();
  saveData.mockImplementationOnce(async (data) => {
    await disk.promise;
    plugin.data = data;
  });
  const saving = storage.change((doc) => withSearch(doc, "attention"));
  await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(1));
  storage.close();
  await saving;
  disk.resolve();
  await vi.waitFor(() =>
    expect(saved(plugin)).toMatchObject({ search: "attention" }),
  );
});

it("settles a write when the plugin's registry closes under it, as a plugin reload does", async () => {
  const { plugin, saveData, storage, registry } = await openLibrary();
  saveData.mockClear();
  const disk = Promise.withResolvers<void>();
  saveData.mockImplementationOnce(async (data) => {
    await disk.promise;
    plugin.data = data;
  });
  const saving = storage.change((doc) => withSearch(doc, "reload"));
  await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(1));
  registry.dispose();
  disk.resolve();
  await expect(saving).resolves.toBeUndefined();
  expect(saved(plugin)).toMatchObject({ search: "reload" });
});

it("settles a write that has not started when the plugin's registry closes", async () => {
  const { storage, registry } = await openLibrary();
  const saving = storage.change((doc) => withSearch(doc, "closed"));
  registry.dispose();
  await expect(saving).resolves.toBeUndefined();
});
