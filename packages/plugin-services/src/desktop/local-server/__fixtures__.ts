import type { Settings, SettingsDefinition } from "#core/settings/schema.ts";
import type { ZoteroPrefSnapshot } from "#core/zotero-pref/service.ts";
import { Effect, Layer } from "effect";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";

import { layerLocalServer } from "./layer.ts";

import { applySettings } from "#__fixtures__/settings.ts";
import { LocalServer } from "#core/local-server/service.ts";
import { ZoteroPref } from "#core/zotero-pref/service.ts";
import { NoteIndex } from "#obsidian/note-index/service.ts";
import {
  layerPluginSettings,
  PluginSettings,
} from "#obsidian/settings/service.ts";

interface SeededSettings {
  readonly definition: SettingsDefinition;
  readonly overrides: Partial<Settings>;
}

export async function buildLocalServer(
  { definition, overrides }: SeededSettings,
  stack: AsyncDisposableStack,
  noteIndex: Partial<
    Pick<NoteIndex["Service"], "whenIndexed" | "getIndexedItemKeys">
  > = {},
) {
  const settingsLayer = layerPluginSettings(
    {
      loadData: () => Promise.resolve(null),
      saveData: () => Promise.resolve(),
    },
    { definition },
  );
  const prefLayer = Layer.succeed(
    ZoteroPref,
    stubService<ZoteroPref["Service"]>("ZoteroPref", {
      current: Effect.succeed({
        acceptedSourceIds: ["a1b2c3d4"],
      } as Partial<ZoteroPrefSnapshot> as ZoteroPrefSnapshot),
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
