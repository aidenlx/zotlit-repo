import type { SettingTabContext } from "#obsidian/setting-tab/context.ts";
// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Stream } from "effect";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { afterEach, describe, vi } from "vitest";

import { testPluginHost } from "@zotlit/obsidian-kit/__fixtures__/plugin-host.ts";
import { renderRow } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { eventually } from "@zotlit/plugin-kernel/__fixtures__/eventually.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { PACK_COMPAT } from "@zotlit/resource-pack/format.ts";

import { packDevice, packFile } from "./test-utils.ts";

import { button } from "#__fixtures__/managed-binary-rows.ts";
import { scopedSettingTab } from "#__fixtures__/setting-tab.ts";
import { layerDeviceSegmenter } from "#obsidian/chinese-segmenter/__fixtures__.ts";
import { ChineseSegmenter } from "#obsidian/chinese-segmenter/service.ts";
import { chineseSegmenterDefinition } from "#obsidian/chinese-segmenter/settings-row.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

/** The web-target binary the Resource Pack holds, read from the `jieba-wasm` dev dependency. */
const JIEBA = new Uint8Array(
  await readFile(
    join(
      dirname(createRequire(import.meta.url).resolve("jieba-wasm/web")),
      "jieba_rs_wasm_bg.wasm",
    ),
  ),
);

/** The Chinese Segmenter row, shown on a device with the file `pack` installed as the pack, or on the device `pack`. */
const segmenterRow = Effect.fnUntraced(function* (
  pack: Uint8Array | ReturnType<typeof packDevice> | null,
) {
  const services = yield* Layer.build(
    Layer.merge(
      layerDeviceSegmenter(
        pack === null || pack instanceof Uint8Array
          ? packDevice(pack, "1.2.0")
          : pack,
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
  const segmenter = Context.get(services, ChineseSegmenter);
  /** Waits for the worker to start the binary, which takes more than a turn. */
  const ready = Stream.runHead(
    Stream.filter(segmenter.changes, ({ kind }) => kind === "ready"),
  );
  return { row, setting, status, ready };
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

  it.effect(
    "says that it checks the pack until the worker states the status",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const file = yield* Effect.promise(() =>
            packFile({ "chinese-segmenter": JIEBA }),
          );
          const { status, ready } = yield* segmenterRow(file);

          expect(status()).toBe(m.settings_resource_pack_status_checking());
          yield* ready;
          yield* eventually(() =>
            expect(status()).toBe(
              m.settings_resource_pack_status_ready({ version: "1.2.0" }),
            ),
          );
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
            packFile({ "chinese-segmenter": JIEBA }, compat),
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
          const { status, ready } = yield* segmenterRow(device);
          yield* eventually(() =>
            expect(status()).toContain(
              m.settings_resource_pack_status_absent(),
            ),
          );

          device.install(
            yield* Effect.promise(() =>
              packFile({ "chinese-segmenter": JIEBA }),
            ),
          );
          device.announce();

          yield* ready;
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
