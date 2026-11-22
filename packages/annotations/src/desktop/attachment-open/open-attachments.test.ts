import type { ObsidianOpenableAttachment } from "#core/attachment-open/resolve.ts";
import type { App, Workspace } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Keymap, Menu } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

import { openAttachments } from "./open-attachments.ts";
import type {
  AttachmentOpenClickEvent,
  AttachmentReader,
} from "./open-attachments.ts";

type Row = ObsidianOpenableAttachment;

function row(label: string): Row {
  return {
    indexedKey: "ATCH2345",
    label,
    openPath: `papers/${label}`,
    absolutePath: `/vault/papers/${label}`,
  };
}

const trigger = vi.fn();
const APP = stubService<App>("App", {
  workspace: stubService<Workspace>("Workspace", { trigger }),
});

function fakeReactMouseEvent(
  overrides: Partial<{
    detail: number;
    nativeEvent: MouseEvent;
    currentTarget: {
      getBoundingClientRect: () => DOMRect;
      hasClass: () => boolean;
    };
  }> = {},
) {
  return {
    detail: 1,
    nativeEvent: {} as MouseEvent,
    currentTarget: {
      getBoundingClientRect: () => ({ left: 0, bottom: 0 }) as DOMRect,
      hasClass: () => false,
    },
    ...overrides,
  } as unknown as AttachmentOpenClickEvent;
}

function fakeReader(): AttachmentReader<Row> & {
  calls: [Row, unknown][];
  emptyCalls: number;
} {
  const calls: [Row, unknown][] = [];
  let emptyCalls = 0;
  return {
    icon: "paperclip",
    calls,
    get emptyCalls() {
      return emptyCalls;
    },
    onEmpty: () => {
      emptyCalls++;
    },
    open: (attachment, pane) => {
      calls.push([attachment, pane]);
    },
  };
}

describe("openAttachments", () => {
  beforeEach(() => {
    Menu.instances.length = 0;
  });

  it("defers to the reader's onEmpty when there are no Attachments", () => {
    const reader = fakeReader();
    openAttachments([], { reader, host: APP, event: fakeReactMouseEvent() });
    expect(reader.calls).toStrictEqual([]);
    expect(reader.emptyCalls).toBe(1);
  });

  it("opens a single Attachment straight away, without a picker", () => {
    const reader = fakeReader();
    const attachment = row("Doe 2024.pdf");
    openAttachments([attachment], {
      reader,
      host: APP,
      event: fakeReactMouseEvent(),
    });
    expect(reader.calls).toStrictEqual([[attachment, false]]);
    expect(Menu.instances).toHaveLength(0);
  });

  it("forwards a Mod-click's new-pane request for a single Attachment", () => {
    using _isModEvent = vi.spyOn(Keymap, "isModEvent").mockReturnValue(true);
    const reader = fakeReader();
    const attachment = row("Doe 2024.pdf");
    openAttachments([attachment], {
      reader,
      host: APP,
      event: fakeReactMouseEvent(),
    });
    expect(reader.calls).toStrictEqual([[attachment, true]]);
  });

  it("opens a single Attachment with no event and no modifier, for an event-less invocation", () => {
    const reader = fakeReader();
    const attachment = row("Doe 2024.pdf");
    openAttachments([attachment], {
      reader,
      app: stubService<App>("App", {}),
    });
    expect(reader.calls).toStrictEqual([[attachment, false]]);
  });

  it("shows a Menu for several Attachments when a pointer event is given", () => {
    const reader = fakeReader();
    const a = row("Alpha.pdf");
    const b = row("Beta.pdf");
    openAttachments([a, b], {
      reader,
      host: APP,
      event: fakeReactMouseEvent(),
    });

    expect(Menu.instances).toHaveLength(1);
    const menu = Menu.instances[0]!;
    expect(menu.items.map((item) => item.title)).toStrictEqual([
      "Alpha.pdf",
      "Beta.pdf",
    ]);

    menu.items[1]!.click();
    expect(reader.calls).toStrictEqual([[b, false]]);
  });

  it("raises the picker for listeners, sectioned, before it shows", () => {
    trigger.mockClear();
    const a = row("Alpha.pdf");
    const b = row("Beta.pdf");
    openAttachments([a, b], {
      reader: fakeReader(),
      host: APP,
      event: fakeReactMouseEvent(),
    });

    const menu = Menu.instances[0]!;
    expect(menu.sections).toStrictEqual(["open", ""]);
    expect(menu.items.map((item) => item.section)).toStrictEqual([
      "open",
      "open",
    ]);
    expect(trigger).toHaveBeenCalledExactlyOnceWith(
      "zotlit:attachments-menu",
      menu,
      { attachments: [a, b] },
    );
  });
});
