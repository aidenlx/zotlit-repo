// @vitest-environment happy-dom
import { expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Stream, SubscriptionRef } from "effect";
import { TestClock } from "effect/testing";
import type { App, Plugin, PluginManifest } from "obsidian";

import { PandocEngine } from "@zotlit/citations/obsidian/pandoc/service.ts";
import { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import { Template } from "@zotlit/notes/obsidian/template/service.ts";
import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";
import { AttachmentImport } from "@zotlit/plugin-services/desktop/attachment-import/service.ts";
import { ChineseSegmenter } from "@zotlit/plugin-services/obsidian/chinese-segmenter/service.ts";
import { LanguagePack } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import type { LanguagePackSituation } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import { layerSettingTab } from "@zotlit/plugin-shell/obsidian/setting-tab/layer.ts";
import { LocalBridge } from "@zotlit/template-workbench/desktop/local-bridge/service.ts";
import type { WorkbenchConnection } from "@zotlit/template-workbench/desktop/local-bridge/service.ts";

import { features } from "@/features.ts";
import { host } from "@/host.ts";
import { defaults } from "@/services/settings/schema.ts";

import { unimplementedTabServices } from "./__fixtures__.ts";

const CONNECTION: WorkbenchConnection = {
  origin: "https://zotlit.aidenlx.site",
  profileId: "books",
  profileName: "Books",
  item: null,
};

const OFFERED: LanguagePackSituation = {
  kind: "offered",
  pack: { fileName: "zh-CN.json", origin: "github.com/aidenlx/zotlit" },
};

/**
 * The tab layer over services whose change streams stay quiet but for the
 * Workbench Connection, the Language Pack and the settings, which the test
 * moves. Counts each rebuild of the tab.
 */
const tabLayer = Effect.gen(function* () {
  const settings = yield* SubscriptionRef.make<Settings>(defaults);
  const connection = yield* SubscriptionRef.make<WorkbenchConnection | null>(
    null,
  );
  const situation = yield* SubscriptionRef.make<LanguagePackSituation>({
    kind: "unavailable",
  });
  const rebuilds = { count: 0 };
  const plugin = stubService<Plugin>("Plugin", {
    app: stubService<App>("App", {}),
    manifest: stubService<PluginManifest>("PluginManifest", {}),
  });
  const quiet = { changes: Stream.empty };
  const services = Context.make(
    PluginHost,
    stubService<PluginHost["Service"]>("PluginHost", {
      addSettingTab: (build) =>
        Effect.sync(() => {
          const tab = build(plugin);
          tab.update = () => void rebuilds.count++;
          return tab;
        }),
    }),
  ).pipe(
    Context.add(
      PluginSettings,
      stubService<PluginSettings["Service"]>("PluginSettings", {
        changes: SubscriptionRef.changes(settings),
      }),
    ),
    Context.add(
      LocalServer,
      stubService<LocalServer["Service"]>("LocalServer", {
        effectivePortChanges: Stream.empty,
      }),
    ),
    Context.add(Profile, stubService<Profile["Service"]>("Profile", quiet)),
    Context.add(
      Template,
      stubService<Template["Service"]>("Template", {
        compileEvents: Stream.empty,
      }),
    ),
    Context.add(
      PandocEngine,
      stubService<PandocEngine["Service"]>("PandocEngine", quiet),
    ),
    Context.add(
      ChineseSegmenter,
      stubService<ChineseSegmenter["Service"]>("ChineseSegmenter", quiet),
    ),
    Context.add(
      LibraryScope,
      stubService<LibraryScope["Service"]>("LibraryScope", quiet),
    ),
    Context.add(
      AttachmentImport,
      stubService<AttachmentImport["Service"]>("AttachmentImport", {
        approvedFoldersChanges: Stream.empty,
      }),
    ),
    Context.add(
      LocalBridge,
      stubService<LocalBridge["Service"]>("LocalBridge", {
        changes: SubscriptionRef.changes(connection),
      }),
    ),
    Context.add(
      LanguagePack,
      stubService<LanguagePack["Service"]>("LanguagePack", {
        changes: SubscriptionRef.changes(situation),
      }),
    ),
  );
  yield* Layer.build(
    layerSettingTab(features, host.settingTab, {
      webWorkbenchEnabled: true,
    }).pipe(
      Layer.provide(testNotifier().layer),
      // The test gives the services the tab layer itself reads; the rest
      // stay unimplemented.
      Layer.provide(
        Layer.mergeAll(
          unimplementedTabServices,
          Layer.succeedContext(services),
        ),
      ),
    ),
  );
  return { connection, situation, settings, rebuilds };
});

it.effect(
  "rebuilds once for a connection change and a Language Pack change inside one settle window",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { connection, situation, rebuilds } = yield* tabLayer;

        yield* SubscriptionRef.set(connection, CONNECTION);
        yield* TestClock.adjust("20 millis");
        yield* SubscriptionRef.set(situation, OFFERED);
        yield* TestClock.adjust("49 millis");
        expect(rebuilds.count).toBe(0);

        yield* TestClock.adjust("1 millis");
        expect(rebuilds.count).toBe(1);
        yield* TestClock.adjust("1 second");
        expect(rebuilds.count).toBe(1);
      }),
    ),
);

it.effect(
  "rebuilds once for reminder flag flips inside one settle window, and not for other settings",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { settings, rebuilds } = yield* tabLayer;
        const flip = (
          key: "release.migration-pending" | "note.template-conversion-pending",
        ) =>
          SubscriptionRef.update(settings, (current) => ({
            ...current,
            [key]: !current[key],
          }));

        // A setting no row's presence reads leaves the definitions alone.
        yield* SubscriptionRef.update(settings, (current) => ({
          ...current,
          "log.to-file": !current["log.to-file"],
        }));
        yield* TestClock.adjust("1 second");
        expect(rebuilds.count).toBe(0);

        yield* flip("release.migration-pending");
        yield* TestClock.adjust("10 millis");
        yield* flip("note.template-conversion-pending");
        yield* TestClock.adjust("10 millis");
        yield* flip("release.migration-pending");
        yield* TestClock.adjust("49 millis");
        expect(rebuilds.count).toBe(0);

        yield* TestClock.adjust("1 millis");
        expect(rebuilds.count).toBe(1);
        yield* TestClock.adjust("1 second");
        expect(rebuilds.count).toBe(1);
      }),
    ),
);
