import { it } from "@effect/vitest";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { expect } from "vitest";

import { openTestBridge } from "@zotlit/plugin-kernel/__fixtures__/effect-bridge.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";

import { NoteIndex } from "@/services/note-index/service.ts";
import { defaults } from "@/services/settings/schema.ts";
import { PluginSettings } from "@/services/settings/service.ts";
import { layerRcRef } from "@/services/zotero-reads/connection.ts";
import { DbUnavailable } from "@/services/zotero-reads/rpc.ts";
import {
  layerZoteroReads,
  ZoteroReads,
} from "@/services/zotero-reads/service.ts";
import {
  inProcessClient,
  memoryOpener,
} from "@/services/zotero-reads/test-utils.ts";

import { workbenchContext } from "./__fixtures__.ts";
import { bindTemplateData } from "./data-handle.ts";

/** My Library, which holds no item. */
const SEED = `
  insert into version (schema, version) values ('userdata', 129);
  insert into libraries (libraryID, type, version, clientVersion)
    values (1, 'user', 1, 1);
`;

/**
 * The handle over `reads`, with plugin settings that count their reads. It
 * runs through `bridge`, or through a bridge that counts its runs.
 */
function handle(
  reads: Context.Context<ZoteroReads>,
  bridge?: Pick<EffectBridge, "runPromise">,
) {
  const runs = { count: 0 };
  const runPromise: EffectBridge["runPromise"] =
    bridge?.runPromise ??
    ((effect) => {
      runs.count += 1;
      return Effect.runPromise(effect);
    });
  const settingsReads = { count: 0 };
  const templateData = bindTemplateData(
    { runPromise },
    workbenchContext(
      reads,
      Context.make(
        PluginSettings,
        stubService<PluginSettings["Service"]>("PluginSettings", {
          current: Effect.sync(() => {
            settingsReads.count += 1;
            return defaults;
          }),
        }),
      ),
      Context.make(
        NoteIndex,
        stubService<NoteIndex["Service"]>("NoteIndex", {
          whenIndexed: Effect.void,
        }),
      ),
    ),
  );
  return { templateData, runs, settingsReads };
}

/** Zotero reads over a database that holds My Library alone. */
const memoryReads = Layer.build(
  layerZoteroReads(inProcessClient(layerRcRef(memoryOpener(() => SEED).open))),
);

it.effect(
  "loads through the bridge, reading the given settings in place of the plugin's",
  () =>
    Effect.gen(function* () {
      const { templateData, runs, settingsReads } = handle(yield* memoryReads);

      expect(
        yield* Effect.promise(() => templateData.load("ABCD2345", "note")),
      ).toEqual({ kind: "not-found" });
      expect(settingsReads.count).toBe(1);
      expect(
        yield* Effect.promise(() =>
          templateData.load("ABCD2345", "note", { settings: defaults }),
        ),
      ).toEqual({ kind: "not-found" });
      expect(settingsReads.count).toBe(1);
      expect(runs.count).toBe(2);
    }),
);

it.effect("rejects with what failed to read the data", () =>
  Effect.gen(function* () {
    const unavailable = new DbUnavailable({ message: "Unavailable" });
    const { templateData } = handle(
      Context.make(
        ZoteroReads,
        stubService<ZoteroReads["Service"]>("ZoteroReads", {
          snapshot: Effect.fail(unavailable),
        }),
      ),
    );

    const rejected = (load: () => Promise<unknown>) =>
      Effect.promise(() =>
        load().then(
          () => undefined,
          (error) => error,
        ),
      );
    expect(yield* rejected(() => templateData.load("ABCD2345", "note"))).toBe(
      unavailable,
    );
    expect(
      yield* rejected(() =>
        templateData.loadCitation({ key: "ABCD2345" }, "main"),
      ),
    ).toBe(unavailable);
  }),
);

it.effect("settles a load after disposal as the bridge does", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.fork(yield* Scope.Scope);
    const reads = yield* Layer.buildWithScope(
      layerZoteroReads(
        inProcessClient(layerRcRef(memoryOpener(() => SEED).open)),
      ),
      scope,
    );
    const bridge = openTestBridge();
    const { templateData } = handle(reads, bridge);
    const settled = (load: () => Promise<unknown>) =>
      Effect.promise(() =>
        load().then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        ),
      );
    expect(yield* settled(() => templateData.load("ABCD2345", "note"))).toEqual(
      { value: { kind: "not-found" } },
    );

    // Unload: the runtime under the bridge, then the services it held.
    yield* Effect.promise(() => bridge[Symbol.asyncDispose]());
    yield* Scope.close(scope, Exit.void);

    // bridge.runPromise runs on the captured context, so the load rejects
    // with the released reads' own answer.
    expect(
      yield* settled(() => templateData.load("ABCD2345", "note")),
    ).toMatchObject({ error: { _tag: "DbUnavailable" } });
  }),
);
