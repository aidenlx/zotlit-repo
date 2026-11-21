// The button of a settings row that shows a Managed Binary, for the tests of
// those rows: this package's and its consumers'.
import { ButtonComponent } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import type { Setting } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";

export function button(setting: Setting): ButtonComponent {
  const found = setting.components.find(
    (control) => control instanceof ButtonComponent,
  );
  if (!(found instanceof ButtonComponent)) throw new Error("No button");
  // The mock's shared stub element has no focus to drop.
  found.buttonEl = document.createElement("button");
  return found;
}
