import type { RenderedProperty } from "#core/render/result.ts";
import { expect, it } from "vitest";

import { propertyType } from "./property-list.tsx";

const property = (key: string, value: unknown): RenderedProperty => ({
  key,
  value,
  missing: false,
  position: 1,
});

it("infers the type Obsidian's editor would assign each property", () => {
  expect(propertyType(property("title", "A study"))).toBe("text");
  expect(propertyType(property("authors", ["Ada", "Grace"]))).toBe("list");
  expect(propertyType(property("tags", ["reading"]))).toBe("tags");
  expect(propertyType(property("aliases", "study"))).toBe("aliases");
  expect(propertyType(property("year", 2021))).toBe("number");
  expect(propertyType(property("read", false))).toBe("checkbox");
  expect(propertyType(property("added", "2021-03-09"))).toBe("date");
  expect(propertyType(property("modified", "2021-03-09T08:30"))).toBe(
    "datetime",
  );
  expect(propertyType(property("note", "2021-03-09 draft"))).toBe("text");
  expect(propertyType({ key: "doi", missing: true, position: 2 })).toBe("text");
});
