import type { CitationTemplateStatus } from "#obsidian/template/service.ts";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import type { App } from "obsidian";
import { expect } from "vitest";

// @vitest-environment happy-dom
import {
  ButtonComponent,
  renderRow,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import type { Setting } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { SettingTabContext } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";

import { citationTextItems } from "./settings-rows.ts";

import { rebuildingSettingTab } from "#__fixtures__/setting-tab.ts";
import { Template } from "#obsidian/template/service.ts";

/**
 * The tab context over `template` and `vault`, with a settings window that
 * closes through `close`. `rebuilt` takes one element per definition rebuild
 * an action asks for.
 */
const tabOver = Effect.fnUntraced(function* (
  template: Partial<Template["Service"]>,
  options: {
    vault?: Partial<Vault["Service"]>;
    close?: () => void;
  } = {},
) {
  const { tab, rebuilt } = yield* rebuildingSettingTab(
    Layer.merge(
      Layer.mock(Template, template),
      Layer.mock(Vault, options.vault ?? {}),
    ),
    options,
  );
  const app = stubService<App>("App", {});
  const ctx = stubService<SettingTabContext>("SettingTabContext", { tab, app });
  return { ctx, rebuilt };
});

const DEFAULT_STATUS: CitationTemplateStatus = {
  path: "Templates/zotlit-citation.md",
  customized: false,
  language: "liquid",
  inertPath: null,
  compileError: null,
};

/** The Citation text row as it renders for one Citation Template state. */
const citationRow = Effect.fnUntraced(function* (
  status: CitationTemplateStatus,
) {
  const { ctx } = yield* tabOver({
    loaded: Effect.succeed(true),
    getCitationTemplateStatus: Effect.succeed(status),
  });
  const [row] = citationTextItems(ctx);
  if (!row) throw new Error("Expected one Citation text render row");
  return renderRow(row);
});

/** The row's description, as `setDesc` received it. */
function description(setting: Setting): DocumentFragment {
  return setting.desc as unknown as DocumentFragment;
}

function tooltips(setting: Setting): string[] {
  return setting.components
    .filter((control) => control instanceof ButtonComponent)
    .map((button) => button.tooltip);
}

it.effect(
  "reads as the built-in default and offers Open alone until a document exists",
  () =>
    Effect.gen(function* () {
      const setting = yield* citationRow(DEFAULT_STATUS);

      expect(description(setting).textContent).toContain(
        m.settings_template_using_default(),
      );
      expect(description(setting).textContent).not.toContain(
        DEFAULT_STATUS.path,
      );
      expect(tooltips(setting)).toEqual([m.settings_citation_text_open()]);
    }),
);

it.effect("names the document and adds Reset once the vault holds one", () =>
  Effect.gen(function* () {
    const setting = yield* citationRow({ ...DEFAULT_STATUS, customized: true });

    expect(description(setting).querySelector("code")?.textContent).toBe(
      DEFAULT_STATUS.path,
    );
    expect(description(setting).textContent).not.toContain(
      m.settings_template_using_default(),
    );
    expect(tooltips(setting)).toEqual([
      m.settings_citation_text_open(),
      m.settings_template_reset(),
    ]);
  }),
);

it.effect(
  "warns on the row when the document is inert or fails to compile",
  () =>
    Effect.gen(function* () {
      const inert = yield* citationRow({
        ...DEFAULT_STATUS,
        customized: true,
        language: "eta",
        inertPath: DEFAULT_STATUS.path,
      });
      expect(description(inert).textContent).toContain(
        m.settings_template_inert_eta({ path: DEFAULT_STATUS.path }),
      );

      const broken = yield* citationRow({
        ...DEFAULT_STATUS,
        customized: true,
        compileError: "Unexpected token",
      });
      expect(description(broken).textContent).toContain("Unexpected token");
    }),
);
