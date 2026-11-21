import type { SettingTabContext } from "#obsidian/setting-tab/context.ts";
// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { afterEach, describe, vi } from "vitest";

import { testPluginHost } from "@zotlit/obsidian-kit/__fixtures__/plugin-host.ts";
import { renderRow } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { eventually } from "@zotlit/plugin-kernel/__fixtures__/eventually.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { PACK_COMPAT } from "@zotlit/resource-pack/format.ts";

import { layerPackDevice } from "./__fixtures__.ts";
import { packDevice, packFile } from "./test-utils.ts";

import { button } from "#__fixtures__/managed-binary-rows.ts";
import { scopedSettingTab } from "#__fixtures__/setting-tab.ts";
import { layerChineseSegmenter } from "#obsidian/chinese-segmenter/service.ts";
import { chineseSegmenterDefinition } from "#obsidian/chinese-segmenter/settings-row.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

/** The smallest module that compiles: the magic number and the version. */
const EMPTY_MODULE = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);

/** The Chinese Segmenter row, shown on a device with the file `pack` installed as the pack, or on the device `pack`. */
const segmenterRow = Effect.fnUntraced(function* (
  pack: Uint8Array | ReturnType<typeof packDevice> | null,
) {
  const services = yield* Layer.build(
    Layer.merge(
      layerChineseSegmenter.pipe(
        Layer.provide(
          layerPackDevice(
            pack === null || pack instanceof Uint8Array
              ? packDevice(pack, "1.2.0")
              : pack,
          ),
        ),
      ),
      // The plugin that reads the pack: the row opens its page by this id.
      testPluginHost({ manifest: { id: "zotlit" } }).layer,
    ),
  );
  const { tab } = yield* scopedSettingTab(services);
  const row = chineseSegmenterDefinition(
    stubService<SettingTabContext>("SettingTabContext", { tab }),
  );
  const setting = renderRow(row);
  yield* Effect.addFinalizer(() => Effect.sync(() => setting.cleanup?.()));
  const status = () =>
    (setting.desc as unknown as DocumentFragment).querySelector("[role=status]")
      ?.textContent;
  return { row, setting, status };
});

describe("the Chinese Segmenter row", () => {
  it.effect("names the binary and its pack before the pack is read", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { row } = yield* segmenterRow(null);

        expect(row).toMatchObject({
          id: "settings_chinese_segmenter",
          name: m.settings_chinese_segmenter_name(),
          desc: m.settings_chinese_segmenter_desc(),
        });
      }),
    ),
  );

  it.effect("asks to install the pack and opens its page", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { setting, status } = yield* segmenterRow(null);

        yield* eventually(() =>
          expect(status()).toBe(
            `${m.settings_resource_pack_status_absent()} ${m.settings_chinese_segmenter_fallback()}`,
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

  it.effect("shows the pack's version once the binary is ready", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const file = yield* Effect.promise(() =>
          packFile({ "chinese-segmenter": EMPTY_MODULE }),
        );
        const { status } = yield* segmenterRow(file);

        yield* eventually(() =>
          expect(status()).toBe(
            m.settings_resource_pack_status_ready({ version: "1.2.0" }),
          ),
        );
      }),
    ),
  );

  for (const [name, compat, sentence, page] of [
    [
      "an old pack",
      PACK_COMPAT - 1,
      m.settings_resource_pack_status_pack_outdated,
      "obsidian://show-plugin?id=zotlit-resources",
    ],
    [
      "a pack newer than ZotLit reads",
      PACK_COMPAT + 1,
      m.settings_resource_pack_status_plugin_outdated,
      "obsidian://show-plugin?id=zotlit",
    ],
  ] as const) {
    it.effect(`names the plugin to update for ${name} and opens its page`, () =>
      Effect.scoped(
        Effect.gen(function* () {
          const file = yield* Effect.promise(() =>
            packFile({ "chinese-segmenter": EMPTY_MODULE }, compat),
          );
          const { setting, status } = yield* segmenterRow(file);

          yield* eventually(() =>
            expect(status()).toBe(
              `${sentence()} ${m.settings_chinese_segmenter_fallback()}`,
            ),
          );
          const open = vi.spyOn(window, "open").mockReturnValue(null);
          button(setting).click();
          expect(open.mock.calls).toEqual([[page]]);
        }),
      ),
    );
  }

  it.effect(
    "follows a pack that Obsidian installs while the row is shown",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const device = packDevice(null, "1.2.0");
          const { status } = yield* segmenterRow(device);
          yield* eventually(() =>
            expect(status()).toContain(
              m.settings_resource_pack_status_absent(),
            ),
          );

          device.install(
            yield* Effect.promise(() =>
              packFile({ "chinese-segmenter": EMPTY_MODULE }),
            ),
          );
          device.announce();

          yield* eventually(() =>
            expect(status()).toBe(
              m.settings_resource_pack_status_ready({ version: "1.2.0" }),
            ),
          );
        }),
      ),
  );

  it.effect("asks to reinstall a pack that is no pack file", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { status } = yield* segmenterRow(
          new TextEncoder().encode("module.exports = {};\n"),
        );

        yield* eventually(() =>
          expect(status()).toBe(
            `${m.settings_resource_pack_status_damaged()} ${m.settings_chinese_segmenter_fallback()}`,
          ),
        );
      }),
    ),
  );

  it.effect("names why a verified binary did not start", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const notWasm = new Uint8Array(new TextEncoder().encode("not wasm"));
        // The detail is what the host's compiler says of these bytes.
        const detail = yield* Effect.promise(() =>
          WebAssembly.compile(notWasm).then(
            () => "compiled",
            (error: Error) => error.message,
          ),
        );
        const file = yield* Effect.promise(() =>
          packFile({ "chinese-segmenter": notWasm }),
        );
        const { status } = yield* segmenterRow(file);

        yield* eventually(() =>
          expect(status()).toBe(
            `${m.settings_resource_pack_status_failed({ detail })} ${m.settings_chinese_segmenter_fallback()}`,
          ),
        );
      }),
    ),
  );
});
