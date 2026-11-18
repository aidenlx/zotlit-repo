// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Context, Effect, Stream } from "effect";
import type { SettingDefinitionItem, SettingGroupItem } from "obsidian";
import { vi } from "vitest";

import {
  ButtonComponent,
  renderRow,
} from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import { eventually } from "@zotlit/plugin-kernel/__fixtures__/eventually.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import type {
  SettingsKey,
  SettingTabContext,
} from "@zotlit/plugin-services/obsidian/setting-tab/context.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { LocalBridge } from "@zotlit/template-workbench/desktop/local-bridge/service.ts";
import type { WorkbenchConnection } from "@zotlit/template-workbench/desktop/local-bridge/service.ts";

import { defaults } from "@/services/settings/schema.ts";

import { scopedSettingTab } from "./__fixtures__.ts";
import { localServerItems } from "./local-server.ts";

interface Options {
  settings?: Partial<Settings>;
  connection?: WorkbenchConnection | null;
  disconnect?: () => void;
}

const setup = Effect.fnUntraced(function* ({
  settings = {},
  connection = null,
  disconnect = () => {},
}: Options = {}) {
  const current: Settings = { ...defaults, ...settings };
  const services = Context.make(
    PluginSettings,
    stubService<PluginSettings["Service"]>("PluginSettings", {
      current: Effect.succeed(current),
    }),
  ).pipe(
    Context.add(
      LocalServer,
      stubService<LocalServer["Service"]>("LocalServer", {
        effectivePort: Effect.succeed(null),
        effectivePortChanges: Stream.empty,
      }),
    ),
    Context.add(
      LocalBridge,
      stubService<LocalBridge["Service"]>("LocalBridge", {
        connection: Effect.succeed(connection),
        disconnect: Effect.sync(disconnect),
      }),
    ),
  );
  const ctx = stubService<SettingTabContext>("SettingTabContext", {
    tab: (yield* scopedSettingTab(services)).tab,
    webWorkbenchEnabled: true,
  });
  return localServerItems(ctx);
});

function visible(item: SettingDefinitionItem): boolean {
  return typeof item.visible === "function"
    ? item.visible()
    : (item.visible ?? true);
}

function row(items: SettingGroupItem<SettingsKey>[], name: string) {
  const item = items.find((entry) => "name" in entry && entry.name === name);
  if (!item) throw new Error(`Local server row missing: ${name}`);
  return item;
}

it.effect(
  "hides everything but the listener toggle while the server is off",
  () =>
    Effect.gen(function* () {
      const items = yield* setup({ settings: { "server.enabled": false } });

      const [listener, ...hosted] = items;
      expect(visible(listener!)).toBe(true);
      expect(hosted.map(visible)).toEqual(hosted.map(() => false));
    }),
);

const CONNECTION: WorkbenchConnection = {
  origin: "https://zotlit.aidenlx.site",
  profileId: "books",
  profileName: "Books",
  item: { key: "IANNP5A2", title: "Why research findings are false" },
};

it.effect("ends the connected workbench session", () =>
  Effect.gen(function* () {
    const disconnect = vi.fn();
    const items = yield* setup({
      settings: { "server.enabled": true },
      connection: CONNECTION,
      disconnect,
    });

    const item = row(
      items,
      m.settings_local_server_workbench_connection_name(),
    );
    const button = renderRow(item).components.find(
      (control) => control instanceof ButtonComponent,
    )!;
    expect(button.text).toBe(m.settings_local_server_workbench_disconnect());
    button.click();
    yield* eventually(() => expect(disconnect).toHaveBeenCalledTimes(1));
  }),
);
