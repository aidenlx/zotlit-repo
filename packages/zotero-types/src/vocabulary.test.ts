import { describe, expect, it } from "vitest";

import schema from "@zotlit/zotero-types/schema.json" with { type: "json" };

import { dateFieldsOf } from "./date-fields.ts";
import { ZOTERO_VOCABULARY } from "./vocabulary.ts";

describe("the vocabulary module", () => {
  it("holds the item types, fields and creator types of the vendored schema", () => {
    expect(ZOTERO_VOCABULARY.version).toBe(schema.version);
    expect(
      ZOTERO_VOCABULARY.itemTypes.map(({ itemType, fields, creatorTypes }) => [
        itemType,
        fields.map((field) => [field.field, field.baseField ?? null]),
        creatorTypes.map((type) => [type.creatorType, type.primary ?? false]),
      ]),
    ).toEqual(
      schema.itemTypes.map(({ itemType, fields, creatorTypes }) => [
        itemType,
        fields.map((field) => [
          field.field,
          ("baseField" in field && field.baseField) || null,
        ]),
        creatorTypes.map((type) => [
          type.creatorType,
          ("primary" in type && type.primary) || false,
        ]),
      ]),
    );
    expect(ZOTERO_VOCABULARY.dateFields).toEqual(dateFieldsOf(schema));
  });
});
