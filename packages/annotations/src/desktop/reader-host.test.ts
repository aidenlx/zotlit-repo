// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Events } from "obsidian";
import type { App, SecretStorage } from "obsidian";

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
} from "@zotlit/plugin-shell/obsidian/compose.ts";
import { makeGraphBuilt } from "@zotlit/plugin-shell/obsidian/graph-built.ts";

import { readerFeatures, readerHost } from "./__fixtures__/reader-host.ts";

import { AnnotationRepository } from "#obsidian/annotation-repository/service.ts";
import { PdfAnnotationEditor } from "#obsidian/pdf-annotation-editor/service.ts";

/** The shell's base over in-memory Obsidian sources and empty plugin data. */
const base = Layer.mergeAll(
  layerHost(),
  layerTestObsidianEnv(),
  testNotifier().layer,
  testPluginHost({
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
      secretStorage: stubService<SecretStorage>("SecretStorage", {
        getSecret: () => null,
        setSecret: () => {},
      }),
    }),
  ),
  layerPluginSettings(
    { loadData: async () => null, saveData: async () => {} },
    readerHost.settings,
  ),
);

it("orders a reader host's services after the stubs they read", () => {
  const order = serviceOrder(readerFeatures);
  expect(order.indexOf("AnnotationRepository")).toBeGreaterThan(
    order.indexOf("stub zotlit/zotero-reads/ZoteroReads"),
  );
});

it.effect(
  "builds a reader host from the platform, the annotations and stub capabilities",
  () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(featureServices(readerFeatures, base));
      expect(context.mapUnsafe.has(AnnotationRepository.key)).toBe(true);
      expect(context.mapUnsafe.has(PdfAnnotationEditor.key)).toBe(true);
    }).pipe(Effect.scoped),
);
