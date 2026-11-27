import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BaseNotice,
  loadingNotice,
  noticeList,
  noticeSteps,
  noticeText,
} from "./notice.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

type Recorded = BaseNotice & {
  readonly buttons: { text: string; callback: (evt: MouseEvent) => void }[];
  readonly message: string;
};

describe("BaseNotice", () => {
  it("shows the title and lines as text and adds each action as a button", () => {
    const run = vi.fn();
    const notice = new BaseNotice({
      title: "Export failed",
      lines: ["Zotero is closed."],
      actions: [
        { label: "Retry", run },
        { label: "Open settings", run: () => {} },
      ],
    }) as Recorded;

    expect(notice.message).toBe("Export failed\nZotero is closed.");
    expect(notice.buttons.map((button) => button.text)).toEqual([
      "Retry",
      "Open settings",
    ]);
    notice.buttons[0]!.callback({} as MouseEvent);
    expect(run).toHaveBeenCalledOnce();
  });

  it("replaces the buttons and the loading bar when the message changes", () => {
    const notice = new BaseNotice(loadingNotice("Exporting"), 0) as Recorded;
    const toggle = vi.spyOn(notice.containerEl, "toggleClass");

    notice.setMessage({
      title: "Export failed",
      actions: [{ label: "Retry", run: () => {} }],
    });
    notice.setMessage({
      title: "Export failed again",
      actions: [{ label: "Report", run: () => {} }],
    });

    expect(toggle).toHaveBeenLastCalledWith("is-loading", false);
    expect(notice.buttons.map((button) => button.text)).toEqual(["Report"]);
    notice.setMessage("Done");
    expect(notice.buttons).toEqual([]);
  });

  it("keeps the buttons of a message that keeps the same actions, and runs the newest action", () => {
    const first = vi.fn();
    const second = vi.fn();
    const notice = new BaseNotice(
      {
        title: "Syncing",
        progress: { value: 1, max: 4 },
        actions: [{ label: "Stop", run: first }],
      },
      0,
    ) as Recorded;
    const button = notice.buttons[0];

    notice.setMessage({
      title: "Syncing",
      progress: { value: 2, max: 4 },
      actions: [{ label: "Stop", run: second }],
    });

    expect(notice.buttons).toHaveLength(1);
    expect(notice.buttons[0]).toBe(button);
    notice.buttons[0]!.callback({} as MouseEvent);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("draws a bar for a known amount of work", () => {
    const notice = new BaseNotice("Importing", 0) as Recorded;
    const bar = { max: 0, value: 0 };
    const createEl = vi
      .spyOn(notice.messageEl, "createEl")
      .mockReturnValue(bar as unknown as HTMLProgressElement);

    notice.setMessage({
      title: "Importing (3/8)",
      progress: { value: 3, max: 8 },
    });

    expect(createEl).toHaveBeenCalledWith("progress");
    expect(bar).toEqual({ max: 8, value: 3 });
  });
});

describe("notice text", () => {
  it("numbers steps and bullets list items", () => {
    expect(noticeSteps(["Download", "Run"])).toEqual(["1. Download", "2. Run"]);
    expect(noticeList("Kept backups:", ["a.bak", "b.bak"])).toEqual([
      "Kept backups:",
      "• a.bak",
      "• b.bak",
    ]);
  });

  it("keeps a progress bar the loading message already has", () => {
    expect(loadingNotice("Exporting")).toEqual({
      title: "Exporting",
      progress: "indeterminate",
    });
    expect(
      loadingNotice({ title: "Importing", progress: { value: 1, max: 4 } }),
    ).toEqual({ title: "Importing", progress: { value: 1, max: 4 } });
    expect(noticeText({ title: "A", lines: ["B", "C"] })).toBe("A\nB\nC");
  });
});
