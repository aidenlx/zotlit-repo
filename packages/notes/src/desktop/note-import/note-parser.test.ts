// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import TurndownService from "turndown";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildAnnotationsTemplateData,
  citekeysToCiteTemplateData,
} from "@zotlit/db";
import type {
  Annotation,
  AnnotationSources,
  Attachment,
  CiteRef,
  CitationVariant,
  Item,
  TemplateAnnotation,
  TemplateParentItemData,
} from "@zotlit/db";
import { makeItem } from "@zotlit/db/item-fixture";
import { captureLogRecords } from "@zotlit/plugin-kernel/__fixtures__/log-capture.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import type {
  AttachmentSource,
  ResolveLinkOptions,
  SourceOrigin,
} from "@zotlit/plugin-services/desktop/attachment-import/service.ts";
import { getPackageRoot } from "@zotlit/scripts/package-roots";
import { inlineCitation, TemplateEngine } from "@zotlit/templates";
import defaultCitation from "@zotlit/templates/defaults/citation.liquid?raw";
import { TemplateFacade } from "@zotlit/templates/facade";
import { formatIndexedKey } from "@zotlit/zotero-types/keys";

import { noteReferences, parseNote } from "./note-parser.ts";
import type { ParseNoteDeps } from "./note-parser.ts";

import { renderAnnotationSources } from "#desktop/template/annotation-render.ts";

const packageRoot = getPackageRoot(import.meta.filename);

vi.mock("@zotlit/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@zotlit/db")>();
  return {
    ...actual,
    buildAnnotationsTemplateData: vi.fn(),
  };
});

const citedItem = vi.fn<(indexedKey: string) => Item | undefined>();
const embeddedAttachment = vi.fn<(key: string) => Attachment | undefined>();

function mockDbCitekeys(
  entries: Record<string, string | null>,
  groupID: number | null = null,
) {
  citedItem.mockImplementation((indexedKey) => {
    const key = Object.keys(entries).find(
      (entry) => formatIndexedKey(entry, groupID) === indexedKey,
    );
    return key === undefined
      ? undefined
      : makeItem(
          { itemType: "journalArticle", citationKey: entries[key]! },
          { key, indexedKey },
        );
  });
}

const ITEMS = "http://zotero.org/users/local/XmplLib8/items";
const ATTACHMENT = `${ITEMS}/XMPLATC4`;

const renderCite = (
  items: readonly {
    citationKey: string | null;
    locator?: string | null;
    labelShort?: string;
    suppressAuthor?: boolean;
  }[],
) =>
  `[${items
    .filter((c) => c.citationKey)
    .map((c) => {
      const key = `${c.suppressAuthor ? "-" : ""}@${c.citationKey}`;
      return c.locator ? `${key}, ${c.labelShort ?? "p."} ${c.locator}` : key;
    })
    .join("; ")}]`;

const blockedDecide = vi.fn(
  (path: string, origin: SourceOrigin): AttachmentSource => ({
    approved: false,
    path,
    origin,
    reason: "no-trusted-root",
  }),
);

const echoResolveLink = vi.fn(
  (opts: ResolveLinkOptions) => () => `[[${opts.vaultName}]]`,
);

const deps: ParseNoteDeps = {
  citedItems: { get: citedItem } as unknown as ReadonlyMap<string, Item>,
  groupID: null,
  attachments: { get: embeddedAttachment } as unknown as ReadonlyMap<
    string,
    Attachment
  >,
  useColoredHighlightSyntax: false,
  renderCite,
  pathContext: { dataDir: "/data", baseAttachmentPath: null },
  attachmentImport: { decide: blockedDecide, resolveLink: echoResolveLink },
};

function storageAttachment(key: string, filename = "img.png") {
  return { key, path: `storage:${filename}`, linkMode: 4 };
}

beforeEach(() => {
  vi.resetAllMocks();
});

const batchRender = (fn: (key: string) => string | null) =>
  vi.fn((keys: readonly string[]) => {
    const out = new Map<string, string>();
    for (const key of keys) {
      const callout = fn(key);
      if (callout !== null) out.set(key, callout);
    }
    return out;
  });

function note(body: string, version = 10, citationItems?: unknown): string {
  const attr =
    citationItems === undefined
      ? ""
      : ` data-citation-items="${encodeURIComponent(JSON.stringify(citationItems))}"`;
  return `<div data-schema-version="${version}"${attr}>${body}</div>`;
}

function cite(payload: Record<string, unknown>, text = "(citation)"): string {
  const attr = encodeURIComponent(JSON.stringify(payload));
  return `<span class="citation" data-citation="${attr}">${text}</span>`;
}

function annot(
  className: string,
  payload: Record<string, unknown>,
  text: string,
): string {
  const attr = encodeURIComponent(JSON.stringify(payload));
  return `<span class="${className}" data-annotation="${attr}">${text}</span>`;
}

