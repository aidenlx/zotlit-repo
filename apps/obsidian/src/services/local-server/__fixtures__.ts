// A Local Server built from its layer over empty settings and dependency stubs.
import { Effect, Layer } from "effect";

import { stubService } from "@/lib/__fixtures__/service-stub.ts";
import { buildRuntime } from "@/lib/effect-layer.ts";
import { NoteIndex } from "@/services/note-index/service.ts";
import { applySettings } from "@/services/settings/__fixtures__.ts";
import type { SettingsOverrides } from "@/services/settings/__fixtures__.ts";
import {
  layerPluginSettings,
  PluginSettings,
} from "@/services/settings/service.ts";
import { ZoteroPref } from "@/services/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@/services/zotero-pref/service.ts";

import { layerLocalServer, LocalServer } from "./service.ts";

export async function buildLocalServer(
  overrides: SettingsOverrides,
  stack: AsyncDisposableStack,
  noteIndex: Partial<
    Pick<NoteIndex["Service"], "whenIndexed" | "getIndexedItemKeys">
  > = {},
) {
  const settingsLayer = layerPluginSettings({
    loadData: () => Promise.resolve(null),
    saveData: () => Promise.resolve(),
  });
  const prefLayer = Layer.succeed(
    ZoteroPref,
    stubService<ZoteroPref["Service"]>("ZoteroPref", {
      // The Local Server reads only the source id from this snapshot.
      current: Effect.succeed({
        sourceId: "a1b2c3d4",
      } as ZoteroPrefSnapshot),
    }),
  );
  const noteIndexLayer = Layer.succeed(
    NoteIndex,
    stubService<NoteIndex["Service"]>("NoteIndex", {
      whenIndexed: Effect.void,
      getIndexedItemKeys: Effect.succeed(["ABCD2345"]),
      ...noteIndex,
    }),
  );
  const runtime = buildRuntime(
    layerLocalServer.pipe(
      Layer.provideMerge(settingsLayer),
      Layer.provide(prefLayer),
      Layer.provide(noteIndexLayer),
    ),
    stack,
  );
  await runtime.context();
  const settings = runtime.runSync(PluginSettings);
  applySettings(settings, runtime, overrides);
  return {
    runtime,
    server: runtime.runSync(LocalServer),
    settings,
  };
}
