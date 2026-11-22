import { expect, it } from "vitest";

import { isItemKey } from "@zotlit/zotero-types/keys";

import { createStressItems } from "./spec.ts";

it("gives 100,000 Stress Items valid, unique, stable keys in non-ascending order", () => {
  const count = 100_000;
  const keys = createStressItems(count).map(({ key }) => key);

  expect(keys).toHaveLength(count);
  expect(keys.every(isItemKey)).toBe(true);
  expect(new Set(keys).size).toBe(count);
  expect(createStressItems(count).map(({ key }) => key)).toEqual(keys);
  expect(
    keys.every((key, index) => index === 0 || keys[index - 1]! < key),
  ).toBe(false);
});
