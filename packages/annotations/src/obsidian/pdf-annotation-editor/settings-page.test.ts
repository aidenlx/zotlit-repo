// @vitest-environment happy-dom
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Events } from "obsidian";
import type { App, PluginManifest } from "obsidian";
import { afterEach, vi } from "vitest";

import { renderRow } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import type { ButtonComponent } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { SettingTabContext } from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import type { ReaderApi } from "@zotlit/reader-api";
import { answerConnect, READER_API } from "@zotlit/reader-api";

import { readerPageItems, readerStatusRow } from "./settings-page.ts";

import { scopedSettingTab } from "#__fixtures__/setting-tab.ts";
import { defaults } from "#__fixtures__/settings.ts";
import { readerHandshake } from "#obsidian/reader-connection/handshake.ts";
import { layerReaderConnection } from "#obsidian/reader-connection/service.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reader settings", () => {
  it("opens annotation links in the ZotLit reader by default", () => {
    expect(defaults["reader.open-annotation-links"]).toBe(true);
  });

  it("offers the annotation link opening choice on the Reader page", () => {
    expect(
      readerPageItems(stubService<SettingTabContext>("SettingTabContext", {})),
    ).toContainEqual({
      id: "settings_reader_open_annotation_links",
      name: m.settings_reader_open_annotation_links_name(),
      desc: m.settings_reader_open_annotation_links_desc(),
      control: {
        type: "toggle",
        key: "reader.open-annotation-links",
      },
    });
  });
});

function readerApi(major: number): ReaderApi {
  return stubService<ReaderApi>("ReaderApi", {
    api: { major, minor: READER_API.minor },
    readerVersion: "2.0.0",
    addExtension: () => () => {},
    onClose: () => () => {},
  });
}

const statusRow = Effect.fnUntraced(function* (options: {
  readonly installed: boolean;
  readonly answer?: (events: Events) => void;
}) {
  const events = new Events();
  options.answer?.(events);
  const manifests: Record<string, PluginManifest> = options.installed
    ? { "zotlit-reader": stubService<PluginManifest>("PluginManifest", {}) }
    : {};
  const services = yield* Layer.build(
    Layer.merge(
      layerReaderConnection(readerHandshake({ workspace: events }, "zotlit")),
      Layer.succeed(
        ObsidianApp,
        stubService<App>("App", { plugins: { plugins: {}, manifests } }),
      ),
    ),
  );
  const { tab } = yield* scopedSettingTab(services);
  const setting = renderRow(
    readerStatusRow(
      stubService<SettingTabContext>("SettingTabContext", { tab }),
    ),
  );
  yield* Effect.addFinalizer(() => Effect.sync(() => setting.cleanup?.()));
  yield* Effect.yieldNow;
  const button = setting.components[0] as ButtonComponent;
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  button.click();
  return {
    text: (setting.desc as unknown as DocumentFragment).textContent,
    label: button.text,
    opened: open.mock.calls.map(([url]) => url),
  };
});

const answering =
  (major: number) =>
  (events: Events): void => {
    answerConnect(events, new Map([[major, readerApi(major)]]));
  };

it.effect(
  "asks to install ZotLit Reader when Obsidian lists no such plugin",
  () =>
    Effect.gen(function* () {
      expect(yield* statusRow({ installed: false })).toEqual({
        text: `${m.settings_reader_status_install()} ${m.settings_reader_status_fallback()}`,
        label: m.settings_reader_status_install_action(),
        opened: ["obsidian://show-plugin?id=zotlit-reader"],
      });
    }),
);

it.effect("asks to turn on ZotLit Reader when it is installed but off", () =>
  Effect.gen(function* () {
    expect(yield* statusRow({ installed: true })).toMatchObject({
      text: `${m.settings_reader_status_turn_on()} ${m.settings_reader_status_fallback()}`,
      label: m.settings_reader_status_turn_on_action(),
      opened: ["obsidian://show-plugin?id=zotlit-reader"],
    });
  }),
);

it.effect(
  "asks to update ZotLit Reader when the running Reader refuses ZotLit's contract",
  () =>
    Effect.gen(function* () {
      expect(
        yield* statusRow({
          installed: true,
          answer: answering(READER_API.major - 1),
        }),
      ).toMatchObject({
        text: `${m.settings_reader_status_update({ plugin: "ZotLit Reader" })} ${m.settings_reader_status_fallback()}`,
        label: m.settings_reader_status_update_action(),
        opened: ["obsidian://show-plugin?id=zotlit-reader"],
      });
    }),
);

it.effect(
  "asks to update ZotLit when the running Reader offers only a newer contract",
  () =>
    Effect.gen(function* () {
      expect(
        yield* statusRow({
          installed: true,
          answer: answering(READER_API.major + 1),
        }),
      ).toMatchObject({
        text: `${m.settings_reader_status_update({ plugin: "ZotLit" })} ${m.settings_reader_status_fallback()}`,
        label: m.settings_reader_status_update_action(),
        opened: ["obsidian://show-plugin?id=zotlit"],
      });
    }),
);

it.effect("says it is connected, with no action, once the Reader accepts", () =>
  Effect.gen(function* () {
    expect(
      yield* statusRow({
        installed: true,
        answer: answering(READER_API.major),
      }),
    ).toMatchObject({
      text: m.settings_reader_status_connected(),
      opened: [],
    });
  }),
);
