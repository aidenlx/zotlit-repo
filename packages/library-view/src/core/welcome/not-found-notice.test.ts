import { expect, it } from "vitest";

import { notFoundNoticeChange } from "./not-found-notice.ts";

it.each([
  ["db-file-missing", { shown: false, libraryOpen: false }, "show"],
  ["db-file-missing", { shown: true, libraryOpen: false }, null],
  ["db-file-missing", { shown: false, libraryOpen: true }, null],
  ["changed", { shown: true, libraryOpen: false }, "hide"],
  ["changed", { shown: false, libraryOpen: false }, null],
  ["layout-change", { shown: true, libraryOpen: true }, "hide"],
  ["layout-change", { shown: true, libraryOpen: false }, null],
  ["layout-change", { shown: false, libraryOpen: true }, null],
] as const)("on %s with %o the notice does %s", (signal, now, change) => {
  expect(notFoundNoticeChange(signal, now)).toBe(change);
});
