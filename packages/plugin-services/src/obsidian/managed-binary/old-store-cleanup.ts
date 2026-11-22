import { Context, Deferred, Effect, Layer } from "effect";

import { DeviceStorage } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";

import {
  OLD_BINARY_IDS,
  OLD_STORE_CLEANUP_KEY,
  OLD_STORE_ROOT,
  oldDeclinedKey,
} from "#core/managed-binary/old-store.ts";

export interface OldStoreDirectory {
  getDirectoryHandle(name: string): Promise<OldStoreDirectory>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  keys(): AsyncIterable<string>;
}

async function unlessGone<A>(step: () => Promise<A>): Promise<A | undefined> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError")
      return undefined;
    throw error;
  }
}

async function removeFolders(
  openRoot: () => Promise<OldStoreDirectory>,
): Promise<void> {
  const root = await openRoot();
  const store = await unlessGone(() => root.getDirectoryHandle(OLD_STORE_ROOT));
  if (!store) return;
  for (const id of OLD_BINARY_IDS)
    await unlessGone(() => store.removeEntry(id, { recursive: true }));
  if (await isEmptyFolder(store))
    await unlessGone(() => root.removeEntry(OLD_STORE_ROOT));
}

async function isEmptyFolder(folder: OldStoreDirectory): Promise<boolean> {
  for await (const _ of folder.keys()) return false;
  return true;
}

export type OldStoreCleanupOutcome = "removed" | "skipped" | "failed";

export const removeOldStore = Effect.fn("ManagedBinary.removeOldStore")(
  function* (openRoot: () => Promise<OldStoreDirectory>) {
    const storage = yield* DeviceStorage;
    if (yield* storage.load(OLD_STORE_CLEANUP_KEY))
      return "skipped" satisfies OldStoreCleanupOutcome;
    for (const id of OLD_BINARY_IDS)
      yield* storage.save(oldDeclinedKey(id), null);
    yield* Effect.tryPromise(() => removeFolders(openRoot));
    yield* storage.save(OLD_STORE_CLEANUP_KEY, true);
    return "removed" satisfies OldStoreCleanupOutcome;
  },
  recover(
    (cause) =>
      Effect.logWarning(
        "Could not remove the downloaded Managed Binaries",
        cause,
      ).pipe(withLogCategory("managed-binary")),
    Effect.succeed<OldStoreCleanupOutcome>("failed"),
  ),
);

export class OldStoreCleanup extends Context.Service<
  OldStoreCleanup,
  {
    readonly outcome: Effect.Effect<OldStoreCleanupOutcome>;
  }
>()("zotlit/managed-binary/OldStoreCleanup") {}

export const layerOldStoreCleanup = Layer.effect(
  OldStoreCleanup,
  Effect.gen(function* () {
    const ended = yield* Deferred.make<OldStoreCleanupOutcome>();
    yield* removeOldStore(() => navigator.storage.getDirectory()).pipe(
      Effect.flatMap((outcome) => Deferred.succeed(ended, outcome)),
      Effect.forkScoped,
    );
    return {
      outcome: Deferred.await(ended).pipe(
        Effect.withSpan("OldStoreCleanup.outcome"),
      ),
    };
  }),
);
