// @vitest-environment happy-dom
import type { CitationEntryBlock } from "#obsidian/citation-popover/blocks.ts";
import { Effect } from "effect";
import { Keymap, Menu } from "obsidian";
import type { Workspace } from "obsidian";
import type { MouseEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { createCitationPopoverActions } from "./actions.ts";
import type { CitationPopoverActionDeps } from "./actions.ts";

const menuMock = Menu as typeof Menu & {
  instances: {
    items: { title: string; click: () => void }[];
    position: { x: number; y: number } | null;
  }[];
};

const block = (
  overrides: Partial<CitationEntryBlock> = {},
): CitationEntryBlock => ({
  kind: "entry",
  citekey: "doe2024",
  marker: undefined,
  serial: undefined,
  content: [{ t: "Str", c: "Doe (2024)" }],
  summary: "Doe (2024): Book",
  itemKey: "BOOK0001",
  groupID: null,
  attachments: [],
  ...overrides,
});

function click({
  button = 0,
  detail = 1,
}: { button?: number; detail?: number } = {}): MouseEvent {
  const target = document.createElement("div");
  const native = new globalThis.MouseEvent("click", { button, detail });
  return {
    button,
    detail,
    currentTarget: target,
    nativeEvent: native,
  } as unknown as MouseEvent;
}

function actions(prepare?: CitationPopoverActionDeps["prepare"]) {
  const opened: [citekey: string, pane: unknown][] = [];
  const hide = vi.fn();
  const showInLibrary = vi.fn();
  const notifier = testNotifier();
  return {
    opened,
    hide,
    showInLibrary,
    notices: notifier.notices,
    ...createCitationPopoverActions({
      host: {
        workspace: stubService<Workspace>("Workspace", { trigger: vi.fn() }),
      },
      open: (entry, pane) => opened.push([entry.citekey!, pane]),
      hide,
      showInLibrary,
      switchProfile: vi.fn(),
      prepare,
      showNotice: (message: string) => {
        Effect.runSync(notifier.service.show(message));
      },
      log: vi.fn(),
    }),
  };
}

beforeEach(() => {
  menuMock.instances = [];
});

describe("createCitationPopoverActions", () => {
  it("opens the work's note in the pane the click asks for", () => {
    const { onOpenNote, opened } = actions();

    onOpenNote(block(), click());
    vi.spyOn(Keymap, "isModEvent").mockReturnValue("tab");
    onOpenNote(block({ citekey: "smith2025" }), click());
    onOpenNote(block({ citekey: "gray2019" }), click({ button: 1 }));

    expect(opened).toEqual([
      ["doe2024", false],
      ["smith2025", "tab"],
      ["gray2019", "tab"],
    ]);
  });

  it("selects the Item in Zotero without guarding its reachability", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { onOpenInZotero } = actions();

    onOpenInZotero(block({ itemKey: "ITEM0009", groupID: 7 }));

    expect(open).toHaveBeenCalledExactlyOnceWith(
      "zotero://select/groups/7/items/ITEM0009",
    );
  });

  it("shows the Item in the Library View by its Indexed Key", () => {
    const { onShowInLibrary, showInLibrary } = actions();

    onShowInLibrary(block({ itemKey: "ITEM0009", groupID: 7 }));
    onShowInLibrary(block({ itemKey: "BOOK0001", groupID: null }));

    expect(showInLibrary.mock.calls).toEqual([["ITEM0009g7"], ["BOOK0001"]]);
  });

  it("opens a single Attachment straight away", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { onOpenAttachment } = actions();

    onOpenAttachment(
      block({
        attachments: [{ key: "ATT1", groupID: null, label: "paper.pdf" }],
      }),
      click(),
    );

    expect(open).toHaveBeenCalledExactlyOnceWith(
      "zotero://open/library/items/ATT1",
    );
    expect(menuMock.instances).toEqual([]);
  });

  it("keeps the popover open when the last Attachment disappears before opening", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { onOpenAttachment, onDone, hide } = actions(async (current) => ({
      ...current,
      attachments: [],
    }));

    onOpenAttachment(
      block({
        attachments: [{ key: "ATT1", groupID: null, label: "paper.pdf" }],
      }),
      click(),
    );
    onDone();
    await Promise.resolve();
    await Promise.resolve();

    expect(menuMock.instances).toEqual([]);
    expect(open).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
  });

  it.each(["fresh", "displayed"])(
    "keeps the popover open and shows a notice when the %s Attachments are unreadable",
    async (read) => {
      const open = vi.spyOn(window, "open").mockReturnValue(null);
      const fresh = read === "fresh";
      const attachment = { key: "ATT1", groupID: null, label: "paper.pdf" };
      const { onOpenAttachment, onDone, hide, notices } = actions(
        fresh
          ? async (current) => ({ ...current, attachments: "unreadable" })
          : undefined,
      );

      onOpenAttachment(
        block({ attachments: fresh ? [attachment] : "unreadable" }),
        click(),
      );
      onDone();
      await Promise.resolve();
      await Promise.resolve();

      expect(hide).not.toHaveBeenCalled();
      expect(menuMock.instances).toEqual([]);
      expect(open).not.toHaveBeenCalled();
      expect(notices).toHaveLength(1);
      expect(notices[0]?.messages).toEqual([m.notice_attachment_read_failed()]);
    },
  );

  it("offers a menu when the Item carries several Attachments", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { onOpenAttachment } = actions();

    onOpenAttachment(
      block({
        attachments: [
          { key: "ATT1", groupID: null, label: "paper.pdf" },
          { key: "ATT2", groupID: null, label: "notes.pdf" },
        ],
      }),
      click(),
    );

    const menu = menuMock.instances[0];
    expect(menu?.items.map((item) => item.title)).toEqual([
      "paper.pdf",
      "notes.pdf",
    ]);
    expect(open).not.toHaveBeenCalled();
    menu?.items[1]?.click();
    expect(open).toHaveBeenCalledExactlyOnceWith(
      "zotero://open/library/items/ATT2",
    );
  });

  it("puts the menu at the button a keyboard activation came from", () => {
    const { onOpenAttachment } = actions();

    onOpenAttachment(
      block({
        attachments: [
          { key: "ATT1", groupID: null, label: "paper.pdf" },
          { key: "ATT2", groupID: null, label: "notes.pdf" },
        ],
      }),
      click({ detail: 0 }),
    );

    expect(menuMock.instances[0]?.position).toEqual({
      x: 0,
      y: 0,
      width: 0,
      overlap: true,
      left: false,
    });
  });

  it("hides the popover once an action has run", () => {
    const { onDone, hide } = actions();

    onDone();

    expect(hide).toHaveBeenCalledOnce();
  });
});
