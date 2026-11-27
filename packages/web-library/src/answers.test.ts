import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import publicGroup from "@zotlit/db/replica/web-api-public-group.json" with { type: "json" };

import {
  DeletionList,
  GroupRecord,
  ObjectList,
  VersionMap,
} from "./answers.ts";

describe("the guards of Web API answers", () => {
  it("accept the real records of the public test group", () => {
    expect(Schema.is(ObjectList)(publicGroup.items)).toBe(true);
    expect(Schema.is(ObjectList)(publicGroup.collections)).toBe(true);
    expect(Schema.is(GroupRecord)(publicGroup.group)).toBe(true);
  });

  it("accept the real empty answers of the public test group", () => {
    expect(Schema.is(VersionMap)({})).toBe(true);
    expect(
      Schema.is(DeletionList)({
        collections: [],
        items: [],
        searches: [],
        tags: [],
        settings: [],
      }),
    ).toBe(true);
  });

  it("refuse an object without its version and a map with a version that is not a number", () => {
    const [item] = publicGroup.items;
    expect(Schema.is(ObjectList)([{ ...item, version: undefined }])).toBe(
      false,
    );
    expect(Schema.is(VersionMap)({ KC6WFG78: "12" })).toBe(false);
  });

  it("refuse an object with an empty key", () => {
    const [item] = publicGroup.items;
    expect(Schema.is(ObjectList)([{ ...item, key: "" }])).toBe(false);
    expect(
      Schema.is(ObjectList)([{ ...item, data: { ...item!.data, key: "" } }]),
    ).toBe(false);
  });
});
