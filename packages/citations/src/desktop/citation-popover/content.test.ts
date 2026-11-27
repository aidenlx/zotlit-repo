// @vitest-environment happy-dom
import type { Inlines } from "#core/pandoc/ast.ts";
import type {
  AmbiguousCitationBlock,
  CitationEntryBlock,
  CitationPopoverBlock,
} from "#obsidian/citation-popover/blocks.ts";
import type { ProfilePresentationFailure } from "#obsidian/pandoc/document-presentation.ts";
import type { HoverParent } from "obsidian";
import { act } from "preact/test-utils";
import { createElement } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFixtureSchema } from "@zotlit/db-testing";
import { createClient } from "@zotlit/db/client/node";
import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { unknownProfileDiagnostic } from "@zotlit/obsidian-kit/profile-stamp.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import {
  inProcessReadsService,
  seedWorksSql,
  sharedClientOpener,
} from "@zotlit/zotero-reads/__fixtures__/in-process.ts";

import type { CitationPopoverActions } from "./actions.ts";
import { CitationPopoverContent } from "./content.tsx";

import { ambiguousCandidates } from "#__fixtures__/citation-index/ambiguous-candidates.ts";
import { citationPopoverFixture } from "#__fixtures__/citation-popover.ts";
import { profileReader } from "#__fixtures__/profiles.ts";

vi.mock(
  "@zotlit/obsidian-kit/components/obsidian/icon-button.tsx",
  async () => {
    const { createElement } = await import("react");
    return {
      IconButton: ({ icon, ...props }: { icon: string }) =>
        createElement("button", { ...props, "data-icon": icon }),
    };
  },
);

const actions: CitationPopoverActions = {
  onOpenNote: vi.fn(),
  onOpenInZotero: vi.fn(),
  onShowInLibrary: vi.fn(),
  onOpenAttachment: vi.fn(),
  onDone: vi.fn(),
  onSwitchProfile: vi.fn(),
};

const entry = (
  citekey: string,
  overrides: Partial<CitationEntryBlock> = {},
): CitationEntryBlock => ({
  kind: "entry",
  citekey,
  marker: undefined,
  serial: undefined,
  content: [{ t: "Str", c: `Entry of ${citekey}` }],
  summary: `Summary of ${citekey}`,
  itemKey: "BOOK0001",
  groupID: null,
  attachments: [],
  ...overrides,
});

const ambiguous = (citekey: string): AmbiguousCitationBlock => ({
  kind: "ambiguous",
  citekey,
  candidates: ambiguousCandidates,
});

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function render(
  blocks: readonly CitationPopoverBlock[],
  note?: Inlines,
  {
    profileFailure,
    pending,
  }: {
    profileFailure?: ProfilePresentationFailure;
    pending?: boolean;
  } = {},
): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => {
    root!.render(
      createElement(CitationPopoverContent, {
        blocks,
        note,
        profileFailure,
        actions,
        pending,
      }),
    );
  });
  return container;
}

const blocksOf = (container: HTMLElement): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>("[data-citation-popover-block]"),
];

const iconsOf = (block: HTMLElement): (string | null)[] =>
  [...block.querySelectorAll("button")].map((button) =>
    button.getAttribute("data-icon"),
  );

