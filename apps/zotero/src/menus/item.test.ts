import { afterEach, beforeEach, describe, expect, it } from "vitest";

(globalThis as { Localization?: unknown }).Localization = class {
  formatValue(): Promise<null> {
    return Promise.resolve(null);
  }
};

const { registerItemMenu } = await import("./item.ts");

type LibraryMenuContext = _ZoteroTypes.MenuManager.LibraryMenuContext;
type MenuData = _ZoteroTypes.MenuManager.MenuData<LibraryMenuContext>;
type MenuOptions = _ZoteroTypes.MenuManager.MenuOptions<"main/library/item">;

const PLUGIN_ID = "zotlit@aidenlx.site";
const SUBMENU_ID = "zotlit-menu-submenu";

interface ItemShape {
  kind: "attachment" | "childNote" | "note" | "regular";
  notes?: number;
}

function item({ kind, notes = 0 }: ItemShape): Zotero.Item {
  return {
    isRegularItem: () => kind === "regular",
    isNote: () => kind === "note" || kind === "childNote",
    isTopLevelItem: () => kind !== "childNote",
    isAttachment: () => kind === "attachment",
    isPDFAttachment: () => kind === "attachment",
    getNotes: () => Array.from({ length: notes }, (_, index) => index),
    getAttachments: () => [],
  } as unknown as Zotero.Item;
}

interface ShownState {
  visible?: boolean;
  enabled?: boolean;
}

function show(entry: MenuData, items: Zotero.Item[]): ShownState {
  const state: ShownState = {};
  const context = {
    items,
    setVisible: (visible: boolean) => {
      state.visible = visible;
    },
    setEnabled: (enabled: boolean) => {
      state.enabled = enabled;
    },
    setL10nArgs: () => undefined,
  } as unknown as LibraryMenuContext;
  entry.onShowing?.(new Event("popupshowing"), context);
  return state;
}

let registered: MenuOptions;

beforeEach(() => {
  (globalThis as { Zotero?: unknown }).Zotero = {
    MenuManager: {
      registerMenu: (options: MenuOptions) => {
        registered = options;
        return "menu-id";
      },
      unregisterMenu: () => undefined,
    },
    Items: { get: () => [] },
  };
  registerItemMenu(PLUGIN_ID)[Symbol.dispose]();
});

afterEach(() => {
  delete (globalThis as { Zotero?: unknown }).Zotero;
});

function showSubmenu(items: Zotero.Item[]): {
  submenu: ShownState;
  entries: ShownState[];
} {
  const submenu = (registered.menus as MenuData[]).find(
    (entry) => entry.l10nID === SUBMENU_ID,
  );
  if (!submenu) throw new Error(`${SUBMENU_ID} is not registered`);
  return {
    submenu: show(submenu, items),
    entries: (submenu.menus ?? []).map((entry) => show(entry, items)),
  };
}

describe("the ZotLit item submenu", () => {
  it("goes disabled on a PDF attachment, whose entries all stay hidden", () => {
    const { submenu, entries } = showSubmenu([item({ kind: "attachment" })]);

    expect(entries.map((entry) => entry.visible)).toEqual(
      entries.map(() => false),
    );
    expect(submenu).toEqual({ visible: true, enabled: false });
  });

  it.each([
    ["one regular item", [item({ kind: "regular" })]],
    [
      "one regular item with a child note",
      [item({ kind: "regular", notes: 1 })],
    ],
    ["one standalone note", [item({ kind: "note" })]],
    ["one child note", [item({ kind: "childNote" })]],
    [
      "an attachment beside a regular item",
      [item({ kind: "attachment" }), item({ kind: "regular" })],
    ],
  ])("is enabled for %s exactly when an entry shows", (_selection, items) => {
    const { submenu, entries } = showSubmenu(items);

    expect(submenu.enabled).toBe(entries.some((entry) => entry.visible));
  });

  it("hides on an empty selection", () => {
    expect(showSubmenu([]).submenu.visible).toBe(false);
  });
});