describe("schema gate", () => {
  it("returns the legacy callout for a pre-v6 note", () => {
    const md = parseNote(TurndownService, note("<p>x</p>", 5), deps);
    expect(md).toContain("[!warning]");
    expect(md).toContain("schema version 5");
  });

  it("returns an empty string for empty input", () => {
    expect(parseNote(TurndownService, "", deps)).toBe("");
  });

  it("converts a Plain HTML Child Note with basic formatting", () => {
    const html = `
      <h2>Summary of a Research Article</h2>
      <p><strong>Source:</strong> Academic literature review</p>
      <div>
        <h3>Key findings</h3>
        <ul>
          <li>The method improves consistency.</li>
          <li>The approach scales to large areas.</li>
        </ul>
      </div>
    `;

    expect(parseNote(TurndownService, html, deps)).toBe(
      "## Summary of a Research Article\n\n" +
        "**Source:** Academic literature review\n\n" +
        "### Key findings\n\n" +
        "- The method improves consistency.\n" +
        "- The approach scales to large areas.",
    );
  });

  it.each(["", "invalid", "v6"])(
    "uses basic formatting when schema marker %s has no leading integer",
    (schemaVersion) => {
      expect(
        parseNote(
          TurndownService,
          `<div data-schema-version="${schemaVersion}"><p><span style="color: red">Summary</span></p></div>`,
          deps,
        ),
      ).toBe("Summary");
    },
  );

  it("sees through the zotero-note znv1 storage wrapper", () => {
    const md = parseNote(
      TurndownService,
      `<div class="zotero-note znv1">${note("<p>hello</p>")}</div>`,
      deps,
    );
    expect(md).toBe("hello");
  });
});

describe("blank lines", () => {
  it("preserves intentional blank lines instead of collapsing them", () => {
    const md = parseNote(
      TurndownService,
      note("<p>a</p><hr><hr><p>b</p>"),
      deps,
    );
    expect(md).toBe("a\n\n---\n\n---\n\nb");
  });

  it("keeps a fenced code block's internal blank lines in the note body", () => {
    const md = parseNote(
      TurndownService,
      note("<pre><code>line1\n\n\n\nline2</code></pre>"),
      deps,
    );
    expect(md).toBe("```\nline1\n\n\n\nline2\n```");
  });
});

describe("highlight annotation", () => {
  const md = parseNote(
    TurndownService,
    note(
      annot(
        "highlight",
        {
          attachmentURI: ATTACHMENT,
          annotationKey: "XMPLANN6",
          color: "#e56eee",
          pageLabel: "62",
        },
        "might aid in our understanding",
      ),
    ),
    deps,
  );

  it("wraps the excerpt in a linked, colored <mark>", () => {
    expect(md).toBe(
      '[<mark class="zotlit-hl" data-color="magenta" ' +
        'style="background-color: var(--zotlit-hl-magenta, #e56eee);">' +
        "might aid in our understanding</mark>]" +
        "(zotero://open/library/items/XMPLATC4?annotation=XMPLANN6&page=62)",
    );
  });

  it("uses linked emoji-based syntax when enabled", () => {
    const md = parseNote(
      TurndownService,
      note(
        annot(
          "highlight",
          {
            attachmentURI: ATTACHMENT,
            annotationKey: "XMPLANN6",
            color: "#2ea8e5",
            pageLabel: "62",
          },
          "might aid in our understanding",
        ),
      ),
      { ...deps, useColoredHighlightSyntax: true },
    );

    expect(md).toBe(
      "[==🔵might aid in our understanding==]" +
        "(zotero://open/library/items/XMPLATC4?annotation=XMPLANN6&page=62)",
    );
  });

  it.each(["#e56eee", "#aaaaaa", "#a6507b"])(
    "maps %s excerpts to a custom emoji and preserves the backlink",
    (color) => {
      const md = parseNote(
        TurndownService,
        note(
          annot(
            "highlight",
            {
              attachmentURI: ATTACHMENT,
              annotationKey: "XMPLANN6",
              color,
              pageLabel: "62",
            },
            "Highlighted text",
          ),
        ),
        {
          ...deps,
          useColoredHighlightSyntax: true,
          highlightMappings: {
            magenta: { output: "custom", customEmoji: "👩‍🔬" },
            gray: { output: "custom", customEmoji: "👩‍🔬" },
            plum: { output: "custom", customEmoji: "👩‍🔬" },
          },
        },
      );

      expect(md).toBe(
        "[==👩‍🔬Highlighted text==](zotero://open/library/items/XMPLATC4?annotation=XMPLANN6&page=62)",
      );
    },
  );

  it.each(["", "🔴🔵"])(
    "keeps linked HTML for an incomplete custom mapping: %j",
    (customEmoji) => {
      const md = parseNote(
        TurndownService,
        note(
          annot(
            "highlight",
            {
              attachmentURI: ATTACHMENT,
              annotationKey: "XMPLANN6",
              color: "#2ea8e5",
            },
            "Highlighted text",
          ),
        ),
        {
          ...deps,
          useColoredHighlightSyntax: true,
          highlightMappings: { blue: { output: "custom", customEmoji } },
        },
      );

      expect(md).toContain('[<mark class="zotlit-hl" data-color="blue"');
      expect(md).toContain(
        "](zotero://open/library/items/XMPLATC4?annotation=XMPLANN6)",
      );
    },
  );

  it("keeps linked HTML for an unsupported color when enabled", () => {
    const md = parseNote(
      TurndownService,
      note(
        annot(
          "highlight",
          {
            attachmentURI: ATTACHMENT,
            annotationKey: "XMPLANN6",
            color: "#e56eee",
          },
          "might aid in our understanding",
        ),
      ),
      { ...deps, useColoredHighlightSyntax: true },
    );

    expect(md).toContain('[<mark class="zotlit-hl" data-color="magenta"');
    expect(md).toContain(
      "](zotero://open/library/items/XMPLATC4?annotation=XMPLANN6)",
    );
  });
});

