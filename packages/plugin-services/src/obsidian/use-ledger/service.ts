import type { Stream } from "effect";
import {
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  PubSub,
  Schema,
  SubscriptionRef,
} from "effect";
import type { TFile } from "obsidian";

import { DeviceStorage } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import type {
  DeviceStorageError,
  DeviceStorageShape,
} from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { filterTag, forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import {
  parseInstant,
  toInstant,
} from "@zotlit/plugin-kernel/worker/effect-clock.ts";
import { isIndexedKey } from "@zotlit/zotero-types/keys";

import { itemKeyFromFrontmatter } from "#obsidian/note-index/parse.ts";

const UseKind = Schema.Literals(["opened", "read", "cited"]);
export type UseKind = typeof UseKind.Type;

export interface Use {
  readonly instant: DateTime.Utc;
  readonly kind: UseKind;
}

export type Ledger = Readonly<Record<string, Use>>;

const STORAGE_KEY = "zotlit-use-ledger";
const CAPACITY = 300;

export class UseLedger extends Context.Service<
  UseLedger,
  {
    readonly current: Effect.Effect<Ledger>;
    readonly changes: Stream.Stream<Ledger>;
    get(itemKey: string): Effect.Effect<Use | undefined>;
    readonly uses: Effect.Effect<Readonly<Record<string, number>>>;
    record(
      itemKey: string,
      kind: UseKind,
      instant?: DateTime.Utc,
    ): Effect.Effect<Use, DeviceStorageError>;
    withoutNoteUse<A, E, R>(
      file: TFile,
      open: Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E, R>;
  }
>()("zotlit/use-ledger/UseLedger") {}

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    UseLedger: UseLedger;
  }
}

const makeUseLedger = Effect.gen(function* () {
  const storage = yield* DeviceStorage;
  const metadata = yield* MetadataCache;
  const workspace = yield* Workspace;
  const ledger = yield* SubscriptionRef.make(newest(yield* readSaved(storage)));
  const excludedOpens = new Map<TFile, number>();
  let closed = false;

  const now = DateTime.now;
  const current = SubscriptionRef.get(ledger);

  const record = Effect.fn("UseLedger.record")(function* (
    itemKey: string,
    kind: UseKind,
    instant?: DateTime.Utc,
  ) {
    const use: Use = Object.freeze({ instant: instant ?? (yield* now), kind });
    if (closed || !isIndexedKey(itemKey)) return use;
    const before = yield* current;
    const previous = before[itemKey];
    if (previous && DateTime.isGreaterThan(previous.instant, use.instant))
      return use;
    const next = newest({ ...before, [itemKey]: use });
    yield* storage.save(
      STORAGE_KEY,
      Object.fromEntries(
        Object.entries(next).map(([key, entry]) => [
          key,
          { instant: toInstant(entry.instant).toString(), kind: entry.kind },
        ]),
      ),
    );
    yield* SubscriptionRef.set(ledger, next);
    return use;
  });

  let enabled = false;
  let pending: { file: TFile; instant: DateTime.Utc } | null = null;
  yield* workspace.layoutReady.pipe(
    Effect.andThen(
      Effect.sync(() => {
        if (!closed) enabled = true;
      }),
    ),
    Effect.forkScoped({ startImmediately: true }),
  );
  yield* forkEach(
    filterTag(workspace.changes, "file-open"),
    Effect.fnUntraced(function* ({ file }) {
      if (!enabled || closed) return;
      pending = null;
      if (!file || file.extension !== "md" || excludedOpens.has(file)) return;
      const instant = yield* now;
      const cache = yield* metadata.fileCache(file);
      const key = itemKeyFromFrontmatter(cache);
      if (key) yield* record(key, "opened", instant);
      else if (!cache) pending = { file, instant };
    }),
  );
  yield* forkEach(
    filterTag(metadata.changes, "changed"),
    Effect.fnUntraced(function* ({ file, cache }) {
      if (!pending || pending.file !== file) return;
      if ((yield* workspace.getActiveFile) !== file) return;
      const { instant } = pending;
      pending = null;
      const key = itemKeyFromFrontmatter(cache);
      if (key) yield* record(key, "opened", instant);
    }),
  );
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
    }).pipe(Effect.andThen(PubSub.shutdown(ledger.pubsub))),
  );

  const flush = workspace.requestActiveLeafEvents;

  return UseLedger.of({
    current,
    changes: SubscriptionRef.changes(ledger),
    get: Effect.fn("UseLedger.get")((itemKey) =>
      Effect.map(current, (entries) => entries[itemKey]),
    ),
    uses: Effect.map(current, (entries) =>
      Object.fromEntries(
        Object.entries(entries).map(([key, use]) => [
          key,
          DateTime.toEpochMillis(use.instant),
        ]),
      ),
    ),
    record,
    withoutNoteUse: Effect.fn("UseLedger.withoutNoteUse")((file, open) =>
      Effect.acquireUseRelease(
        flush.pipe(
          Effect.andThen(
            Effect.sync(() => {
              excludedOpens.set(file, (excludedOpens.get(file) ?? 0) + 1);
            }),
          ),
        ),
        () => open,
        () =>
          flush.pipe(
            Effect.ensuring(
              Effect.sync(() => {
                const remaining = excludedOpens.get(file)! - 1;
                if (remaining) excludedOpens.set(file, remaining);
                else excludedOpens.delete(file);
              }),
            ),
          ),
      ),
    ),
  });
}).pipe(withLogCategory("use-ledger"));

export const layerUseLedger: Layer.Layer<
  UseLedger,
  never,
  DeviceStorage | MetadataCache | Workspace
> = Layer.effect(UseLedger, makeUseLedger);

function readSaved(
  storage: DeviceStorageShape,
): Effect.Effect<Record<string, Use>> {
  return storage.load(STORAGE_KEY).pipe(
    Effect.flatMap((raw) => Effect.try(() => loadUses(raw))),
    Effect.catch((error) =>
      Effect.logWarning("Could not read the saved Uses; starting empty").pipe(
        Effect.annotateLogs({ error: error.cause }),
        Effect.as({}),
      ),
    ),
  );
}

const decodeSaved = Schema.decodeUnknownOption(
  Schema.Record(Schema.String, Schema.Unknown),
);
const decodeEntry = Schema.decodeUnknownOption(
  Schema.Struct({ instant: Schema.String, kind: UseKind }),
);

function loadUses(raw: unknown): Record<string, Use> {
  const loaded: Record<string, Use> = {};
  const saved = Option.getOrElse(decodeSaved(raw), () => ({}));
  for (const [key, value] of Object.entries(saved)) {
    if (!isIndexedKey(key)) continue;
    const entry = Option.getOrUndefined(decodeEntry(value));
    const instant = entry && Option.getOrUndefined(parseInstant(entry.instant));
    if (entry && instant)
      loaded[key] = Object.freeze({ instant, kind: entry.kind });
  }
  return loaded;
}

function newest(entries: Ledger): Ledger {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(entries)
        .sort(([, a], [, b]) => DateTime.Order(b.instant, a.instant))
        .slice(0, CAPACITY),
    ),
  );
}
