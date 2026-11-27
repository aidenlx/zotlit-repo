import { describe, expect, it } from "vitest";

import schema from "@zotlit/zotero-types/schema.json" with { type: "json" };

import { dateFieldsOf } from "./date-fields.ts";
import { ZOTERO_DATE_FIELDS } from "./fields.ts";

describe("the date fields", () => {
  it("take a field's own type, else the type of its base field, as Zotero.ItemFields.isDate does", () => {
    expect(
      dateFieldsOf({
        meta: {
          fields: {
            date: { type: "date" },
            textOfDate: { type: "text" },
          },
        },
        itemTypes: [
          {
            fields: [
              { field: "date" },
              { field: "decided", baseField: "date" },
              { field: "textOfDate", baseField: "date" },
              { field: "title" },
              { field: "number", baseField: "title" },
            ],
          },
        ],
      }),
    ).toEqual(["date", "decided"]);
  });

  it("are the date fields of the vendored schema", () => {
    expect(ZOTERO_DATE_FIELDS).toEqual(dateFieldsOf(schema));
    expect(ZOTERO_DATE_FIELDS).toEqual([
      "date",
      "filingDate",
      "dateDecided",
      "issueDate",
      "dateEnacted",
    ]);
  });
});
