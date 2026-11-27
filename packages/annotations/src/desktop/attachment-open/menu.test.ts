import type { ObsidianOpenableAttachment } from "#core/attachment-open/resolve.ts";
import type { App, Menu as ObsidianMenu, MenuItem, Workspace } from "obsidian";
import { TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Menu } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import type { MenuItem as MockMenuItem } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { fileMenuHandler as handlerFor } from "@zotlit/plugin-services/__fixtures__/file-menu.ts";

import type { AttachmentOpenDeps } from "./actions.ts";
import { attachmentOpenFileMenu } from "./menu.ts";
import { openAttachments } from "./open-attachments.ts";
import type { TargetOpener } from "./open-target.ts";

vi.mock("./open-attachments.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./open-attachments.ts")>()),
  openAttachments: vi.fn(),
}));

let resolved: ObsidianOpenableAttachment[] = [];

function obsidianMenu(menu: Menu): ObsidianMenu {
  const typed = Object.assign(stubService<ObsidianMenu>("Menu", {}), {
    addItem(callback: (item: MenuItem) => unknown): ObsidianMenu {
      menu.addItem((item) => callback(obsidianMenuItem(item)));
      return typed;
    },
  });
  return typed;
}

function obsidianMenuItem(item: MockMenuItem): MenuItem {
  const typed = Object.assign(stubService<MenuItem>("MenuItem", {}), {
    setSection(section: string): MenuItem {
      item.setSection(section);
      return typed;
    },
    setTitle(title: string): MenuItem {
      item.setTitle(title);
      return typed;
    },
    setIcon(icon: string): MenuItem {
      item.setIcon(icon);
      return typed;
    },
    setDisabled(disabled: boolean): MenuItem {
      item.setDisabled(disabled);
      return typed;
    },
    onClick(
      callback: (event: MouseEvent | KeyboardEvent) => unknown,
    ): MenuItem {
      item.onClick(callback);
      return typed;
    },
  });
  return typed;
}

beforeEach(() => {
  resolved = [];
  vi.mocked(openAttachments).mockReset();
});

function fileMenuHandler(
  deps: Partial<AttachmentOpenDeps> = {},
  frontmatter: Record<string, unknown> = { "zotero-key": "ABCD2345" },
) {
  const app = stubService<App>("App", {
    workspace: stubService<Workspace>("Workspace", {
      trigger: () => {},
    }),
  });
  return handlerFor(
    [
      attachmentOpenFileMenu({
        app,
        attachments: {
          literatureNoteAttachments: (indexedKey) =>
            Promise.resolve({
              attachments: indexedKey === "ABCD2345" ? resolved : [],
              filesUnavailable: false,
            }),
        },
        opener: stubService<Pick<TargetOpener["Service"], "open">>(
          "TargetOpener",
          {},
        ),
        bridge: { runAndForget: () => {} },
        ...deps,
      }),
    ],
    frontmatter,
  );
}

function markdownFile(): TFile {
  const file = new TFile();
  file.extension = "md";
  return file;
}

function anchorRect(): DOMRect {
  return {
    x: 10,
    y: 0,
    left: 10,
    width: 100,
    height: 20,
    bottom: 20,
  } as DOMRect;
}

describe("Literature Note attachment-open file menu", () => {
  it("adds the Open PDF entry to the open section", () => {
    const menu = new Menu();
    fileMenuHandler()(obsidianMenu(menu), markdownFile(), "more-options");

    expect(menu.items).toHaveLength(1);
    expect(menu.items[0]!.title).toBe("Open PDF");
    expect(menu.items[0]!.section).toBe("open");
  });

  it("opens the resolved Attachments on click", async () => {
    const openable: ObsidianOpenableAttachment[] = [
      {
        indexedKey: "ATCH1",
        label: "Alpha.pdf",
        openPath: "Alpha.pdf",
        absolutePath: "/vault/Alpha.pdf",
      },
    ];
    resolved = openable;

    const menu = new Menu();
    fileMenuHandler()(obsidianMenu(menu), markdownFile(), "more-options");
    menu.items[0]!.click();

    await vi.waitFor(() =>
      expect(openAttachments).toHaveBeenCalledExactlyOnceWith(openable, {
        reader: expect.anything(),
        host: expect.anything(),
        event: expect.anything(),
        anchor: undefined,
      }),
    );
  });

  it("stays off a note that carries no item key", () => {
    const menu = new Menu();
    fileMenuHandler({}, {})(obsidianMenu(menu), markdownFile(), "more-options");

    expect(menu.items).toHaveLength(0);
  });

  it("calls openAttachments with an empty list when the note has no PDF Attachment", async () => {
    resolved = [];

    const menu = new Menu();
    fileMenuHandler()(obsidianMenu(menu), markdownFile(), "more-options");
    menu.items[0]!.click();

    await vi.waitFor(() =>
      expect(openAttachments).toHaveBeenCalledExactlyOnceWith([], {
        reader: expect.anything(),
        host: expect.anything(),
        event: expect.anything(),
        anchor: undefined,
      }),
    );
  });

  it("shows the picker at the button's own box for a keyboard click, after the async Attachment lookup", async () => {
    const actual = await vi.importActual<
      typeof import("./open-attachments.ts")
    >("./open-attachments.ts");
    vi.mocked(openAttachments).mockImplementation(actual.openAttachments);
    resolved = [
      {
        indexedKey: "ATCH1",
        label: "Alpha.pdf",
        openPath: "Alpha.pdf",
        absolutePath: "/vault/Alpha.pdf",
      },
      {
        indexedKey: "ATCH2",
        label: "Beta.pdf",
        openPath: "Beta.pdf",
        absolutePath: "/vault/Beta.pdf",
      },
    ];

    Menu.instances.length = 0;
    const menu = new Menu();
    fileMenuHandler()(obsidianMenu(menu), markdownFile(), "more-options");

    const rect = anchorRect();
    const evt = {
      detail: 0,
      currentTarget: { getBoundingClientRect: () => rect },
    } as unknown as MouseEvent;
    expect(() => menu.items[0]!.click(evt)).not.toThrow();
    (evt as unknown as { currentTarget: unknown }).currentTarget = null;

    await vi.waitFor(() => expect(Menu.instances).toHaveLength(2));
    expect(Menu.instances[1]!.position).toStrictEqual({
      x: rect.x,
      y: rect.bottom,
      width: rect.width,
      overlap: true,
      left: false,
    });
  });
});
