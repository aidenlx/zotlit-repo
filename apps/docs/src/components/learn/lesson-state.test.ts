import { expect, it } from "vitest";

import { openOnLoad } from "./lesson-state.ts";

it.each([
  { url: "a step hash", hash: "#1", ticks: [1], open: 1 },
  { url: "the bare URL after a tick", hash: "", ticks: [1], open: 2 },
  { url: "the bare URL before any tick", hash: "", ticks: [], open: null },
  {
    url: "the bare URL with every step ticked",
    hash: "",
    ticks: [1, 2, 3],
    open: null,
  },
  { url: "the end hash", hash: "#done", ticks: [1], open: null },
])("opens the resume row for $url", ({ hash, ticks, open }) => {
  expect(openOnLoad(hash, ticks, 3)).toBe(open);
});
