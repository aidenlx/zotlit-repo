import { ButtonComponent } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import type { Setting } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";

export function button(setting: Setting): ButtonComponent {
  const found = setting.components.find(
    (control) => control instanceof ButtonComponent,
  );
  if (!(found instanceof ButtonComponent)) throw new Error("No button");
  found.buttonEl = document.createElement("button");
  return found;
}
