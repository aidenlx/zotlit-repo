import type { QueryHostDeps } from "#__fixtures__/query-view/host.ts";
import type { QueryViewOutcome } from "#desktop/item-query/query-view.ts";
import { Stream } from "effect";
import { debounce } from "obsidian";
import type { App, WorkspaceLeaf } from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";

import { testAnnotHost } from "@zotlit/annotations/__fixtures__/annot-view/host.ts";
import { createObsidianHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host.ts";
import {
  resetMockPlatform,
  setMockPlatform,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { testRuntime } from "@zotlit/plugin-kernel/__fixtures__/runtime.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { QueryFileView } from "./file-view.ts";
import type { QueryViewDeps } from "./view.tsx";

// @vitest-environment happy-dom
import { makeQueryHost } from "#__fixtures__/query-view/host.ts";
import { noLiteratureNotes } from "#__fixtures__/query-view/literature-notes.ts";
import { fakeQuery } from "#__fixtures__/query-view/query-run.ts";
import { layerUnreadViewServices } from "#__fixtures__/view-atoms.ts";

const FILE = `views:
  - type: annotations
    name: Mine
    from: annotations
`;

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

let cleanup = new AsyncDisposableStack();
afterEach(async () => {
  await cleanup.disposeAsync();
  cleanup = new AsyncDisposableStack();
  document.body.replaceChildren();
});

async function openTab() {
  setMockPlatform({ isMacOS: true });
  cleanup.defer(resetMockPlatform);
  const host = createObsidianHost({});
  const runtime = testRuntime();
  const app = stubService<App>("App", {
    scope: stubService<App["scope"]>("Scope", {}),
    vault: host.vault as unknown as App["vault"],
    metadataCache: host.metadataCache as unknown as App["metadataCache"],
    workspace: Object.assign(host.workspace, {
      requestSaveLayout: debounce(() => Promise.resolve(), 0),
    }) as unknown as App["workspace"],
  });
  const deps = stubService<QueryViewDeps & QueryHostDeps>("QueryViewDeps", {
    runtime,
    registry: testAnnotHost(layerUnreadViewServices).registry,
    app,
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
    cardFocus: stubService<QueryViewDeps["cardFocus"]>("QueryCardFocus", {
      hold: () => ({ [Symbol.dispose]: () => {} }),
    }),
    opener: stubService<QueryViewDeps["opener"]>("TargetOpener", {}),
    literatureNotes: noLiteratureNotes(),
  });
  const queryHost = cleanup.use(
    await makeQueryHost(layerUnreadViewServices, deps),
  );
  deps.registry = queryHost.registry;
  const leaf = stubService<WorkspaceLeaf>("WorkspaceLeaf", {
    updateHeader: vi.fn(),
  });
  Object.defineProperty(leaf, "app", { value: deps.app });
  const tab = new QueryFileView(leaf, deps);
  const written: string[] = [];
  const write = vi.fn(async (text: string) => {
    written.push(text);
  });
  let saving = false;
  let again = false;
  tab.save = async () => {
    if (saving) {
      again = true;
      return;
    }
    saving = true;
    again = false;
    try {
      await write(tab.getViewData());
    } finally {
      saving = false;
      if (again) void tab.save();
    }
  };
  const requestSave = vi.fn();
  tab.requestSave = requestSave;
  document.body.append(tab.contentEl);
  tab.query.load();
  await act(() => tab.query.render(tab.contentEl));
  cleanup.defer(() => tab.query.unload());
  await act(async () => {
    tab.setViewData(FILE);
    await tab.query.settled;
  });
  return { tab, write, written, requestSave };
}

const notSaved = (tab: QueryFileView) => tab.query.state.getState().saveFailed;

it("writes a toolbar change to the file at once", async () => {
  const { tab, written, requestSave } = await openTab();
  await act(async () => {
    tab.query.document.addView("Yellow");
    await tab.query.flush();
  });
  expect(written).toHaveLength(1);
  expect(written[0]).toContain("name: Yellow");
  expect(requestSave).not.toHaveBeenCalled();
});

it("says a change is not saved when the write fails, until a later write succeeds", async () => {
  const { tab, write } = await openTab();
  write.mockRejectedValueOnce(new Error("disk full"));
  await act(async () => {
    tab.query.document.addView("Yellow");
    await tab.query.flush();
  });
  expect(notSaved(tab)).toBe(true);
  expect(tab.query.state.getState().view?.name).toBe("Yellow");

  await act(async () => {
    tab.query.document.addView("Blue");
    await tab.query.flush();
  });
  expect(notSaved(tab)).toBe(false);
});

it("writes a second change that comes while the first is writing", async () => {
  const { tab, write, written } = await openTab();
  const first = Promise.withResolvers<void>();
  write.mockImplementationOnce(async (text) => {
    written.push(text);
    await first.promise;
  });
  await act(async () => {
    tab.query.document.addView("Yellow");
    tab.query.document.addView("Blue");
    first.resolve();
    await tab.query.flush();
  });
  expect(written.at(-1)).toContain("name: Blue");
});

it("says a change is not saved when the write of a change that came during another write fails", async () => {
  const { tab, write } = await openTab();
  const first = Promise.withResolvers<void>();
  write
    .mockImplementationOnce(() => first.promise)
    .mockRejectedValueOnce(new Error("disk full"));
  await act(async () => {
    tab.query.document.addView("Yellow");
    tab.query.document.addView("Blue");
    first.resolve();
    await tab.query.flush();
  });
  expect(notSaved(tab)).toBe(true);
});
