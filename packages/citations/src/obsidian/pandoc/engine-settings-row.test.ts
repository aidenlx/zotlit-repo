// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { afterEach, describe, vi } from "vitest";

import { renderRow } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { eventually } from "@zotlit/plugin-kernel/__fixtures__/eventually.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { button } from "@zotlit/plugin-services/__fixtures__/managed-binary-rows.ts";
import { layerPackDevice } from "@zotlit/plugin-services/obsidian/managed-binary/__fixtures__.ts";
import {
  packDevice,
  packFile,
} from "@zotlit/plugin-services/obsidian/managed-binary/test-utils.ts";
import type { SettingTabContext } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";

import { pandocEngineDefinition } from "./engine-settings-row.ts";
import { layerPandocEngine } from "./service.ts";

import { scopedSettingTab } from "#__fixtures__/setting-tab.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

/** The Pandoc engine row, shown on a device with `file` installed as the pack. */
const engineRow = Effect.fnUntraced(function* (file: Uint8Array | null) {
  const services = yield* Layer.build(
    layerPandocEngine.pipe(
      Layer.provide(layerPackDevice(packDevice(file, "1.2.0"))),
    ),
  );
  const { tab } = yield* scopedSettingTab(services);
  const row = pandocEngineDefinition(
    stubService<SettingTabContext>("SettingTabContext", { tab }),
  );
  const setting = renderRow(row);
  yield* Effect.addFinalizer(() => Effect.sync(() => setting.cleanup?.()));
  const desc = setting.desc as unknown as DocumentFragment;
  return {
    row,
    setting,
    desc,
    status: () => desc.querySelector("[role=status]")?.textContent,
  };
});

describe("the Pandoc engine row", () => {
  it.effect(
    "asks to install the pack, opens its page, and states Pandoc's licence with its source",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { row, setting, desc, status } = yield* engineRow(null);

          expect(row).toMatchObject({
            id: "settings_citation_engine",
            name: m.settings_citation_engine_name(),
            desc: m.settings_citation_engine_desc(),
          });
          expect(desc.textContent).toContain(
            m.settings_citation_engine_licence(),
          );
          const source = desc.querySelector("a");
          expect(source?.textContent).toBe(m.settings_citation_engine_source());
          expect(source?.getAttribute("href")).toBe(
            "https://github.com/jgm/pandoc",
          );
          yield* eventually(() =>
            expect(status()).toBe(
              `${m.settings_resource_pack_status_absent()} ${m.settings_citation_engine_fallback()}`,
            ),
          );
          const open = vi.spyOn(window, "open").mockReturnValue(null);
          const action = button(setting);
          expect(action.text).toBe(m.settings_resource_pack_open());
          action.click();
          expect(open.mock.calls).toEqual([
            ["obsidian://show-plugin?id=zotlit-resources"],
          ]);
        }),
      ),
  );

  it.effect("shows the pack's version once the pack holds the engine", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const file = yield* Effect.promise(() =>
          packFile({
            "pandoc-engine": new Uint8Array(
              new TextEncoder().encode("pandoc wasm bytes"),
            ),
          }),
        );
        const { status } = yield* engineRow(file);

        yield* eventually(() =>
          expect(status()).toBe(
            m.settings_resource_pack_status_ready({ version: "1.2.0" }),
          ),
        );
      }),
    ),
  );
});
