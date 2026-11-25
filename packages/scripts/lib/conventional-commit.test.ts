import { expect, it } from "vitest";

import { isConventionalSubject } from "./conventional-commit.ts";

it.each([
  "fix: keep the excerpt image size",
  "feat(land): report a rebase conflict",
  "refactor(db)!: drop the legacy reader",
  "chore: release obsidian 2.2.1\n\nBody text.",
  'revert: "feat(land): report a rebase conflict"',
])("accepts %j", (message) => {
  expect(isConventionalSubject(message)).toBe(true);
});

it.each([
  "Keep the excerpt image size",
  'Revert "feat(land): report a rebase conflict"',
  "feature: keep the excerpt image size",
  "Fix: keep the excerpt image size",
  "fix:keep the excerpt image size",
  "fix: ",
  "fix(): keep the excerpt image size",
  "fix(two words): keep the excerpt image size",
  "\nfix: subject on the second line",
])("refuses %j", (message) => {
  expect(isConventionalSubject(message)).toBe(false);
});
