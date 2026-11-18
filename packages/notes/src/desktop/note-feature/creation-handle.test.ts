// The edge handle is a Promise API on purpose: these cases call it as the
// Quick Switch, the Library View and the Query View do.
import { Effect, Layer, ManagedRuntime } from "effect";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import { expect, it, vi } from "vitest";

import type { Item } from "@zotlit/db";
import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import { DbUnavailable } from "@zotlit/zotero-reads/contract/rpc.ts";

import { bindNoteCreation } from "./creation-handle.ts";
import type { NoteCreationServices } from "./creation-handle.ts";
import { NoteFeature } from "./service.ts";

import { unimplementedProfileDialogServices } from "#__fixtures__/profile/dialogs.ts";

const ITEM = { indexedKey: "ABCD2345" } as Item;
const FILE = Object.assign(new TFile(), { path: "Literature/Paper.md" });

/** The handle over a Note Feature whose plan is `plan`, bound as `plugin-runtime.ts` binds it. */
function handleOver(planCreations: NoteFeature["Service"]["planCreations"]) {
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      unimplementedProfileDialogServices,
      Layer.mock(NoteFeature, {
        planCreations,
        createNote: () => Effect.succeed({ outcome: "created", file: FILE }),
      }),
      testNotifier().layer,
      Layer.mock(ZoteroPref, {
        current: Effect.succeed(
          stubService<ZoteroPrefSnapshot>("ZoteroPrefSnapshot", {
            dataDir: "",
          }),
        ),
      }),
    ),
  );
  const handle = bindNoteCreation(
    effectBridge(runtime),
    runtime.runSync(Effect.context<NoteCreationServices>()),
    {
      app: stubService<App>("App", {}),
      createProfile: vi.fn(),
      importProfile: vi.fn(),
    },
  );
  return { runtime, handle };
}

/** A plan that creates under the bound Profile with no question. */
const bound: NoteFeature["Service"]["planCreations"] = (keys) =>
  Effect.succeed(
    new Map(
      keys.map((key) => [
        key,
        {
          item: ITEM,
          selection: { selector: "default", source: "bound", shouldAsk: false },
          previews: [],
        },
      ]),
    ),
  );

/** How a Promise settled, so two settlements compare. */
function settled(promise: Promise<unknown>) {
  return promise.then(
    (value) => ({ status: "fulfilled", value }),
    (reason: unknown) => ({ status: "rejected", reason }),
  );
}

it("resolves with the created note", async () => {
  const { runtime, handle } = handleOver(bound);

  await expect(handle.createNoteInteractively(ITEM)).resolves.toBe(FILE);
  await runtime.dispose();
});

it("rejects with what the plan failed with", async () => {
  const failure = new DbUnavailable({ message: "the read failed" });
  const { runtime, handle } = handleOver(() => Effect.fail(failure));

  await expect(handle.createNoteInteractively(ITEM)).rejects.toBe(failure);
  await runtime.dispose();
});

it("answers null for a creation that unload interrupts, as for a cancelled one", async () => {
  const opened = Promise.withResolvers<void>();
  const { runtime, handle } = handleOver(() =>
    Effect.sync(() => opened.resolve()).pipe(Effect.andThen(Effect.never)),
  );

  const pending = settled(handle.createNoteInteractively(ITEM));
  await opened.promise;
  await runtime.dispose();

  expect(await pending).toEqual({ status: "fulfilled", value: null });
});