describe("underline annotation", () => {
  it("wraps the excerpt in a linked, colored <u>", () => {
    const md = parseNote(
      TurndownService,
      note(
        annot(
          "underline",
          {
            attachmentURI: ATTACHMENT,
            annotationKey: "XMPLANN4",
            color: "#ffd400",
            pageLabel: "62",
          },
          "reference alternative as valu",
        ),
      ),
      deps,
    );
    expect(md).toBe(
      '[<u class="zotlit-ul" data-color="yellow" ' +
        'style="text-decoration-color: var(--zotlit-ul-yellow, #ffd400);">' +
        "reference alternative as valu</u>]" +
        "(zotero://open/library/items/XMPLATC4?annotation=XMPLANN4&page=62)",
    );
  });
});

describe("annotation edge cases", () => {
  it("preserves user-edited span text (not the DB annotation text)", () => {
    const md = parseNote(
      TurndownService,
      note(
        annot(
          "highlight",
          { attachmentURI: ATTACHMENT, annotationKey: "K", color: "#ffd400" },
          "edited by the user",
        ),
      ),
      deps,
    );
    expect(md).toContain(">edited by the user</mark>");
  });

  it("emits a plain mark without a link when the attachment URI is malformed", () => {
    const md = parseNote(
      TurndownService,
      note(
        annot(
          "highlight",
          {
            attachmentURI: "not-a-zotero-uri",
            annotationKey: "K",
            color: "#ffd400",
          },
          "no link",
        ),
      ),
      deps,
    );
    expect(md).toBe(
      '<mark class="zotlit-hl" data-color="yellow" ' +
        'style="background-color: var(--zotlit-hl-yellow, #ffd400);">no link</mark>',
    );
  });

  it("falls back to inline hex for an unmapped color", () => {
    const md = parseNote(
      TurndownService,
      note(
        annot(
          "highlight",
          { attachmentURI: ATTACHMENT, annotationKey: "K", color: "#123456" },
          "odd color",
        ),
      ),
      deps,
    );
    expect(md).toContain(
      '<mark class="zotlit-hl" style="background-color: #123456;">',
    );
    expect(md).not.toContain("data-color");
    expect(md).not.toContain("var(");
  });

  it("builds a group-library backlink for a group attachment", () => {
    const md = parseNote(
      TurndownService,
      note(
        annot(
          "highlight",
          {
            attachmentURI: "http://zotero.org/groups/9/items/XMPLATC4",
            annotationKey: "K",
            color: "#ffd400",
          },
          "group excerpt",
        ),
      ),
      deps,
    );
    expect(md).toContain(
      "(zotero://open/groups/9/items/XMPLATC4?annotation=K)",
    );
  });

  it("omits the page hint when the payload has no pageLabel", () => {
    const md = parseNote(
      TurndownService,
      note(
        annot(
          "highlight",
          { attachmentURI: ATTACHMENT, annotationKey: "K", color: "#ffd400" },
          "no page",
        ),
      ),
      deps,
    );
    expect(md).toContain("items/XMPLATC4?annotation=K)");
    expect(md).not.toContain("page=");
  });
});

