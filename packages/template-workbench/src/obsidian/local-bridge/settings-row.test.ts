// @vitest-environment happy-dom
import { expect, it } from "vitest";

import {
  DropdownComponent,
  renderRow,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { SettingTabContext } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";

import { workbenchPreferenceItems } from "./settings-row.ts";

function items() {
  const ctx = stubService<SettingTabContext>("SettingTabContext", {
    webWorkbenchEnabled: true,
    app: stubService<SettingTabContext["app"]>("App", {
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
    }),
  });
  return workbenchPreferenceItems(ctx);
}

it("offers each editor choice in web-enabled builds", () => {
  const preferenceName = m.template_workbench_preference_name();

  const row = items().find(
    (item) => "name" in item && item.name === preferenceName,
  )!;
  const dropdown = renderRow(row).components.find(
    (control) => control instanceof DropdownComponent,
  ) as DropdownComponent;
  expect(dropdown.options).toEqual([
    { value: "ask", label: m.template_workbench_preference_ask() },
    { value: "web", label: m.template_workbench_preference_web() },
    { value: "native", label: m.template_workbench_name() },
  ]);
});
