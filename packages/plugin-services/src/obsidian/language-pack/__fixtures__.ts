import { Context, Effect, Layer } from "effect";

import { layerDeviceStorageFrom } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import type { DeviceStorageSource } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import { layerFakeFetch } from "@zotlit/plugin-kernel/__fixtures__/fake-fetch.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { catalog } from "@zotlit/plugin-messages/catalog.ts";
import { runtime } from "@zotlit/plugin-messages/runtime.ts";

import type { LanguagePackIdentity } from "./service.ts";
import {
  LanguagePack,
  layerLanguagePack,
  startLanguagePack,
} from "./service.ts";

const ZOTLIT_IDENTITY: LanguagePackIdentity = {
  catalog,
  runtime,
  namespace: "zotlit",
  repository: "aidenlx/zotlit",
};

export const CHINESE_PACK = JSON.stringify({
  schemaVersion: 1,
  locale: "zh-CN",
  messages: { hello: "世界（测试）", workbench_tab_match: "匹配（测试包）" },
});

export interface FakeDevice extends DeviceStorageSource {
  readonly storage: Map<string, unknown>;
  readonly requests: string[];
  answer: string | { status: number; text: string } | Error;
  held?: Promise<unknown>;
}

export function fakeDevice(
  answer: FakeDevice["answer"] = CHINESE_PACK,
): FakeDevice {
  const storage = new Map<string, unknown>();
  return {
    storage,
    requests: [],
    answer,
    keys: () => [...storage.keys()],
    loadLocalStorage: (key) => storage.get(key) ?? null,
    saveLocalStorage: (key, value) => {
      if (value === null) storage.delete(key);
      else storage.set(key, value);
    },
  };
}

export const startOn = Effect.fn("test.startOn")(function* (
  device: FakeDevice,
  {
    language,
    pluginVersion = "2.0.0",
    identity = ZOTLIT_IDENTITY,
    plugin = "ZotLit",
  }: {
    language: string;
    pluginVersion?: string;
    identity?: LanguagePackIdentity;
    plugin?: string;
  },
) {
  const storage = layerDeviceStorageFrom(device);
  const startup = yield* startLanguagePack(
    identity,
    pluginVersion,
    plugin,
  ).pipe(
    Effect.provide(
      Layer.merge(
        storage,
        Layer.succeed(
          ObsidianEnv,
          stubService<ObsidianEnv["Service"]>("ObsidianEnv", { language }),
        ),
      ),
    ),
  );
  const context = yield* Layer.build(
    layerLanguagePack(startup).pipe(
      Layer.provide(storage),
      Layer.provide(
        layerFakeFetch(async (input) => {
          device.requests.push(
            input instanceof Request ? input.url : String(input),
          );
          await device.held;
          const { answer } = device;
          if (answer instanceof Error) throw answer;
          return typeof answer === "string"
            ? new Response(answer)
            : new Response(answer.text, { status: answer.status });
        }),
      ),
    ),
  );
  return Context.get(context, LanguagePack);
});