describe("embedded image resolution", () => {
  const img = (key: string) =>
    `<p><img data-attachment-key="${key}" alt=""></p>`;

  it("omits embedded images whose files the online library does not hold, keeps their alt text, and logs once for the note", () => {
    embeddedAttachment.mockReturnValue(
      storageAttachment("XMPLATC5", "diagram.png") as never,
    );
    using logs = captureLogRecords();
    const md = parseNote(
      TurndownService,
      note(
        `<p>Before</p><img data-attachment-key="XMPLATC5" alt="Figure 1"><img data-attachment-key="XMPLATC5"><p>After</p>`,
      ),
      {
        ...deps,
        pathContext: { dataDir: null, baseAttachmentPath: null },
      },
    );
    expect(md).not.toContain("<img");
    expect(md).not.toContain("![[");
    expect(md).toContain("Figure 1");
    expect(md).toContain("Before");
    expect(md).toContain("After");
    expect(
      logs.records.filter((record) => /image/iu.test(record.rawMessage)),
    ).toHaveLength(1);
    expect(blockedDecide).not.toHaveBeenCalled();
    expect(echoResolveLink).not.toHaveBeenCalled();
  });

  it("resolves a storage image to a vault embed via resolveLink", () => {
    embeddedAttachment.mockReturnValue(
      storageAttachment("XMPLATC5", "diagram.png") as never,
    );
    const md = parseNote(TurndownService, note(img("XMPLATC5")), deps);
    expect(md).toBe("![[XMPLATC5-diagram.png]]");
    expect(blockedDecide).toHaveBeenCalledWith(
      "/data/storage/XMPLATC5/diagram.png",
      "storage",
    );
    expect(echoResolveLink).toHaveBeenCalledWith({
      source: {
        approved: false,
        path: "/data/storage/XMPLATC5/diagram.png",
        origin: "storage",
        reason: "no-trusted-root",
      },
      vaultName: "XMPLATC5-diagram.png",
    });
  });

  it("passes a missing attachment through as raw HTML", () => {
    embeddedAttachment.mockReturnValue(undefined);
    const md = parseNote(TurndownService, note(img("GONE1234")), deps);
    expect(md).toContain('data-attachment-key="GONE1234"');
    expect(md.startsWith("<img")).toBe(true);
    expect(echoResolveLink).not.toHaveBeenCalled();
  });

  it("passes a path-unresolved attachment through as raw HTML", () => {
    embeddedAttachment.mockReturnValue(
      stubService<Attachment>("Attachment", {
        key: "URL12345",
        path: "http://example.com/a.png",
        linkMode: 3,
      }),
    );
    const md = parseNote(TurndownService, note(img("URL12345")), deps);
    expect(md).toContain('data-attachment-key="URL12345"');
    expect(echoResolveLink).not.toHaveBeenCalled();
  });
});

