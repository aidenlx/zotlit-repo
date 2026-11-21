// The one-time cleanup after the update to the Resource Pack: the binaries
// that earlier versions downloaded to the device, and the vault's records of
// their dismissed install offers.
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

/** What the cleanup reads of a folder in the origin's private file system. */
export interface OldStoreDirectory {
  getDirectoryHandle(name: string): Promise<OldStoreDirectory>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  keys(): AsyncIterable<string>;
}

/** Runs `step`; an entry that is already gone is a success. */
async function unlessGone<A>(step: () => Promise<A>): Promise<A | undefined> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError")
      return undefined;
    throw error;
  }
}

/** Removes each binary's folder, then the root when nothing else is in it. */
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

/**
 * How the cleanup of one start ended: it removed the old data and recorded
 * it, it found the vault's record of an earlier cleanup, or a removal failed.
 */
export type OldStoreCleanupOutcome = "removed" | "skipped" | "failed";

/**
 * Removes the downloaded binaries from the device and the dismissed install
 * offers from the vault, then records it in the vault, so each vault runs it
 * one time. The folder is device-wide: the first vault to start removes it,
 * and each other vault finds none. A removal that fails is logged and leaves
 * no record, so the next start runs it again. It answers how it ended.
 *
 * @param openRoot the root of the origin's private file system.
 */
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

/** The cleanup of this start of the plugin. */
export class OldStoreCleanup extends Context.Service<
  OldStoreCleanup,
  {
    /** How the cleanup ended; it waits while the cleanup runs. */
    readonly outcome: Effect.Effect<OldStoreCleanupOutcome>;
  }
>()("zotlit/managed-binary/OldStoreCleanup") {}

/**
 * Runs {@link removeOldStore} over the browser's private file system when the
 * plugin starts. The start does not wait for it.
 */
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
