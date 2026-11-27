import type { QueryHostDeps } from "#__fixtures__/query-view/host.ts";
import type {
  QueryViewOutcome,
  QueryViewRequest,
} from "#worker/item-query/query-view.ts";
import { Stream } from "effect";
import type { App, EmbedContext } from "obsidian";
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

import { createQueryFileEmbed } from "./embed.ts";
import type { QueryView, QueryViewDeps } from "./view.tsx";

// @vitest-environment happy-dom
import { makeQueryHost } from "#__fixtures__/query-view/host.ts";
import { noLiteratureNotes } from "#__fixtures__/query-view/literature-notes.ts";
import { openTextFileView } from "#__fixtures__/query-view/open-text-view.ts";
import { fakeQuery } from "#__fixtures__/query-view/query-run.ts";
import { layerUnreadViewServices } from "#__fixtures__/view-atoms.ts";
import { QueryCardFocus } from "#obsidian/query-view/card-focus.ts";

const FILE_PATH = "query-files/Reading.zotquery";
const FILE = `views:
  - type: annotations
    name: Yellow
    from: annotations
    filters: colorName == "yellow"
  - type: annotations
    name: Mine
    from: annotations
    filters: item == this.item
`;
const NOTE = `---
zotero-key: RUGIER24
---
![[Reading.zotquery]]
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

async function setup() {
  setMockPlatform({ isMacOS: true });
  cleanup.defer(resetMockPlatform);
  const host = createObsidianHost({
    [FILE_PATH]: FILE,
    "notes/Lab.md": NOTE,
    "notes/Plain.md": "No properties\n",
  });
  const app = stubService<App>("App", {
    vault: host.vault as unknown as App["vault"],
    metadataCache: host.metadataCache as unknown as App["metadataCache"],
    workspace: Object.assign(host.workspace, {
      getLeaf: vi.fn(),
    }) as unknown as App["workspace"],
    scope: stubService<App["scope"]>("Scope", {}),
    keymap: stubService<App["keymap"]>("Keymap", {
      pushScope: () => {},
      popScope: () => {},
    }),
  });
  const run = vi.fn((_request: QueryViewRequest, _signal: AbortSignal) =>
    Promise.resolve(EMPTY),
  );
  const runtime = testRuntime();
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
    query: fakeQuery(run),
    cardFocus: new QueryCardFocus(app),
    nearScreen: (_el, near) => {
      near();
      return () => {};
    },
    opener: stubService<QueryViewDeps["opener"]>("TargetOpener", {}),
    literatureNotes: noLiteratureNotes(),
  });
  const queryHost = cleanup.use(
    await makeQueryHost(layerUnreadViewServices, deps),
  );
  deps.registry = queryHost.registry;

  async function embed(
    sourcePath: string,
    subpath = "",
  ): Promise<{ el: HTMLElement; view: QueryView }> {
    const el = document.createElement("div");
    document.body.append(el);
    const context: EmbedContext = {
      app,
      containerEl: el,
      linktext: `Reading.zotquery${subpath}`,
      sourcePath,
      depth: 1,
    };
    const component = createQueryFileEmbed(deps)(
      context,
      host.file(FILE_PATH),
      subpath,
    );
    await act(async () => {
      component.load();
      await component.loadFile();
      await viewOf(el).settled;
    });
    cleanup.defer(() => act(() => component.unload()));
    return { el, view: viewOf(el) };
  }

  async function preview(subpath = ""): Promise<HTMLElement> {
    const draft = document.body.createDiv();
    draft.dataset["zotlitDraft"] = "";
    const el = draft.createDiv();
    const component = createQueryFileEmbed(deps)(
      {
        app,
        containerEl: el,
        linktext: `Reading.zotquery${subpath}`,
        sourcePath: "notes/Lab.md",
        depth: 1,
      },
      host.file(FILE_PATH),
      subpath,
    );
    await act(async () => {
      component.load();
      await component.loadFile();
    });
    cleanup.defer(() => act(() => component.unload()));
    return el;
  }
  return { host, run, embed, preview };
}

const viewOf = (el: HTMLElement): QueryView =>
  (el as HTMLElement & { zotlitQueryView: QueryView }).zotlitQueryView;

const viewName = (el: HTMLElement) =>
  el.querySelector("[data-query-view-menu]")?.textContent;

it("shows the first view, or the view the link names", async () => {
  const { embed, run } = await setup();
  const plain = await embed("notes/Lab.md");
  expect(viewName(plain.el)).toBe("Yellow");
  const named = await embed("notes/Lab.md", "#Mine");
  expect(viewName(named.el)).toBe("Mine");
  expect(run.mock.calls.at(-1)![0].filter).toBe("item == this.item");
});

it("shows a placeholder named after the file in a note preview", async () => {
  const { preview, run } = await setup();
  const plain = await preview();
  expect(
    plain.querySelector("[data-query-placeholder]")?.textContent,
  ).toContain("Reading");
  expect(viewOf(plain)).toBeUndefined();
  expect(plain.querySelector('[role="toolbar"]')).toBeNull();
  const named = await preview("#Mine");
  expect(named.textContent).toContain("Reading › Mine");
  expect(run).not.toHaveBeenCalled();
});

it("lists in the preview placeholder each view it shows, and the ones bound to the note's item", async () => {
  const { preview } = await setup();
  const views = (el: HTMLElement) =>
    [...el.querySelectorAll("[data-query-placeholder-view]")].map(
      (row) => row.textContent,
    );
  const plain = await preview();
  expect(views(plain)).toEqual([
    "YellowAnnotations",
    "MineAnnotations · Only this note's item",
  ]);
  expect(views(await preview("#Mine"))).toEqual([
    "MineAnnotations · Only this note's item",
  ]);
  const missing = await preview("#Methods");
  expect(views(missing)).toEqual([]);
  expect(
    missing.querySelector("[data-query-placeholder-problem]")?.textContent,
  ).toBe('The query has no view named "Methods".');
});

it("saves through an open tab of the file, so the tab shows the change", async () => {
  const { embed, host } = await setup();
  const tab = openTextFileView(host, host.file(FILE_PATH));
  const { view } = await embed("notes/Lab.md");
  await act(async () => {
    view.document.moveView(1, 0);
    await view.flush();
  });
  expect(tab.getViewData().indexOf("name: Mine")).toBeLessThan(
    tab.getViewData().indexOf("name: Yellow"),
  );
  expect(host.text(FILE_PATH)).toBe(tab.getViewData());
});