describe("annotation template mode", () => {
  const render = batchRender((key) =>
    key === "GONE" ? null : `> [!note]\n>\n> callout ${key}`,
  );
  const withRender = (): ParseNoteDeps => ({
    ...deps,
    renderAnnotationParagraph: render,
  });

  const citation = cite({
    citationItems: [{ uris: [`${ITEMS}/XMPLITM3`] }],
    properties: {},
  });

  const spanPara = (className: string, key: string) =>
    `<p>${annot(
      className,
      { attachmentURI: ATTACHMENT, annotationKey: key, color: "#ffd400" },
      "excerpt",
    )} ${citation} trailing comment</p>`;

  it("subsumes a highlight paragraph into the rendered callout", () => {
    const md = parseNote(
      TurndownService,
      note(spanPara("highlight", "K1")),
      withRender(),
    );
    expect(md).toBe("> [!note]\n>\n> callout K1");
    expect(render).toHaveBeenCalledExactlyOnceWith(["K1"]);
  });

  it("subsumes an underline paragraph too", () => {
    const md = parseNote(
      TurndownService,
      note(spanPara("underline", "K2")),
      withRender(),
    );
    expect(md).toBe("> [!note]\n>\n> callout K2");
  });

  it("falls back to an inline mark when the renderer declines", () => {
    const md = parseNote(
      TurndownService,
      note(spanPara("highlight", "GONE")),
      withRender(),
    );
    expect(md).toContain('<mark class="zotlit-hl"');
    expect(md).not.toContain("[!note]");
  });

  it("falls back to an inline mark when the renderer omits the key (blank render)", () => {
    const md = parseNote(TurndownService, note(spanPara("highlight", "K1")), {
      ...deps,
      renderAnnotationParagraph: batchRender(() => "   \n"),
    });
    expect(md).toContain('<mark class="zotlit-hl"');
    expect(md).not.toContain("[!note]");
  });

  it("bails to inline when prose precedes the excerpt", () => {
    const body = `<p>an invented lead-in before ${annot(
      "highlight",
      { attachmentURI: ATTACHMENT, annotationKey: "K5", color: "#ffd400" },
      "excerpt",
    )} ${citation}</p>`;
    const md = parseNote(TurndownService, note(body), withRender());
    expect(render).not.toHaveBeenCalled();
    expect(md).toContain("an invented lead-in before");
    expect(md).toContain("<mark");
  });

  it("bails to inline when an extra element joins the paragraph", () => {
    const body = `<p>${annot(
      "highlight",
      { attachmentURI: ATTACHMENT, annotationKey: "K4", color: "#ffd400" },
      "excerpt",
    )} <em>hand-written aside</em></p>`;
    const md = parseNote(TurndownService, note(body), withRender());
    expect(render).not.toHaveBeenCalled();
    expect(md).toContain("<mark");
    expect(md).toContain("_hand-written aside_");
  });

  it("leaves an annotation paragraph nested in a list inline, preserving structure", () => {
    const body = `<ul><li>${spanPara("highlight", "K7")}</li></ul>`;
    const md = parseNote(TurndownService, note(body), withRender());
    expect(render).not.toHaveBeenCalled();
    expect(md).toContain("<mark");
    expect(md).not.toContain("[!note]");
    expect(md).toMatch(/^- /m);
  });

  it("ignores a citation-only paragraph", () => {
    mockDbCitekeys({ XMPLITM3: "Hensher2011" });
    const md = parseNote(
      TurndownService,
      note(`<p>${citation} plain note text</p>`),
      withRender(),
    );
    expect(render).not.toHaveBeenCalled();
    expect(md).toContain("[@Hensher2011]");
    expect(md).toContain("plain note text");
  });

  it("collapses a blank-line run inside a custom template's callout and trims its edges", () => {
    const md = parseNote(TurndownService, note(spanPara("highlight", "K8")), {
      ...deps,
      renderAnnotationParagraph: batchRender((key) =>
        key === "K8"
          ? "> [!note]\n>\n> line one\n\n\n\n> line two\n\n\n"
          : null,
      ),
    });
    expect(md).toBe("> [!note]\n>\n> line one\n\n> line two");
    expect(md).not.toMatch(/\n{3,}/);
  });

  it("carries zt.citation onto a subsumed annotation paragraph via the real render path (9.2-CSL #05)", () => {
    const facade = new TemplateFacade();
    facade.define("citation", defaultCitation, "liquid");
    facade.define("annotation", "> [!note]\n>\n> <%= zt.citation %>", "eta");
    vi.mocked(buildAnnotationsTemplateData).mockReturnValue(
      new Map([
        [
          "K1",
          stubService<TemplateAnnotation>("TemplateAnnotation", {
            key: "K1",
            pageLabel: "62",
            parentItem: stubService<TemplateParentItemData>("ParentItem", {
              key: "HENSHER1",
              groupID: null,
              libraryID: 1,
              indexedKey: "HENSHER1",
              dateAdded: Temporal.Instant.fromEpochMilliseconds(0),
              dateModified: Temporal.Instant.fromEpochMilliseconds(0),
              tags: [],
              notePath: null,
              noteLink: () => null,
              citationKey: "Hensher2011",
              citekey: "Hensher2011",
            }),
          }),
        ],
      ]),
    );
    const renderAnnotationParagraph = (keys: readonly string[]) =>
      renderAnnotationSources(
        stubService<AnnotationSources>("AnnotationSources", {
          annotations: keys.map((key) =>
            stubService<Annotation>("Annotation", { key }),
          ),
        }),
        {
          template: stubService<
            Parameters<typeof renderAnnotationSources>[1]["template"]
          >("Template", {
            render: (name: string, data: object) => facade.render(name, data),
            renderCitation: (
              refs: readonly CiteRef[],
              variant: CitationVariant,
            ) =>
              inlineCitation(
                facade.render(
                  "citation",
                  citekeysToCiteTemplateData(refs, variant),
                ),
              ),
          }),
          zoteroPref: { dataDir: "/data", baseAttachmentPath: null },
          attachmentImport: {
            decide: blockedDecide,
            resolveLink: echoResolveLink,
          },
        },
      );
    const md = parseNote(TurndownService, note(spanPara("highlight", "K1")), {
      ...deps,
      renderAnnotationParagraph,
    });
    expect(md).toContain("[@Hensher2011, {p. 62}]");
  });
});

