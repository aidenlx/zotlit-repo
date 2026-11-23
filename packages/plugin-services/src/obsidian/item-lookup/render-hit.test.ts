// @vitest-environment happy-dom

import type { PluginSettings } from "#obsidian/settings/service.ts";
import { Effect } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import { makeCreator, makeItem } from "@zotlit/item-lookup/fixtures";
import type {
  ItemFixtureOptions,
  TypedItemFixtureOptions,
} from "@zotlit/item-lookup/fixtures";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { AvailableLibrary } from "@zotlit/zotero-reads/contract/library-scope.ts";
import type { ItemFields } from "@zotlit/zotero-types";

import { renderSuggestion } from "./render-hit.ts";
import type { SearchHit } from "./service.ts";

import { platformDefaults as defaults } from "#__fixtures__/platform-settings.ts";

const settings = {
  current: Effect.succeed(defaults),
} satisfies Pick<PluginSettings["Service"], "current">;
const bridge = { runSync: Effect.runSync };

describe("renderSuggestion title", () => {
  const title = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const result = {
    ...hit(null),
    item: makeItem({ key: "AAAAAAAA", title }),
  };
  let el: HTMLDivElement;
  let style: HTMLStyleElement;

  beforeEach(() => {
    el = document.body.createDiv();
    style = document.head.createEl("style");
    HTMLElement.prototype.appendText = function (this: HTMLElement, text) {
      this.append(text);
    };
    return () => {
      el.remove();
      style.remove();
      Reflect.deleteProperty(HTMLElement.prototype, "appendText");
    };
  });

  it("uses the new title budget after the CSS property changes", () => {
    style.textContent = titleBudgetRule("30");
    renderSuggestion(settings, bridge, result, el);
    expect(el.querySelector(".suggestion-title > span")?.textContent).toBe(
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123…",
    );

    style.textContent = titleBudgetRule("12");
    renderSuggestion(settings, bridge, result, el);
    expect(el.querySelector(".suggestion-title > span")?.textContent).toBe(
      "ABCDEFGHIJKL…",
    );
  });

  it("uses the last connected title budget for a detached row", () => {
    style.textContent = titleBudgetRule("12");
    renderSuggestion(settings, bridge, result, el);
    const detached = createDiv();
    renderSuggestion(settings, bridge, result, detached);
    expect(
      detached.querySelector(".suggestion-title > span")?.textContent,
    ).toBe("ABCDEFGHIJKL…");
  });

  it.each(["", "invalid", "0"])(
    "uses 60 characters for the CSS value %j",
    (value) => {
      if (value) style.textContent = titleBudgetRule(value);
      const prefix = "A".repeat(60);
      const item = makeItem({ key: "AAAAAAAA", title: `${prefix}B` });
      renderSuggestion(settings, bridge, { ...result, item }, el);
      expect(el.querySelector(".suggestion-title > span")?.textContent).toBe(
        `${prefix}…`,
      );
    },
  );

  it("keeps the window and highlight around the first match", () => {
    style.textContent = titleBudgetRule("12");
    renderSuggestion(settings, bridge, { ...result, matches: [[17, 20]] }, el);
    expect(el.querySelector(".suggestion-title > span")?.textContent).toBe(
      "…OPQRSTUVWXYZ…",
    );
    expect(el.querySelector(".suggestion-highlight")?.textContent).toBe("RST");
  });
});

function titleBudgetRule(value: string): string {
  return `.suggestion-title > span { --zt-citation-title-max-chars: ${value}; }`;
}

describe("renderSuggestion library label", () => {
  it.each([null, group(100, "Shared A")])(
    "shows cited and Library flairs together for %j",
    (library) => {
      const el = document.createElement("div");
      renderSuggestion(settings, bridge, { ...hit(library), cited: true }, el);
      const expected = [
        m.citation_suggester_cited_in_note(),
        ...(library ? ["Shared A"] : []),
      ];
      expect(
        [...el.querySelectorAll(".zt-suggestion-flair-inline")].map(
          (flair) => flair.textContent,
        ),
      ).toEqual(expected);
      expect(
        [...el.querySelectorAll(".zt-suggestion-flair-text")].map(
          (flair) => flair.textContent,
        ),
      ).toEqual(expected);
    },
  );

  it("names the library a result came from", () => {
    expect(libraryText(group(100, "Shared A"))).toBe("Shared A");
  });

  it("omits the label when one library can contribute", () => {
    expect(libraryText(null)).toBeNull();
  });

  it("omits the label for My Library, the implicit source", () => {
    expect(
      libraryText({
        selector: { type: "personal" },
        libraryID: 1,
        name: null,
      }),
    ).toBeNull();
  });
});

