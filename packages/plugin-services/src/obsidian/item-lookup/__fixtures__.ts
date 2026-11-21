// The Item search built from its layer over a test's reads client and Library Scope.

import type { LibraryScopeState } from "#obsidian/library-scope/service.ts";
import { Effect, Layer, Stream, SubscriptionRef } from "effect";
import type { Scope } from "effect";

import { testNotifier } from "@zotlit/obsidian-kit/__fixtures__/notifier.ts";
import { MemoryDeviceStorage } from "@zotlit/obsidian-kit/__fixtures__/obsidian-device-storage.ts";
import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { layerDeviceStorageFrom } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";
import { layerZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { AvailableLibrary } from "@zotlit/zotero-reads/contract/library-scope.ts";
import type { ZoteroReadsClient } from "@zotlit/zotero-reads/contract/rpc.ts";

import { bindItemLookup } from "./handle.ts";
import type { ItemLookupHandle } from "./handle.ts";
import { ItemLookup, layerItemLookup } from "./service.ts";

import { ChineseSegmenter } from "#obsidian/chinese-segmenter/service.ts";
import { LibraryScope } from "#obsidian/library-scope/service.ts";
import { UseLedger } from "#obsidian/use-ledger/service.ts";

/** The Library Scope state that holds `libraries`, or an unresolved one for `null`. */
export function scopeState(
  libraries: readonly AvailableLibrary[] | null,
): LibraryScopeState {
  return {
    current: libraries && {
      mode: "all",
      invalid: false,
      available: libraries,
      unavailable: [],
    },
    all: null,
    invalid: false,
    effective: { mode: "all" },
    libraryRows: null,
  };
}

/** A Library Scope whose Libraries the test sets through `state`. */
export function layerLibraryScopeOf(
  state: SubscriptionRef.SubscriptionRef<LibraryScopeState>,
): Layer.Layer<LibraryScope> {
  return Layer.mock(LibraryScope, {
    current: Effect.map(SubscriptionRef.get(state), (held) => held.current),
    changes: SubscriptionRef.changes(state),
  });
}

/**
 * The Item search over `client`, the Library Scope `scope`, and no Uses. Its
 * Chinese Segmenter is ready unless the test gives `segmenter`, and its
 * notices go to `notifier`, or to a recorder that no test reads.
 */
export function layerTestItemLookup(
  client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>,
  scope: Layer.Layer<LibraryScope>,
  {
    segmenter = Layer.mock(ChineseSegmenter, {
      current: Effect.succeed({ kind: "ready", version: "1.0.0" } as const),
    }),
    notifier = testNotifier().layer,
  }: {
    segmenter?: Layer.Layer<ChineseSegmenter>;
    notifier?: Layer.Layer<Notifier>;
  } = {},
): Layer.Layer<ItemLookup> {
  return layerItemLookup.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerZoteroReads(client),
        scope,
        Layer.mock(UseLedger, { uses: Effect.succeed({}) }),
        segmenter,
        notifier,
        layerDeviceStorageFrom(new MemoryDeviceStorage()),
      ),
    ),
  );
}

/**
 * The same search behind its Promise edge, for a test outside Effect, over
 * a scope that holds `libraries`; `stack` closes it.
 */
export async function buildItemLookup(
  client: Effect.Effect<ZoteroReadsClient, never, Scope.Scope>,
  libraries: readonly AvailableLibrary[],
  stack: AsyncDisposableStack,
): Promise<ItemLookupHandle> {
  const runtime = buildRuntime(
    layerTestItemLookup(
      client,
      Layer.mock(LibraryScope, {
        current: Effect.succeed(scopeState(libraries).current),
        changes: Stream.make(scopeState(libraries)),
      }),
    ),
    stack,
  );
  await runtime.context();
  return bindItemLookup(effectBridge(runtime), runtime.runSync(ItemLookup));
}