describe("citation resolution", () => {
  const oneCite = cite({
    citationItems: [{ uris: [`${ITEMS}/XMPLITM3`] }],
    properties: {},
  });

  it("resolves a cited item to its live DB citation key, emitted verbatim", () => {
    mockDbCitekeys({ XMPLITM3: "Hensher2011" });
    const md = parseNote(TurndownService, note(oneCite), deps);
    expect(md).toContain("[@Hensher2011]");
    expect(md).not.toContain("\\[");
  });

  it("falls back to the embedded snapshot map when the DB misses", () => {
    const md = parseNote(
      TurndownService,
      note(oneCite, 10, [
        {
          uris: [`${ITEMS}/XMPLITM3`],
          itemData: { id: `${ITEMS}/XMPLITM3`, "citation-key": "Embedded2020" },
        },
      ]),
      deps,
    );
    expect(md).toContain("[@Embedded2020]");
  });

  it("emits a visible sentinel when the DB and embedded map both miss", () => {
    const md = parseNote(TurndownService, note(oneCite), deps);
    expect(md).toContain("[@XMPLITM3?]");
  });

  it("leaves an unresolvable (no-ref) citation as raw-HTML passthrough", () => {
    const md = parseNote(
      TurndownService,
      note(cite({ citationItems: [{ uris: ["not-a-uri"] }], properties: {} })),
      deps,
    );
    expect(md).toContain("data-citation");
    expect(md).not.toContain("[@");
  });

  it("renders a multi-item mark through one joined cite render", () => {
    mockDbCitekeys({ XMPLITM3: "Hensher2011" });
    const md = parseNote(
      TurndownService,
      note(
        cite({
          citationItems: [
            { uris: [`${ITEMS}/XMPLITM3`] },
            { uris: [`${ITEMS}/XMPLITM2`] },
          ],
          properties: {},
        }),
        10,
        [
          {
            uris: [`${ITEMS}/XMPLITM2`],
            itemData: { id: `${ITEMS}/XMPLITM2`, "citation-key": "Kang2013" },
          },
        ],
      ),
      deps,
    );
    expect(md).toContain("[@Hensher2011; @Kang2013]");
  });

  it("still resolves via embedded and sentinel when the DB is degraded", () => {
    const md = parseNote(
      TurndownService,
      note(
        cite({
          citationItems: [
            { uris: [`${ITEMS}/XMPLITM3`] },
            { uris: [`${ITEMS}/NOEMBED0`] },
          ],
          properties: {},
        }),
        10,
        [
          {
            uris: [`${ITEMS}/XMPLITM3`],
            itemData: {
              id: `${ITEMS}/XMPLITM3`,
              "citation-key": "Embedded2020",
            },
          },
        ],
      ),
      deps,
    );
    expect(md).toContain("[@Embedded2020; @NOEMBED0?]");
  });

  it("resolves a group-library citation in the group's own library, not the note's", () => {
    mockDbCitekeys({ GRP1TEM: "GroupCite2020" }, 9);
    const md = parseNote(
      TurndownService,
      note(
        cite({
          citationItems: [
            { uris: [`http://zotero.org/groups/9/items/GRP1TEM`] },
          ],
          properties: {},
        }),
      ),
      deps,
    );
    expect(citedItem).toHaveBeenCalledWith("GRP1TEMg9");
    expect(md).toContain("[@GroupCite2020]");
  });

  it("resolves a personal-library ref of a group note in the note's group", () => {
    mockDbCitekeys({ XMPLITM3: "GroupNote2020" }, 5);
    const md = parseNote(TurndownService, note(oneCite), {
      ...deps,
      groupID: 5,
    });
    expect(citedItem).toHaveBeenCalledWith("XMPLITM3g5");
    expect(md).toContain("[@GroupNote2020]");
  });

  it("leaves a citation of a group the database does not hold to the sentinel", () => {
    mockDbCitekeys({ GRP1TEM: "PersonalCite2020" });
    const md = parseNote(
      TurndownService,
      note(
        cite({
          citationItems: [
            { uris: [`http://zotero.org/groups/9/items/GRP1TEM`] },
          ],
          properties: {},
        }),
      ),
      deps,
    );
    expect(citedItem).toHaveBeenCalledWith("GRP1TEMg9");
    expect(md).toContain("[@GRP1TEM?]");
  });

  it("trims the rendered citation so it stays inline (the document's trailing \\n)", () => {
    mockDbCitekeys({ XMPLITM3: "Hensher2011" });
    const md = parseNote(TurndownService, note(`x ${oneCite} y`), {
      ...deps,
      renderCite: (items) => `${renderCite(items)}\n`,
    });
    expect(md).toBe("x [@Hensher2011] y");
  });

  it("threads a page locator through to the rendered citation (9.2-CSL #02)", () => {
    mockDbCitekeys({ XMPLITM3: "Hensher2011" });
    const md = parseNote(
      TurndownService,
      note(
        cite({
          citationItems: [{ uris: [`${ITEMS}/XMPLITM3`], locator: "62" }],
          properties: {},
        }),
      ),
      deps,
    );
    expect(md).toContain("[@Hensher2011, p. 62]");
  });

  it("renders a non-page label with its Pandoc abbreviation", () => {
    mockDbCitekeys({ XMPLITM3: "Hensher2011" });
    const md = parseNote(
      TurndownService,
      note(
        cite({
          citationItems: [
            {
              uris: [`${ITEMS}/XMPLITM3`],
              locator: "3",
              label: "chapter",
            },
          ],
          properties: {},
        }),
      ),
      deps,
    );
    expect(md).toContain("[@Hensher2011, chap. 3]");
  });

  it("threads locator/label/suppress-author through the production renderCite glue (citekeysToCiteTemplateData + the built-in Citation Template)", () => {
    const facade = new TemplateFacade();
    facade.define("citation", defaultCitation, "liquid");
    mockDbCitekeys({ XMPLITM3: "Hensher2011" });
    const md = parseNote(
      TurndownService,
      note(
        cite({
          citationItems: [
            {
              uris: [`${ITEMS}/XMPLITM3`],
              locator: "62",
              "suppress-author": true,
            },
          ],
          properties: {},
        }),
      ),
      {
        ...deps,
        renderCite: (items) =>
          facade.render("citation", citekeysToCiteTemplateData(items, "main")),
      },
    );
    expect(md).toContain("[-@Hensher2011, {p. 62}]");
  });

  it("renders suppress-author as a Pandoc -@key prefix", () => {
    mockDbCitekeys({ XMPLITM3: "Hensher2011" });
    const md = parseNote(
      TurndownService,
      note(
        cite({
          citationItems: [
            { uris: [`${ITEMS}/XMPLITM3`], "suppress-author": true },
          ],
          properties: {},
        }),
      ),
      deps,
    );
    expect(md).toContain("[-@Hensher2011]");
  });

  it("composes suppress-author with the unresolved-key sentinel", () => {
    const md = parseNote(
      TurndownService,
      note(
        cite({
          citationItems: [
            { uris: [`${ITEMS}/XMPLITM3`], "suppress-author": true },
          ],
          properties: {},
        }),
      ),
      deps,
    );
    expect(md).toContain("[-@XMPLITM3?]");
  });

  it("falls back to raw-HTML passthrough when a citation prop has the wrong type", () => {
    const md = parseNote(
      TurndownService,
      note(
        cite({
          citationItems: [
            { uris: [`${ITEMS}/XMPLITM3`], "suppress-author": "yes" },
          ],
          properties: {},
        }),
      ),
      deps,
    );
    expect(md).toContain("data-citation");
    expect(md).not.toContain("[@");
  });
});

