// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option } from "effect";
import type { App } from "obsidian";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { layerTestObsidianEnv } from "@zotlit/obsidian-kit/__fixtures__/obsidian-env.ts";
import { layerHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import { testPluginHost } from "@zotlit/obsidian-kit/__fixtures__/plugin-host.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { layerVaultFileSystem } from "@zotlit/obsidian-kit/vault-file-system.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { ZoteroHttp } from "@zotlit/plugin-kernel/zotero-http.ts";
import { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { LanguagePack } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import { layerPluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import { featureServices, settingsDefinitionOf } from "./compose.ts";
import type { ShellProvides } from "./compose.ts";
import { defineFeature, serviceGroup } from "./feature.ts";
import type { OpenPorts } from "./feature.ts";
import { makeGraphBuilt } from "./graph-built.ts";
import { platformBase } from "./platform-base.ts";

const fileSystem = defineFeature({
  name: "file system",
  services: [
    serviceGroup(
      "FileSystem",
      { provides: [FileSystem.FileSystem] },
      layerVaultFileSystem,
    ),
  ],
});

const features = [platformBase, fileSystem] as const;

type Expect<T extends true> = T;
type _NoOpenPort = Expect<
  [OpenPorts<typeof features, ShellProvides>] extends [never] ? true : false
>;

const base = Layer.mergeAll(
  layerHost(),
  layerTestObsidianEnv(),
  testNotifier().layer,
  testPluginHost({ onViewCreated: () => Effect.succeed(false) }).layer,
  Layer.mock(LanguagePack)({
    locale: "en",
    plugin: "ZotLit",
    endonym: "English",
    refresh: Option.none(),
    situation: Effect.succeed({ kind: "unavailable" }),
  }),
  makeGraphBuilt().layer,
  Layer.succeed(ObsidianApp, stubService<App>("App", {})),
  layerPluginSettings(
    { loadData: async () => null, saveData: async () => {} },
    { definition: settingsDefinitionOf(features) },
  ),
);

it.effect(
  "builds a host of the Zotero-free platform and a file system with no Zotero service",
  () =>
    Effect.gen(function* () {
      const services = featureServices(features, base);
      const registrations = Layer.mergeAll(
        Layer.empty,
        ...features.flatMap((feature) =>
          feature.registrations.map((entry) => entry.layer),
        ),
      );
      const context = yield* Layer.build(
        registrations.pipe(Layer.provideMerge(services)),
      );
      expect(context.mapUnsafe.has(FileSystem.FileSystem.key)).toBe(true);
      for (const tag of [ZoteroReads, ZoteroPref, LocalServer, ZoteroHttp])
        expect(context.mapUnsafe.has(tag.key)).toBe(false);
    }).pipe(Effect.scoped),
);
