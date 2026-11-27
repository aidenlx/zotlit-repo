import type { ObsidianOpenableAttachment } from "#core/attachment-open/resolve.ts";
import type { LiteratureNoteAttachmentsHandle } from "#obsidian/attachment-open/handle.ts";
import { TFile } from "obsidian";
import type {
  App,
  CachedMetadata,
  Command,
  MetadataCache,
  Workspace,
} from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Notice } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import {
  addAttachmentOpenActions,
  openGesture,
  pdfPickerReader,
} from "./actions.ts";
import type { AttachmentOpenDeps } from "./actions.ts";
import { openAttachments } from "./open-attachments.ts";
import type { TargetOpener } from "./open-target.ts";

import { openOpener } from "#__fixtures__/attachment-open.ts";

vi.mock("./open-attachments.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./open-attachments.ts")>()),
  openAttachments: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(openAttachments).mockReset();
});

const OPENABLE_FIXTURE: ObsidianOpenableAttachment[] = [
  {
    indexedKey: "ATCH2345",
    label: "Doe 2024.pdf",
    openPath: "file:/data/storage/ATCH2345/Doe 2024.pdf",
    absolutePath: "/data/storage/ATCH2345/Doe 2024.pdf",
  },
];

const fixtureAttachments: LiteratureNoteAttachmentsHandle = {
  literatureNoteAttachments: (indexedKey) =>
    Promise.resolve({
      attachments: indexedKey === "ABCD2345" ? OPENABLE_FIXTURE : [],
      filesUnavailable: false,
    }),
};

function appWith(
  active: TFile | null = null,
  cache: CachedMetadata | null = null,
): App {
  return stubService<App>("App", {
    workspace: stubService<Workspace>("Workspace", {
      getActiveFile: () => active,
    }),
    metadataCache: stubService<MetadataCache>("MetadataCache", {
      getFileCache: () => cache,
    }),
  });
}

const unreadAttachments = stubService<LiteratureNoteAttachmentsHandle>(
  "LiteratureNoteAttachments",
  {},
);

const unusedOpener = stubService<Pick<TargetOpener["Service"], "open">>(
  "TargetOpener",
  {},
);

function lookupDeps(
  attachments: LiteratureNoteAttachmentsHandle,
  overrides: Partial<AttachmentOpenDeps> = {},
): AttachmentOpenDeps {
  return {
    app: appWith(),
    attachments,
    bridge: { runAndForget: () => {} },
    opener: unusedOpener,
    ...overrides,
  };
}

describe("open-pdf command", () => {
  function register(deps: AttachmentOpenDeps): Command {
    let command: Command | undefined;
    addAttachmentOpenActions(
      {
        addCommand(value) {
          command = value;
          return value;
        },
      },
      deps,
    );
    if (!command) throw new Error("Command was not registered");
    return command;
  }

  it("is unavailable without an active file", () => {
    const deps = lookupDeps(unreadAttachments);
    expect(register(deps).checkCallback?.(true)).toBe(false);
  });

  it("is unavailable when the active file carries no item key", () => {
    const file = new TFile();
    const deps = lookupDeps(unreadAttachments, {
      app: appWith(file, { frontmatter: {} }),
    });
    expect(register(deps).checkCallback?.(true)).toBe(false);
  });

  it("opens the resolved Attachments through the Suggest modal picker once run", async () => {
    const file = new TFile();

    const app = appWith(file, { frontmatter: { "zotero-key": "ABCD2345" } });
    const deps = lookupDeps(fixtureAttachments, { app });

    const command = register(deps);
    expect(command.checkCallback?.(true)).toBe(true);
    command.checkCallback?.(false);

    await vi.waitFor(() =>
      expect(openAttachments).toHaveBeenCalledExactlyOnceWith(
        OPENABLE_FIXTURE,
        {
          reader: expect.anything(),
          app,
        },
      ),
    );
  });

  it("calls openAttachments with an empty list when nothing resolves, deferring the notice to the reader", async () => {
    const file = new TFile();

    const app = appWith(file, { frontmatter: { "zotero-key": "ZZZZ2345" } });
    const deps = lookupDeps(fixtureAttachments, { app });

    const command = register(deps);
    command.checkCallback?.(false);

    await vi.waitFor(() =>
      expect(openAttachments).toHaveBeenCalledExactlyOnceWith([], {
        reader: expect.anything(),
        app,
      }),
    );
  });
});

describe("pdfPickerReader", () => {
  it.each([
    [false, m.notice_no_pdf_attachment()],
    [true, m.notice_needs_local_zotero()],
  ])(
    "names the cause when no PDF opens (files unavailable: %s)",
    (filesUnavailable, message) => {
      Notice.instances.length = 0;
      pdfPickerReader(
        openGesture(unusedOpener, () => {}),
        {
          filesUnavailable,
        },
      ).onEmpty?.();
      expect(Notice.instances.map((notice) => notice.message)).toEqual([
        message,
      ]);
    },
  );

  it("stays silent when unload ends an open that waits for the index", async () => {
    const { opener, bridge, gate, close, opened, handed, notices } =
      await openOpener({ prime: false });
    const read = gate();

    pdfPickerReader(openGesture(opener, bridge.runAndForget), {
      filesUnavailable: false,
    }).open(OPENABLE_FIXTURE[0]!, false);
    await read.waiting;
    const closing = close();
    read.release();
    await closing;

    expect(opened).toEqual([]);
    expect(handed).toEqual([]);
    expect(notices).toEqual([]);
  });
});