describe("noteReferences", () => {
  const personal = cite({
    citationItems: [{ uris: [`${ITEMS}/XMPLITM3`] }],
    properties: {},
  });
  const grouped = cite({
    citationItems: [
      { uris: ["http://zotero.org/groups/9/items/GRP1TEM"] },
      { uris: [`${ITEMS}/XMPLITM3`] },
    ],
    properties: {},
  });
  const image = '<img data-attachment-key="XMPLATC5" alt="">';

  it("names each cited Item's Indexed Key and each embedded image's key once", () => {
    const html = note(
      `<p>${personal} ${grouped}</p><p>${image}</p><p>${image}</p>`,
    );
    expect(noteReferences(html, null)).toEqual({
      citedIndexedKeys: ["XMPLITM3", "GRP1TEMg9"],
      attachmentKeys: ["XMPLATC5"],
    });
  });

  it("names a personal-library ref of a group note in the note's group", () => {
    expect(noteReferences(note(`<p>${personal}</p>`), 5)).toEqual({
      citedIndexedKeys: ["XMPLITM3g5"],
      attachmentKeys: [],
    });
  });

  it("names nothing for a note the Zotero rules do not convert", () => {
    expect(noteReferences(`<p>${personal} ${image}</p>`, null)).toEqual({
      citedIndexedKeys: [],
      attachmentKeys: [],
    });
  });
});

describe("citation resolution — DB item data (9.2-CSL #03)", () => {
  const oneCite = cite({
    citationItems: [{ uris: [`${ITEMS}/XMPLITM3`] }],
    properties: {},
  });

  it("exposes the DB-resolved item's title/date to a custom author-year cite template through the production renderCite glue", () => {
    const engine = new TemplateEngine();
    engine.define(
      "citation",
      "<%= zt.citations.map(c => `${c.item.title} (${c.item.date?.year ?? 'n.d.'})`).join('; ') %>",
    );
    citedItem.mockReturnValue(
      makeItem({
        itemType: "journalArticle",
        title: "Stated choice methods",
        date: "2011",
        citationKey: "Hensher2011",
      }),
    );
    const md = parseNote(TurndownService, note(oneCite), {
      ...deps,
      renderCite: (items) =>
        engine.render("citation", citekeysToCiteTemplateData(items, "main")),
    });
    expect(md).toContain("Stated choice methods (2011)");
  });

  it("still uses the note's embedded snapshot citekey when the DB item carries none, while keeping the DB item's other data", () => {
    const engine = new TemplateEngine();
    engine.define(
      "citation",
      "<%= zt.citations.map(c => `${c.item.citekey}: ${c.item.title}`).join('; ') %>",
    );
    citedItem.mockReturnValue(
      makeItem({
        itemType: "journalArticle",
        title: "Stated choice methods",
        citationKey: null,
      }),
    );
    const md = parseNote(
      TurndownService,
      note(oneCite, 10, [
        {
          uris: [`${ITEMS}/XMPLITM3`],
          itemData: { id: `${ITEMS}/XMPLITM3`, "citation-key": "Embedded2020" },
        },
      ]),
      {
        ...deps,
        renderCite: (items) =>
          engine.render("citation", citekeysToCiteTemplateData(items, "main")),
      },
    );
    expect(md).toContain("Embedded2020: Stated choice methods");
  });
});

