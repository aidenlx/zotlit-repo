import { expect, it } from "vitest";

import { serviceOrder } from "@zotlit/plugin-shell/obsidian/compose.ts";

import { features } from "./features.ts";

it("starts every desktop service that reads the Zotero preferences after the library source, so none of them takes the folders of the file source by default", () => {
  const order = serviceOrder(features);
  const groups = features.flatMap((feature) => feature.services);
  const source = order.indexOf("LibrarySource");
  const readers = groups
    .filter(
      (group) =>
        group.name !== "LibrarySource" &&
        group.requires.some((tag) => String(tag.key).includes("ZoteroPref")),
    )
    .map((group) => group.name);
  expect(source).toBeGreaterThanOrEqual(0);
  expect(readers.filter((name) => order.indexOf(name) < source)).toEqual([]);
});
