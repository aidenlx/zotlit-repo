import { afterEach, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as { Localization?: unknown }).Localization = class {};
});

import { preferredPaneType } from "./pane-type.ts";

function storePref(value: unknown): void {
  Object.assign(globalThis, {
    Zotero: { Prefs: { get: () => value } },
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "Zotero");
});

it.each(["tab", "split", "window"] as const)(
  "names the %s pane the link should carry",
  (paneType) => {
    storePref(paneType);
    expect(preferredPaneType()).toBe(paneType);
  },
);

it.each([
  ["the active-tab choice", "active"],
  ["an unset pref", undefined],
  ["a hand-edited value Obsidian has no pane for", "popout"],
  ["a non-string value", 3],
])("leaves the pane unnamed for %s", (_label, stored) => {
  storePref(stored);
  expect(preferredPaneType()).toBeUndefined();
});