describe("citation resolution — embedded item data (9.2-CSL #04)", () => {
  const dataDrivenCite =
    "<%= zt.citations.map(c => `${c.item.citekey}: ${c.item.title} " +
    "(${c.item.date?.year ?? 'n.d.'}) — ${c.item.containerTitle}`).join('; ') %>";

  const embedded = (uri: string, over: Record<string, unknown> = {}) => ({
    uris: [uri],
    itemData: {
      id: uri,
      type: "article-journal",
      title: "Stated choice methods",
      "container-title": "Transport Reviews",
      issued: { "date-parts": [[2011]] },
      "citation-key": "Kang2013",
      ...over,
    },
  });

  function withDataTemplate(): ParseNoteDeps {
    const engine = new TemplateEngine();
    engine.define("citation", dataDrivenCite);
    return {
      ...deps,
      renderCite: (items) =>
        engine.render("citation", citekeysToCiteTemplateData(items, "main")),
    };
  }

  it("renders full item data from the embedded snapshot for a cross-library cite the DB can't resolve", () => {
    const uri = "http://zotero.org/groups/9/items/GRP1TEM";
    const md = parseNote(
      TurndownService,
      note(cite({ citationItems: [{ uris: [uri] }], properties: {} }), 10, [
        embedded(uri),
      ]),
      withDataTemplate(),
    );
    expect(md).toContain(
      "Kang2013: Stated choice methods (2011) — Transport Reviews",
    );
  });

  it("resolves full embedded item data when the DB is degraded (client not ready)", () => {
    const uri = `${ITEMS}/XMPLITM3`;
    const md = parseNote(
      TurndownService,
      note(cite({ citationItems: [{ uris: [uri] }], properties: {} }), 10, [
        embedded(uri),
      ]),
      withDataTemplate(),
    );
    expect(md).toContain(
      "Kang2013: Stated choice methods (2011) — Transport Reviews",
    );
  });

  it("keeps the live DB item's data over the embedded snapshot when both resolve", () => {
    citedItem.mockReturnValue(
      makeItem({
        itemType: "journalArticle",
        title: "Live DB title",
        publicationTitle: "Live DB journal",
        citationKey: "Hensher2011",
      }),
    );
    const uri = `${ITEMS}/XMPLITM3`;
    const md = parseNote(
      TurndownService,
      note(cite({ citationItems: [{ uris: [uri] }], properties: {} }), 10, [
        embedded(uri, {
          title: "Stale snapshot title",
          "citation-key": "Snapshot2020",
        }),
      ]),
      withDataTemplate(),
    );
    expect(md).toContain("Hensher2011: Live DB title");
    expect(md).not.toContain("Stale snapshot title");
    expect(md).not.toContain("Snapshot2020");
  });
});

describe("fixtures (resolving)", () => {
  function fixture(name: string): string {
    return readFileSync(
      join(packageRoot, "src/__fixtures__/note-import/turndown", name),
      "utf8",
    );
  }

  it("renders images, citations, and formatting in zt-note-example.html", () => {
    embeddedAttachment.mockImplementation(
      (key) => storageAttachment(key) as never,
    );
    const md = parseNote(
      TurndownService,
      fixture("zt-note-example.html"),
      deps,
    );

    expect(md).toContain("![[XMPLATC5-img.png]]");
    expect(md).not.toContain("<img");
    expect(md).toContain("[@Kang2013; @Hensher2011]");
    expect(md).not.toContain("data-citation");
    expect(md).toContain("$e^{i\\pi}+1=0$");
    expect(md).toContain("$$\\frac{a_1}{b_2}$$");
  });

  it("extracts annotations and image excerpts in zt-excerpt-note.html", () => {
    embeddedAttachment.mockImplementation(
      (key) => storageAttachment(key) as never,
    );
    const md = parseNote(
      TurndownService,
      fixture("zt-excerpt-note.html"),
      deps,
    );

    expect(md).toContain('<mark class="zotlit-hl" data-color="red"');
    expect(md).toContain("annotation=XMPLANN9&page=62)");
    expect(md).toContain("annotation=XMPLANNA&page=62)");
    expect(md).toContain('<u class="zotlit-ul" data-color="yellow"');
    expect(md).toContain("annotation=XMPLANNC&page=62)");
    expect(md).toContain("![[XMPLATC2-img.png]]");
    expect(md).not.toContain("<img");
    expect(md).toContain("[@Hensher2011, p. 62]");
    expect(md).not.toContain("data-citation");
  });

  it("renders every annotation paragraph via the template when enabled", () => {
    embeddedAttachment.mockImplementation(
      (key) => storageAttachment(key) as never,
    );
    const renderAnnotationParagraph = batchRender(
      (key) => `> [!note] Page 62\n>\n> excerpt ${key}`,
    );
    const md = parseNote(TurndownService, fixture("zt-excerpt-note.html"), {
      ...deps,
      renderAnnotationParagraph,
    });

    const subsumed = [
      "XMPLANN9",
      "XMPLANNC",
      "XMPLANNA",
      "XMPLANN7",
      "XMPLANND",
      "XMPLANNB",
    ];
    expect(renderAnnotationParagraph).toHaveBeenCalledExactlyOnceWith(subsumed);
    expect(renderAnnotationParagraph.mock.calls[0]![0]).not.toContain(
      "XMPLANN5",
    );
    for (const key of subsumed) {
      expect(md).toContain(`> [!note] Page 62\n>\n> excerpt ${key}`);
    }
    expect(md).toContain("an invented lead-in before");
    expect(md).toContain("annotation=XMPLANN5&page=62)");
    expect(md).not.toContain("![[XMPLATC2");
    expect(embeddedAttachment).not.toHaveBeenCalled();
  });
});
