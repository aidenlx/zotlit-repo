import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect, vi } from "vitest";

import {
  citekeysToCiteTemplateData,
  itemBaseFields,
  resolveVenue,
} from "@zotlit/db";
import type { CiteRef, Item } from "@zotlit/db";
import { rowInstant } from "@zotlit/db-testing";
import { inlineCitation } from "@zotlit/templates";
import { TemplateFacade } from "@zotlit/templates/facade";
import type { ItemFields } from "@zotlit/zotero-types";

import { renderCitation } from "./citation.ts";

import { CITATION_TEMPLATE_SOURCE } from "#core/template/defaults.ts";
import { Profile } from "#obsidian/profile/service.ts";
import { Template } from "#obsidian/template/service.ts";

function citationLayer(
  render: (refs: readonly CiteRef[], variant: "main" | "alt") => string,
  loaded: { template?: boolean; profile?: boolean } = {},
) {
  return Layer.mergeAll(
    Layer.mock(Template, {
      loaded: Effect.succeed(loaded.template ?? true),
      renderCitation: (refs, variant) =>
        Effect.sync(() => render(refs, variant)),
    }),
    Layer.mock(Profile, { loaded: Effect.succeed(loaded.profile ?? true) }),
  );
}

function citationTemplate(source = CITATION_TEMPLATE_SOURCE) {
  const facade = new TemplateFacade();
  facade.define("citation", source, "liquid");
  return (refs: readonly CiteRef[], variant: "main" | "alt") =>
    inlineCitation(
      facade.render("citation", citekeysToCiteTemplateData(refs, variant)),
    );
}

describe("renderCitation", () => {
  it.effect.each([
    ["the template is", { template: false }],
    ["the Profiles are", { profile: false }],
  ] as const)("answers null while %s not loaded", ([, loaded]) =>
    Effect.gen(function* () {
      const render = vi.fn(() => "");
      const result = yield* renderCitation(
        [{ citationKey: "root2024" }],
        "main",
      ).pipe(Effect.provide(citationLayer(render, loaded)));
      expect(result).toBeNull();
      expect(render).not.toHaveBeenCalled();
    }),
  );

  it.effect("renders the alternate variant from the same document", () =>
    Effect.gen(function* () {
      const result = yield* renderCitation(
        [{ citationKey: "smith2024" }],
        "alt",
      ).pipe(Effect.provide(citationLayer(citationTemplate())));
      expect(result).toBe("@smith2024");
    }),
  );

  it.effect("hands the variant to a document that branches on zt.variant", () =>
    Effect.gen(function* () {
      const layer = citationLayer(
        citationTemplate(
          "{% if zt.variant == 'alt' %}~{{ zt.citations[0].item.citationKey }}~" +
            "{% else %}<{{ zt.citations[0].item.citationKey }}>{% endif %}",
        ),
      );
      const render = (variant: "main" | "alt") =>
        renderCitation([{ citationKey: "smith2024" }], variant).pipe(
          Effect.provide(layer),
        );
      expect(yield* render("main")).toBe("<smith2024>");
      expect(yield* render("alt")).toBe("~smith2024~");
    }),
  );

  it.effect(
    "carries the selected item's full narrowed data through to the Citation Template (9.2-CSL #03)",
    () =>
      Effect.gen(function* () {
        const result = yield* renderCitation(
          [{ citationKey: "root2024", item: statedChoiceMethods() }],
          "main",
        ).pipe(
          Effect.provide(
            citationLayer((refs) =>
              citekeysToCiteTemplateData(refs, "main")
                .citations.map((c) => c.item.title)
                .join("; "),
            ),
          ),
        );
        expect(result).toBe("Stated choice methods");
      }),
  );
});

function statedChoiceMethods(): Item {
  const fields = {
    itemType: "journalArticle",
    title: "Stated choice methods",
    citationKey: "root2024",
  } as ItemFields;
  const baseFields = itemBaseFields(fields);
  return {
    itemID: 1,
    libraryID: 1,
    key: "RTKEY234",
    indexedKey: "RTKEY234",
    dateAdded: rowInstant("2024-01-15T10:00:00Z"),
    dateModified: rowInstant("2024-01-15T10:00:00Z"),
    creators: [],
    primaryCreatorType: "author",
    customFields: new Map(),
    groupID: null,
    fields,
    baseFields,
    venue: resolveVenue(baseFields),
  };
}
