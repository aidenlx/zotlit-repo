// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  fakeDevice,
  startOn,
} from "@zotlit/plugin-services/obsidian/language-pack/__fixtures__.ts";

import { host } from "./host.ts";

it.effect(
  "downloads ZotLit's Language Packs from its Resource Release and keeps the cache keys of existing installs",
  () =>
    Effect.gen(function* () {
      const device = fakeDevice();
      const pack = yield* startOn(device, {
        language: "zh",
        pluginVersion: "2.3.0",
        identity: host.languagePack,
      });

      yield* pack.install;

      expect(device.requests).toEqual([
        "https://github.com/aidenlx/zotlit/releases/download/res-2.3.0/zh-CN.json",
      ]);
      expect([...device.storage.keys()].sort()).toEqual([
        "zotlit:i18n:consent:zh-CN",
        "zotlit:i18n:pack:2.3.0:zh-CN",
      ]);
    }),
);