describe("CitationPopoverContent", () => {
  it("shows an unavailable Imported Note Profile and its recovery", async () => {
    const container = await render([entry("doe2024")], undefined, {
      profileFailure: {
        kind: "unusable",
        property: "profile",
        diagnostic: unknownProfileDiagnostic("Reading notes (Bk3Qn7XvT2Lp)"),
        target: "Imported/Research.md",
      },
    });

    const diagnostic = container.querySelector(
      "[data-citation-popover-profile-error]",
    );
    expect(diagnostic?.textContent).toContain("Reading notes (Bk3Qn7XvT2Lp)");
    const recovery = diagnostic?.querySelector("button");
    expect(recovery).not.toBeNull();
    expect(recovery?.textContent).toBe(m.profile_switch_recovery());
    recovery?.click();
    expect(actions.onSwitchProfile).toHaveBeenCalledWith(
      "Imported/Research.md",
    );
    expect(actions.onDone).toHaveBeenCalled();
  });

  it("stacks one block per work, in the order the citation names them", async () => {
    const container = await render([entry("smith2025"), entry("doe2024")]);

    const stacked = blocksOf(container);
    expect(
      stacked.map((block) => block.getAttribute("data-citation-popover-block")),
    ).toEqual(["smith2025", "doe2024"]);
    expect(stacked[0]!.textContent).toContain("Entry of smith2025");
  });

  it("puts each entry's action row after its own entry, for the placement to flip", async () => {
    const container = await render([entry("doe2024")]);

    const [block] = blocksOf(container);
    const row = block!.querySelector("[data-citation-popover-actions]");
    expect(block!.lastElementChild).toBe(row);
    expect(block!.firstElementChild?.textContent).toContain("Entry of doe2024");
  });

  it("shows the Entry Marker in the gutter, and the Entry Serial in its place", async () => {
    const marked = await render([
      entry("doe2024", { marker: [{ t: "Str", c: "[1]" }], serial: 4 }),
    ]);
    expect(blocksOf(marked)[0]!.textContent).toContain("[1]");

    await act(() => root?.unmount());
    const serialled = await render([entry("doe2024", { serial: 4 })]);
    expect(blocksOf(serialled)[0]!.textContent).toContain("4");
  });

  it("shows the work's summary where no bibliography formatted it", async () => {
    const container = await render([
      entry("doe2024", { content: null, summary: "Doe (2024): Book" }),
    ]);

    expect(blocksOf(container)[0]!.textContent).toContain("Doe (2024): Book");
  });

  it("offers the note, Zotero and Library actions on every resolved work", async () => {
    const container = await render([entry("doe2024")]);

    expect(iconsOf(blocksOf(container)[0]!)).toEqual([
      "file-text",
      "external-link",
      "library",
    ]);
  });

  it("offers the Attachment control for an Item with an Attachment", async () => {
    const container = await render([
      entry("doe2024", {
        attachments: [{ key: "ATT1", groupID: null, label: "paper.pdf" }],
      }),
    ]);

    expect(iconsOf(blocksOf(container)[0]!)).toContain("paperclip");
  });

  it("offers the Attachment control when an Item's Attachments are unreadable", async () => {
    const container = await render([
      entry("doe2024", { attachments: "unreadable" }),
    ]);

    expect(
      container.querySelector(
        `button[aria-label="${m.references_open_attachment()}"]`,
      ),
    ).not.toBeNull();
  });

  it.each([
    {
      name: "removes the Attachment control when the fresh read finds none",
      mutation:
        "delete from itemAttachments where itemID = 2; delete from items where itemID = 2;",
      unreadable: false,
    },
    {
      name: "keeps the Attachment control and shows a notice when the fresh read fails",
      mutation: "drop table itemAttachments;",
      unreadable: true,
    },
  ])(
    "$name while keeping the popover open",
    async ({ mutation, unreadable }) => {
      using cleanup = new DisposableStack();
      const client = createClient(":memory:");
      cleanup.defer(() => client.$client.close());
      createFixtureSchema(client.$client);
      client.$client.exec(
        seedWorksSql(
          [{ itemID: 1, key: "ABCD2345", title: "Alpha kernels" }],
          [
            {
              itemID: 2,
              key: "ATTACH23",
              parentItemID: 1,
              linkMode: 0,
              path: "storage:paper.pdf",
            },
          ],
        ),
      );
      await using reads = inProcessReadsService(sharedClientOpener(client));
      const notifier = testNotifier();
      await using popover = citationPopoverFixture(
        {
          host: {},
          db: reads,
          libraryScope: { current: [] },
          profile: profileReader(),
        },
        {
          notifier: notifier.layer,
        },
      );
      const hoverParent: HoverParent = { hoverPopover: null };
      const targetEl = document.body.createSpan();
      await popover.runtime.runPromise(
        popover.service.showWork({
          event: new MouseEvent("mouseover"),
          hoverParent,
          targetEl,
          work: { kind: "item", indexedKey: "ABCD2345" },
          open: vi.fn(),
        }),
      );
      const attachment = () =>
        document.querySelector<HTMLButtonElement>(
          `button[aria-label="${m.references_open_attachment()}"]`,
        );
      await vi.waitFor(() => expect(attachment()).not.toBeNull());
      const shown = hoverParent.hoverPopover;
      client.$client.exec(mutation);

      await act(() => attachment()!.click());

      const messages = unreadable ? [[m.notice_attachment_read_failed()]] : [];
      await vi.waitFor(() => {
        expect(notifier.notices.map((notice) => notice.messages)).toEqual(
          messages,
        );
        expect(attachment() !== null).toBe(unreadable);
        expect(hoverParent.hoverPopover).toBe(shown);
        expect(document.body.textContent).toContain("Alpha kernels");
      });
    },
  );

  it("names its actions with the labels the References Sidebar uses", async () => {
    const container = await render([
      entry("doe2024", {
        attachments: [{ key: "ATT1", groupID: null, label: "paper.pdf" }],
      }),
    ]);

    expect(
      [...blocksOf(container)[0]!.querySelectorAll("button")].map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual([
      m.references_open_note(),
      m.references_open_in_zotero(),
      m.library_view_show_in_library(),
      m.references_open_attachment(),
    ]);
  });

  it("runs each action and closes the popover behind it", async () => {
    const block = entry("doe2024", {
      attachments: [{ key: "ATT1", groupID: null, label: "paper.pdf" }],
    });
    const container = await render([block]);
    const buttons = [...blocksOf(container)[0]!.querySelectorAll("button")];

    for (const button of buttons) {
      await act(() => {
        button.click();
      });
    }

    expect(actions.onOpenNote).toHaveBeenCalledOnce();
    expect(actions.onOpenNote).toHaveBeenCalledWith(
      block,
      expect.objectContaining({ type: "click" }),
    );
    expect(actions.onOpenInZotero).toHaveBeenCalledExactlyOnceWith(block);
    expect(actions.onShowInLibrary).toHaveBeenCalledExactlyOnceWith(block);
    expect(actions.onOpenAttachment).toHaveBeenCalledOnce();
    expect(actions.onDone).toHaveBeenCalledTimes(4);
  });

  it("explains an unresolved citekey and offers nothing on it", async () => {
    const container = await render([
      { kind: "unresolved", citekey: "typo2024" },
      entry("doe2024"),
    ]);

    const [unresolved] = blocksOf(container);
    expect(unresolved!.textContent).toBe(
      m.references_citekey_unresolved({ citekey: "typo2024" }),
    );
    expect(iconsOf(unresolved!)).toEqual([]);
  });

  it("reads an unresolved citekey as a lookup in progress while resolution is pending", async () => {
    const container = await render(
      [{ kind: "unresolved", citekey: "doe2024" }],
      undefined,
      { pending: true },
    );

    const [block] = blocksOf(container);
    expect(block!.textContent).toBe(
      m.references_citekey_pending({ citekey: "doe2024" }),
    );
    expect(iconsOf(block!)).toEqual([]);
  });

  it("explains an ambiguous citekey by the candidates it names", async () => {
    const container = await render([ambiguous("doe2024")]);

    const [block] = blocksOf(container);
    expect(block!.textContent).toContain(
      m.references_citekey_ambiguous({ citekey: "doe2024" }),
    );
    expect(block!.textContent).toContain("Doe (2024): A study of citations");
    expect(block!.textContent).toContain("DOE2024A");
    expect(block!.textContent).toContain("Shared group");
    expect(block!.textContent).toContain("DOE2024B");
    expect(iconsOf(block!)).toEqual([]);
  });

  it("opens for a citation none of whose keys reaches an Item", async () => {
    const container = await render([
      { kind: "unresolved", citekey: "typo2024" },
      { kind: "unresolved", citekey: "gone2020" },
    ]);

    expect(blocksOf(container)).toHaveLength(2);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("CitationPopoverContent under a note-class style", () => {
  const note: Inlines = [
    { t: "Str", c: "Ann" },
    { t: "Space" },
    { t: "Str", c: "Zeta," },
    { t: "Space" },
    { t: "Emph", c: [{ t: "Str", c: "A study" }] },
    { t: "Str", c: ", 12." },
  ];

  const noteBlockOf = (container: HTMLElement): HTMLElement =>
    container.querySelector<HTMLElement>("[data-citation-popover-note]")!;

  const serialsOf = (container: HTMLElement): (string | null)[] =>
    blocksOf(container).map(
      (block) => block.querySelector(".zt-entry-serial")!.textContent,
    );

  it("shows the note text the style wrote for the hovered citation", async () => {
    const container = await render([entry("doe2024", { serial: 1 })], note);

    expect(noteBlockOf(container).textContent).toContain(
      "Ann Zeta, A study, 12.",
    );
    expect(container.querySelector("em")!.textContent).toBe("A study");
  });

  it("leaves the works' entries out from under the note text", async () => {
    const container = await render(
      [entry("doe2024", { serial: 1 }), entry("smith2025", { serial: 2 })],
      note,
    );

    expect(container.textContent).not.toContain("Entry of doe2024");
    expect(container.textContent).not.toContain("Entry of smith2025");
  });

  it("rows one work per action row, in the order the citation names them", async () => {
    const container = await render(
      [entry("smith2025", { serial: 2 }), entry("doe2024", { serial: 1 })],
      note,
    );

    const rows = blocksOf(container);
    expect(
      rows.map((row) => row.getAttribute("data-citation-popover-block")),
    ).toEqual(["smith2025", "doe2024"]);
    expect(rows.map(iconsOf)).toEqual([
      ["file-text", "external-link", "library"],
      ["file-text", "external-link", "library"],
    ]);
  });

  it("labels each row with the Entry Serial its inline run showed", async () => {
    const container = await render(
      [entry("smith2025", { serial: 2 }), entry("doe2024", { serial: 1 })],
      note,
    );

    expect(serialsOf(container)).toEqual(["2", "1"]);
  });

  it("marks the row of a work the bibliography rendered no entry for", async () => {
    const container = await render(
      [entry("doe2024", { serial: undefined })],
      note,
    );

    expect(serialsOf(container)).toEqual(["⚠"]);
  });

  it("explains an unresolved key and keeps its resolved siblings' rows", async () => {
    const container = await render(
      [
        entry("doe2024", { serial: 1 }),
        { kind: "unresolved", citekey: "typo2024" },
      ],
      note,
    );

    const [resolved, unresolved] = blocksOf(container);
    expect(iconsOf(resolved!)).toEqual([
      "file-text",
      "external-link",
      "library",
    ]);
    expect(unresolved!.textContent).toContain(
      m.references_citekey_unresolved({ citekey: "typo2024" }),
    );
    expect(iconsOf(unresolved!)).toEqual([]);
    expect(serialsOf(container)).toEqual(["1", "⚠"]);
  });

  it("marks every serial label with the zt-entry-serial theme hook", async () => {
    const container = await render(
      [entry("doe2024", { serial: 1 }), entry("smith2025", { serial: 2 })],
      note,
    );

    expect(
      [...container.querySelectorAll(".zt-entry-serial")].map(
        (label) => label.textContent,
      ),
    ).toEqual(["1", "2"]);
  });

  it("puts the rows after the note text, for the placement to flip", async () => {
    const container = await render([entry("doe2024", { serial: 1 })], note);

    const block = noteBlockOf(container);
    expect(block.firstElementChild!.textContent).toContain("Ann Zeta");
    expect(block.lastElementChild!.contains(blocksOf(container)[0]!)).toBe(
      true,
    );
  });
});
