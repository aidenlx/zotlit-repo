import type { ViewState } from "obsidian";
import { describe, expect, it } from "vitest";

import type { AttachmentResolution } from "@zotlit/plugin-services/obsidian/attachment-resolver/service.ts";

import type { ViewerRouting } from "./viewer.ts";
import { registerViewerRouting, routedViewState, viewerOf } from "./viewer.ts";

const READER = "zotlit-pdf";
const ZOTERO_PDF = "attachments/rougier-2014.pdf";
const OTHER_PDF = "pdf-reader-theme.pdf";

const resolved = (openable: boolean): AttachmentResolution => ({
  kind: "resolved",
  attachmentKey: "RGRPDF24",
  serverID: null,
  itemKey: "RUGIER24",
  openable,
});
const UNRESOLVED: AttachmentResolution = { kind: "unresolved" };

const routing = (
  attachmentOf: ViewerRouting["attachmentOf"] = (path) =>
    path === ZOTERO_PDF ? resolved(true) : UNRESOLVED,
): ViewerRouting => ({ viewType: READER, attachmentOf });

const pdfOf = (file: string): ViewState => ({ type: "pdf", state: { file } });

describe("viewerOf", () => {
  it.each([
    ["ZotLit's own open of an Attachment", { kind: "attachment" }, "reader"],
    [
      "an anchored link to any PDF",
      { kind: "file", anchored: true, attachment: UNRESOLVED },
      "reader",
    ],
    [
      "an openable Zotero attachment",
      { kind: "file", anchored: false, attachment: resolved(true) },
      "reader",
    ],
    [
      "a Zotero attachment that Obsidian cannot open",
      { kind: "file", anchored: false, attachment: resolved(false) },
      "obsidian",
    ],
    [
      "a PDF outside Zotero",
      { kind: "file", anchored: false, attachment: UNRESOLVED },
      "obsidian",
    ],
    [
      "a file while the index is pending",
      { kind: "file", anchored: false, attachment: { kind: "pending" } },
      "obsidian",
    ],
  ] as const)(
    "shows %s in the %s view while connected",
    (_, request, viewer) => {
      expect(viewerOf(true, request)).toBe(viewer);
    },
  );

  it("shows every open in Obsidian's view while ZotLit Reader is not connected", () => {
    expect(viewerOf(false, { kind: "attachment" })).toBe("obsidian");
    expect(
      viewerOf(false, {
        kind: "file",
        anchored: true,
        attachment: resolved(true),
      }),
    ).toBe("obsidian");
  });
});

describe("routedViewState", () => {
  it("opens a Zotero attachment in the reader when the open names only its file", () => {
    expect(routedViewState(pdfOf(ZOTERO_PDF), undefined, routing())).toEqual({
      type: READER,
      state: { file: ZOTERO_PDF },
    });
  });

  it("keeps a PDF outside Zotero in Obsidian's PDF view", () => {
    expect(
      routedViewState(pdfOf(OTHER_PDF), { subpath: "#page=2" }, routing()),
    ).toEqual(pdfOf(OTHER_PDF));
  });

  it("opens a link with an Annotation or Attachment Anchor in the reader for any PDF", () => {
    for (const subpath of [
      "#page=3&zt-annotation=PUPR5FG5",
      "#page=1&zt-attachment=RGRPDF24",
    ])
      expect(routedViewState(pdfOf(OTHER_PDF), { subpath }, routing())).toEqual(
        { type: READER, state: { file: OTHER_PDF } },
      );
  });

  it("waits for an answer that is still settling, and routes by it", async () => {
    const settling = routing(() => Promise.resolve(resolved(true)));
    const routed = routedViewState(pdfOf(ZOTERO_PDF), undefined, settling);

    expect(routed).toBeInstanceOf(Promise);
    expect(await routed).toEqual({ type: READER, state: { file: ZOTERO_PDF } });
  });

  it("leaves every other view type as it is, without asking for the Attachment", () => {
    const markdown = { type: "markdown", state: { file: ZOTERO_PDF } };
    const asked: string[] = [];
    expect(
      routedViewState(
        markdown,
        undefined,
        routing((path) => {
          asked.push(path);
          return resolved(true);
        }),
      ),
    ).toBe(markdown);
    expect(asked).toEqual([]);
  });
});

describe("registerViewerRouting", () => {
  class Leaf {
    readonly shown: ViewState[] = [];
    async setViewState(viewState: ViewState): Promise<void> {
      this.shown.push(viewState);
    }
  }

  it("routes each request of a host's leaves while registered, and stops when disposed", async () => {
    const leaf = new Leaf();
    {
      using _routing = registerViewerRouting(Leaf.prototype, routing());
      await leaf.setViewState(pdfOf(ZOTERO_PDF));
      await leaf.setViewState(pdfOf(OTHER_PDF));
    }
    await leaf.setViewState(pdfOf(ZOTERO_PDF));

    expect(leaf.shown.map((state) => state.type)).toEqual([
      READER,
      "pdf",
      "pdf",
    ]);
  });
});
