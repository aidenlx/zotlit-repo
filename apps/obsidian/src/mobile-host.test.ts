// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Events } from "obsidian";
import type { App, SecretStorage } from "obsidian";

import { AnnotationRepository } from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import { CitationIndex } from "@zotlit/citations/obsidian/citation-index/service.ts";
import { Template } from "@zotlit/notes/obsidian/template/service.ts";
import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { layerTestObsidianEnv } from "@zotlit/obsidian-kit/__fixtures__/obsidian-env.ts";
import { layerHost } from "@zotlit/obsidian-kit/__fixtures__/obsidian-host-app.ts";
import { testPluginHost } from "@zotlit/obsidian-kit/__fixtures__/plugin-host.ts";
import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { LanguagePack } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import { layerPluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import {
  featureServices,
  serviceOrder,
  settingsDefinitionOf,
} from "@zotlit/plugin-shell/obsidian/compose.ts";
import { makeGraphBuilt } from "@zotlit/plugin-shell/obsidian/graph-built.ts";

import { mobileFeatures } from "./__fixtures__/mobile-host/features.ts";

const base = Layer.mergeAll(
  layerHost(),
  layerTestObsidianEnv(),
  testNotifier().layer,
  testPluginHost({
    onViewCreated: () => Effect.succeed(false),
    app: stubService<App>("App", {
      workspace: new Events() as unknown as App["workspace"],
    }),
    manifest: { id: "zotlit" },
  }).layer,
  Layer.succeed(LanguagePack, stubService("LanguagePack", {})),
  makeGraphBuilt().layer,
  Layer.succeed(
    ObsidianApp,
    stubService<App>("App", {
      loadLocalStorage: () => null,
      saveLocalStorage: () => {},
      plugins: Object.assign(new Events(), { plugins: {}, manifests: {} }),
      secretStorage: stubService<SecretStorage>("SecretStorage", {
        getSecret: () => null,
        setSecret: () => {},
      }),
    }),
  ),
  layerPluginSettings(
    { loadData: async () => null, saveData: async () => {} },
    { definition: settingsDefinitionOf(mobileFeatures) },
  ),
);

it("orders a Node-free host's services after the stubs they read", () => {
  const order = serviceOrder(mobileFeatures);
  expect(order.indexOf("AnnotationRepository")).toBeGreaterThan(
    order.indexOf("stub zotlit/zotero-reads/ZoteroReads"),
  );
});

it("orders the PDF annotation editor after the vault-on-disk stand-in", () => {
  const order = serviceOrder(mobileFeatures);
  const standIn = order.indexOf("stub zotlit/obsidian/VaultDisk");
  expect(standIn).toBeGreaterThanOrEqual(0);
  expect(order.indexOf("PdfAnnotationEditor")).toBeGreaterThan(standIn);
});

it.effect(
  "builds a Node-free host from the platform, every feature's Obsidian value and stub capabilities",
  () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(featureServices(mobileFeatures, base));
      expect(context.mapUnsafe.has(AnnotationRepository.key)).toBe(true);
      expect(context.mapUnsafe.has(CitationIndex.key)).toBe(true);
      expect(context.mapUnsafe.has(Template.key)).toBe(true);
    }).pipe(Effect.scoped),
);
