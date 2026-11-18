// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Context } from "effect";
import { describe } from "vitest";

import { renderRow } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import {
  binary,
  button,
} from "@zotlit/plugin-services/__fixtures__/managed-binary-rows.ts";
import type { SettingTabContext } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";

import { pandocEngineDefinition } from "./engine-settings-row.ts";
import { PandocEngine } from "./service.ts";

import { testSettingTab } from "#__fixtures__/setting-tab.ts";

describe("pandocEngineDefinition", () => {
  it("renders the Pandoc engine row from its own messages", () => {
    const ctx = stubService<SettingTabContext>("SettingTabContext", {
      tab: testSettingTab(
        Context.make(
          PandocEngine,
          stubService<PandocEngine["Service"]>(
            "PandocEngine",
            binary({
              kind: "installed",
              version: "3.10",
              binary: { directory: "pandoc-engine", name: "pandoc.wasm" },
            }).members,
          ),
        ),
      ).tab,
    });
    const row = pandocEngineDefinition(ctx);

    expect(row).toMatchObject({
      id: "settings_citation_engine",
      name: m.settings_citation_engine_name(),
      desc: `${m.settings_citation_engine_desc()} ${m.settings_citation_engine_status_installed({ version: "3.10" })}`,
    });
    expect(button(renderRow(row)).text).toBe(
      m.settings_citation_engine_uninstall(),
    );
  });
});