function libraryText(library: AvailableLibrary | null): string | null {
  const el = document.createElement("div");
  renderSuggestion(settings, bridge, hit(library), el);
  return (
    el.querySelector(".zt-suggestion-flair .zt-suggestion-flair-text")
      ?.textContent ?? null
  );
}

function hit(library: AvailableLibrary | null): SearchHit {
  return {
    item: makeItem({ key: "AAAAAAAA", title: "Alpha" }),
    matches: [],
    library,
    cited: false,
  };
}

function group(groupID: number, name: string): AvailableLibrary {
  return { selector: { type: "group", groupID }, libraryID: groupID, name };
}

describe("renderSuggestion result meta line", () => {
  const authored = {
    date: "2023-05-01",
    primaryCreatorType: "author",
    creators: [makeCreator("Lin", "Ye"), makeCreator("Xin", "Wei")],
  } satisfies Partial<ItemFixtureOptions>;

  it("shows author summary, year, Venue, volume, issue, and pages for a journal article", () => {
    expect(
      metaParts({
        key: "AAAAAAAA",
        itemType: "journalArticle",
        title: "Alpha",
        ...authored,
        publicationTitle: "Journal of Personal Records",
        volume: "12",
        issue: "3",
        pages: "1-20",
      }),
    ).toEqual({
      authorYear: "Ye and Wei (2023)",
      publication: "Journal of Personal Records",
      volume: "12",
      issue: "3",
      pages: "1-20",
    });
  });

  it("shows the author summary and year for a preprint", () => {
    expect(
      metaParts({
        key: "BBBB2222",
        itemType: "preprint",
        title: "Beta",
        ...authored,
      })?.authorYear,
    ).toBe("Ye and Wei (2023)");
  });

  it("shows a container-role Venue: a book section's book title", () => {
    expect(
      metaParts({
        key: "CCCC3333",
        itemType: "bookSection",
        title: "Gamma",
        ...authored,
        fields: { bookTitle: "Collected Personal Essays" },
      })?.publication,
    ).toBe("Collected Personal Essays");
  });

  it("shows a publisher-role Venue: a preprint's repository", () => {
    expect(
      metaParts({
        key: "DDDD4444",
        itemType: "preprint",
        title: "Delta",
        ...authored,
        fields: { repository: "arXiv" },
      })?.publication,
    ).toBe("arXiv");
  });

  it("shows volume, issue, and pages for an item type that records them", () => {
    expect(
      metaParts({
        key: "EEEE5555",
        itemType: "magazineArticle",
        title: "Epsilon",
        ...authored,
        fields: { volume: "7", issue: "2", pages: "44-49" },
      }),
    ).toMatchObject({ volume: "7", issue: "2", pages: "44-49" });
  });

  it("renders no meta line for an item with no creators, date, or Venue", () => {
    expect(
      metaParts({ key: "FFFF6666", itemType: "letter", title: "Zeta" }),
    ).toBeNull();
  });
});

function metaParts<TType extends ItemFields["itemType"]>(
  options: TypedItemFixtureOptions<TType>,
): Record<string, string> | null {
  const el = document.createElement("div");
  renderSuggestion(
    settings,
    bridge,
    { item: makeItem(options), matches: [], library: null, cited: false },
    el,
  );
  const metaEl = el.querySelector(".meta");
  if (!metaEl) return null;
  return Object.fromEntries(
    (
      [
        ["authorYear", ".author-year"],
        ["publication", ".publication"],
        ["volume", ".volume"],
        ["issue", ".issue"],
        ["pages", ".pages"],
      ] as const
    ).flatMap(([name, selector]) => {
      const text = metaEl.querySelector(selector)?.textContent;
      return text ? [[name, text]] : [];
    }),
  );
}
