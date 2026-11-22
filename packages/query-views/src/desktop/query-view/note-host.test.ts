import type { QueryHostDeps } from "#__fixtures__/query-view/host.ts";
import type {
  QueryViewOutcome,
  QueryViewRequest,
} from "#desktop/item-query/query-view.ts";
import { delay } from "@std/async";
import { Stream } from "effect";
import type {
  App,
  EmbedContext,
  MarkdownPostProcessorContext,
  MarkdownRenderChild,
  Scope,
} from "obsidian";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { testAnnotHost } from "@zotlit/annotations/__fixtures__/annot-view/host.ts";
import { createObsidianHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host.ts";
import {
  resetMockPlatform,
  setMockPlatform,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { testRuntime } from "@zotlit/plugin-kernel/__fixtures__/runtime.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { registerQueryBlock } from "./block.ts";
import { createQueryFileEmbed } from "./embed.ts";
import type { QueryView, QueryViewDeps } from "./view.tsx";

// @vitest-environment happy-dom
import { makeQueryHost } from "#__fixtures__/query-view/host.ts";
import { noLiteratureNotes } from "#__fixtures__/query-view/literature-notes.ts";
import { fakeQuery } from "#__fixtures__/query-view/query-run.ts";
import { layerUnreadViewServices } from "#__fixtures__/view-atoms.ts";
import { QueryCardFocus } from "#obsidian/query-view/card-focus.ts";

const FILE_PATH = "query-files/Reading.zotquery";
const FILE = `views:
  - type: annotations
    name: Mine
    from: annotations
    filters: item == this.item
`;
const NOTE = (key: string) => `---
zotero-key: ${key}
---
Text
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
const FAILED: QueryViewOutcome = {
  kind: "failed",
  diagnostic: {
    code: "source-unavailable",
    message: "The Zotero database cannot be read.",
    hint: "Check the Zotero data directory.",
    severity: "error",
    report: ["The Zotero database cannot be read."],
    found: "",
    expected: [],
    suggestions: [],
  },
};
const TABLE = `views:
  - type: table
    name: Papers
    from: items
`;
const ITEMS: QueryViewOutcome = {
  kind: "result",
  result: {
    libraries: [{ type: "personal" }],
    query: { filter: null, fields: [], sort: [], limit: null },
    returnedCount: 1,
    matchedCount: 1,
    truncated: false,
    warnings: [],
    rows: [{ indexedKey: "ITEMAAAA", values: { title: "Ten simple rules" } }],
  },
};

let cleanup = new AsyncDisposableStack();
afterEach(async () => {
  await cleanup.disposeAsync();
  cleanup = new AsyncDisposableStack();
  document.body.replaceChildren();
});

interface Held {
  el: HTMLElement;
  view: QueryView;
  unload: () => void;
}

type HostKind = "embed" | "block";

async function setup(kind: HostKind, file = FILE) {
  setMockPlatform({ isMacOS: true });
  cleanup.defer(resetMockPlatform);
  const host = createObsidianHost({
    [FILE_PATH]: file,
    "notes/Lab.md": NOTE("RUGIER24"),
    "notes/Plain.md": "No properties\n",
  });
  const scopes: Scope[] = [];
  const app = stubService<App>("App", {
    vault: host.vault as unknown as App["vault"],
    metadataCache: host.metadataCache as unknown as App["metadataCache"],
    scope: stubService<App["scope"]>("Scope", {}),
    keymap: stubService<App["keymap"]>("Keymap", {
      pushScope: (scope: Scope) => scopes.push(scope),
      popScope: (scope: Scope) => {
        const index = scopes.indexOf(scope);
        if (index !== -1) scopes.splice(index, 1);
      },
    }),
    workspace: Object.assign(host.workspace, {
      getLeaf: vi.fn(),
    }) as unknown as App["workspace"],
  });
  const cardFocus = new QueryCardFocus(app);
  const run = vi.fn((_request: QueryViewRequest, _signal: AbortSignal) =>
    Promise.resolve(EMPTY),
  );
  const runtime = testRuntime();
  const screen = {
    far: false,
    waiting: new Map<HTMLElement, () => void>(),
    come(el: HTMLElement) {
      screen.waiting.get(el)?.();
    },
  };
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
    cardFocus,
    nearScreen: (el, near) => {
      if (!screen.far) {
        near();
        return () => {};
      }
      screen.waiting.set(el, near);
      return () => screen.waiting.delete(el);
    },
    opener: stubService<QueryViewDeps["opener"]>("TargetOpener", {}),
    literatureNotes: noLiteratureNotes(),
  });
  const queryHost = cleanup.use(
    await makeQueryHost(layerUnreadViewServices, deps),
  );
  deps.registry = queryHost.registry;

  type Plugin = Parameters<typeof registerQueryBlock>[0];
  type Processor = Parameters<Plugin["registerMarkdownCodeBlockProcessor"]>[1];
  let processor: Processor | undefined;
  registerQueryBlock(
    {
      registerMarkdownCodeBlockProcessor: (_language, handler) => {
        processor = handler;
        return () => {};
      },
    },
    deps,
  );

  const viewOf = (el: HTMLElement): QueryView =>
    (el as HTMLElement & { zotlitQueryView: QueryView }).zotlitQueryView;

  function show(
    sourcePath: string,
    parent: HTMLElement,
  ): Promise<Held> & Omit<Held, "view"> {
    const el = parent.createDiv();
    if (kind === "embed") {
      const context: EmbedContext = {
        app,
        containerEl: el,
        linktext: "Reading.zotquery",
        sourcePath,
        depth: 1,
      };
      const component = createQueryFileEmbed(deps)(
        context,
        host.file(FILE_PATH),
        "",
      );
      component.load();
      const unload = () => component.unload();
      cleanup.defer(() => act(unload));
      return Object.assign(
        component.loadFile().then(() => ({ el, view: viewOf(el), unload })),
        { el, unload },
      );
    }
    let child: MarkdownRenderChild | undefined;
    const ctx = stubService<MarkdownPostProcessorContext>(
      "MarkdownPostProcessorContext",
      {
        sourcePath,
        getSectionInfo: () => null,
        addChild: (added: MarkdownRenderChild) => {
          child = added;
          added.load();
        },
      },
    );
    const shown = processor!(file, el, ctx);
    const unload = () => child?.unload();
    cleanup.defer(() => act(unload));
    return Object.assign(
      Promise.resolve(shown).then(() => ({ el, view: viewOf(el), unload })),
      { el, unload },
    );
  }

  async function hold(sourcePath = "notes/Lab.md"): Promise<Held> {
    let held: Held | undefined;
    await act(async () => {
      held = await show(sourcePath, document.body);
      await held.view.settled;
    });
    return held!;
  }
  async function block(
    source: string,
    ctx: Omit<MarkdownPostProcessorContext, "addChild">,
  ): Promise<Held> {
    const el = document.body.createDiv();
    let child: MarkdownRenderChild | undefined;
    await act(async () => {
      const context = stubService<MarkdownPostProcessorContext>(
        "MarkdownPostProcessorContext",
        {
          ...ctx,
          addChild: (added: MarkdownRenderChild) => {
            child = added;
            added.load();
          },
        },
      );
      await processor!(source, el, context);
      await viewOf(el).settled;
    });
    const unload = () => child?.unload();
    cleanup.defer(() => act(unload));
    return { el, view: viewOf(el), unload };
  }
  return { host, run, show, hold, block, scopes, cardFocus, screen, viewOf };
}

describe.each<HostKind>(["embed", "block"])("a %s", (kind) => {
  it("binds `this.item` to the Item of its note", async () => {
    const { hold, run } = await setup(kind);
    await hold("notes/Lab.md");
    expect(run.mock.calls.at(-1)![0].context).toEqual({ item: "RUGIER24" });
    await hold("notes/Plain.md");
    expect(run.mock.calls.at(-1)![0].context).toBeUndefined();
  });

  it("runs again when the note's `zotero-key` changes, and for nothing else", async () => {
    const { hold, run, host } = await setup(kind);
    await hold("notes/Lab.md");
    const edit = async (path: string, text: string) => {
      await act(async () => {
        host.vault.modifyFile(path, text);
        await delay(0);
      });
    };
    const runs = run.mock.calls.length;

    await edit("notes/Lab.md", `${NOTE("RUGIER24")}More text\n`);
    await edit("notes/Plain.md", NOTE("OTHERK34"));
    expect(run).toHaveBeenCalledTimes(runs);

    await edit("notes/Lab.md", NOTE("SMITHJ25"));
    expect(run).toHaveBeenCalledTimes(runs + 1);
    expect(run.mock.calls.at(-1)![0].context).toEqual({ item: "SMITHJ25" });

    await edit("notes/Lab.md", "No properties\n");
    expect(run).toHaveBeenCalledTimes(runs + 2);
    expect(run.mock.calls.at(-1)![0].context).toBeUndefined();
  });

  it("runs nothing until it comes near the screen, and runs then with the note's last Item", async () => {
    const { show, run, host, screen } = await setup(kind);
    screen.far = true;
    let held: Held | undefined;
    await act(async () => {
      held = await show("notes/Lab.md", document.body);
    });
    const { el, view } = held!;
    let settled = false;
    void view.settled.then(() => {
      settled = true;
    });
    await act(async () => {
      host.vault.modifyFile("notes/Lab.md", NOTE("SMITHJ25"));
      await delay(50);
    });
    expect(run).not.toHaveBeenCalled();
    expect(view.state.getState().phase).toBe("waiting");
    expect(settled).toBe(false);
    expect(el.hasAttribute("data-query-waiting")).toBe(true);

    await act(async () => {
      screen.come(el);
      await view.settled;
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0].context).toEqual({ item: "SMITHJ25" });
    expect(view.state.getState().phase).toBe("ready");
    await act(() => view.drawn());
    expect(el.hasAttribute("data-query-waiting")).toBe(false);
  });

  it("settles with its first rows when it comes near the screen before it reads its text", async () => {
    const { show, run } = await setup(kind);
    const answer = Promise.withResolvers<QueryViewOutcome>();
    run.mockReturnValueOnce(answer.promise);
    void delay(50).then(() => answer.resolve(EMPTY));
    let shown: Promise<Held> | undefined;
    let phase: string | undefined;
    await act(async () => {
      shown = show("notes/Lab.md", document.body);
      const el = document.body.lastElementChild as HTMLElement;
      const view = (el as HTMLElement & { zotlitQueryView: QueryView })
        .zotlitQueryView;
      await view.settled;
      phase = view.state.getState().phase;
      await shown;
    });
    expect(phase).toBe("ready");
  });

  it("settles once the first rows show, as Export to PDF waits for it, though it stands far from the screen", async () => {
    const { show, run, screen } = await setup(kind);
    screen.far = true;
    const answer = Promise.withResolvers<QueryViewOutcome>();
    run.mockReturnValueOnce(answer.promise);
    const print = document.body.createDiv({ cls: "print" });
    let printed = false;
    let held: Promise<Held> | undefined;
    await act(async () => {
      held = show("notes/Lab.md", print);
      void held.then(() => {
        printed = true;
      });
      await delay(50);
    });
    expect(run).toHaveBeenCalled();
    expect(printed).toBe(false);

    await act(async () => {
      answer.resolve(EMPTY);
      await delay(50);
    });
    await delay(0);
    expect(printed).toBe(true);
    const { el } = await held!;
    expect(el.querySelector("[data-query-empty]")).not.toBeNull();
  });

  describe("settles in a print where it draws no rows", () => {
    async function printed(shown: () => Promise<unknown>): Promise<boolean> {
      let done = false;
      await act(async () => {
        void shown().then(() => {
          done = true;
        });
        await delay(50);
      });
      await delay(0);
      return done;
    }

    it.each([
      ["holds no view", "views: []\n"],
      ["names a problem in its view", FILE.replace("    name: Mine\n", "")],
    ])("as the file %s", async (_what, file) => {
      const { show } = await setup(kind, file);
      const print = document.body.createDiv({ cls: "print" });
      expect(await printed(() => show("notes/Lab.md", print))).toBe(true);
    });

    it("as its first run fails", async () => {
      const { show, run } = await setup(kind);
      run.mockResolvedValueOnce(FAILED);
      const print = document.body.createDiv({ cls: "print" });
      expect(await printed(() => show("notes/Lab.md", print))).toBe(true);
    });

    it("as it unloads once its rows land, before its Layout draws them", async () => {
      const { show, run, viewOf } = await setup(kind, TABLE);
      const answer = Promise.withResolvers<QueryViewOutcome>();
      run.mockReturnValueOnce(answer.promise);
      const print = document.body.createDiv({ cls: "print" });
      let el: HTMLElement | undefined;
      const done = await printed(async () => {
        const shown = show("notes/Lab.md", print);
        el = shown.el;
        const stop = viewOf(el).state.subscribe((state) => {
          if (state.phase === "ready") shown.unload();
        });
        await delay(10);
        answer.resolve(ITEMS);
        await shown;
        stop();
      });
      expect(done).toBe(true);
      expect(el!.querySelector("[data-query-table-row]")).toBeNull();
    });
  });

  it("keeps a click inside it from selecting it in Live Preview", async () => {
    const { hold } = await setup(kind);
    const { el } = await hold();
    expect(el.classList.contains("interactive-child")).toBe(true);
  });

  it("keeps a drag that starts in it from the note's editor, which would drag the note's text", async () => {
    const { hold } = await setup(kind);
    const note = document.body.createDiv();
    const { el } = await hold();
    note.append(el);
    const editorDrag = vi.fn();
    note.addEventListener("dragstart", editorDrag);
    const handle = el.createEl("a", { attr: { draggable: "true" } });

    handle.dispatchEvent(new DragEvent("dragstart", { bubbles: true }));
    expect(editorDrag).not.toHaveBeenCalled();
  });

  describe("the card keys", () => {
    const control = (el: HTMLElement) => {
      const button = el.querySelector("button");
      if (!button) throw new Error(`The ${kind} shows no button`);
      return button;
    };

    it("are on the keymap while focus is in it, and leave with focus to the note", async () => {
      const { hold, scopes } = await setup(kind);
      const { el } = await hold();
      const note = document.body.createEl("textarea");

      control(el).focus();
      expect(scopes).toHaveLength(1);
      note.focus();
      expect(scopes).toEqual([]);
    });

    it("stay off the keymap while focus is in a text field of it", async () => {
      const { hold, scopes } = await setup(kind);
      const { el } = await hold();
      const field = el.createEl("input", { type: "text" });

      field.focus();
      expect(scopes).toEqual([]);
    });

    it("leave the keymap when it unloads with focus in it", async () => {
      const { hold, scopes } = await setup(kind);
      const { el, unload } = await hold();

      control(el).focus();
      await act(unload);
      expect(scopes).toEqual([]);
    });

    it("let the palette step the view focus was last in, through a modal over it", async () => {
      const { hold, cardFocus } = await setup(kind);
      const note = document.body.createDiv();
      const { el, view } = await hold();
      note.append(el);
      const palette = document.body
        .createDiv({ cls: "modal-container" })
        .createEl("input");

      expect(cardFocus.surfaceIn(note)).toBeNull();
      control(el).focus();
      palette.focus();
      expect(cardFocus.surfaceIn(note)).toBe(view);

      control(el).focus();
      note.createEl("textarea").focus();
      expect(cardFocus.surfaceIn(note)).toBeNull();
    });
  });
});

describe("a Query Block that leaves the page", () => {
  const PATH = "notes/Lab.md";
  const SOURCE = `${FILE}    limit: 100`;
  const BLOCK_NOTE = `${NOTE("RUGIER24")}\n\`\`\`zotquery\n${SOURCE}\n\`\`\`\n\nAfter the block.\n`;
  const LINE_START = 5;

  async function leaving({ replaceCode }: { replaceCode?: () => void }) {
    const { block, host } = await setup("block");
    host.vault.modifyFile(PATH, BLOCK_NOTE);
    let onPage = true;
    const ctx: Omit<MarkdownPostProcessorContext, "addChild"> = {
      docId: "doc",
      sourcePath: PATH,
      frontmatter: {},
      getSectionInfo: () =>
        onPage
          ? { text: BLOCK_NOTE, lineStart: LINE_START, lineEnd: LINE_START + 7 }
          : null,
      ...(replaceCode && { replaceCode }),
    };
    const held = await block(SOURCE, ctx);
    return {
      host,
      held,
      leave: async () => {
        onPage = false;
        await act(async () => {
          held.unload();
          await delay(0);
        });
      },
    };
  }

  it("in Reading view, saves a limit typed just before it left", async () => {
    const { host, held, leave } = await leaving({});
    await act(() => held.view.document.editView({ limit: 3 }, { typed: true }));
    await leave();
    expect(host.text(PATH)).toBe(BLOCK_NOTE.replace("limit: 100", "limit: 3"));
  });

  it("in Live Preview, saves a limit typed just before it left into its note, not into the editor it left", async () => {
    const replaceCode = vi.fn();
    const { host, held, leave } = await leaving({ replaceCode });
    await act(() => held.view.document.editView({ limit: 3 }, { typed: true }));
    await leave();
    expect(replaceCode).not.toHaveBeenCalled();
    expect(host.text(PATH)).toBe(BLOCK_NOTE.replace("limit: 100", "limit: 3"));
  });

  it("saves nothing where the note's text at its line changed meanwhile", async () => {
    const { host, held, leave } = await leaving({});
    await act(() => held.view.document.editView({ limit: 3 }, { typed: true }));
    const moved = `Inserted above.\n${BLOCK_NOTE}`;
    host.vault.modifyFile(PATH, moved);
    await leave();
    expect(host.text(PATH)).toBe(moved);
  });
});
