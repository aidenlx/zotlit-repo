// One Managed Binary that ships in the Resource Pack: its status, read from
// the installed pack, and the engine it starts from the verified bytes.
import {
  Cause,
  Duration,
  Effect,
  Layer,
  PubSub,
  RcRef,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect";
import type { Context, Scope } from "effect";

import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import type { PackFailure } from "@zotlit/resource-pack/format.ts";
import type { PackEntryLocation } from "@zotlit/resource-pack/reader.ts";

import { ResourcePackPlatform } from "./pack-platform.ts";
import type { PackLocation } from "./pack-platform.ts";

/**
 * A Managed Binary gave no engine: the Resource Pack gave no binary, or the
 * engine did not start or did not release. `message` is the original's, which
 * the failure status and the logs show; `cause` holds the original where
 * there is one.
 */
export class ManagedBinaryError extends Schema.TaggedError<
  ManagedBinaryError,
  { readonly brand: unique symbol }
>()("ManagedBinaryError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

/** What an engine threw, as a {@link ManagedBinaryError} with its message. */
function managedBinaryError(cause: unknown): ManagedBinaryError {
  return cause instanceof ManagedBinaryError
    ? cause
    : new ManagedBinaryError({
        message: Error.isError(cause) ? cause.message : String(cause),
        cause,
      });
}

/** One Managed Binary of the Resource Pack, and what it starts once verified. */
export interface PackBinary<Engine extends AsyncDisposable | Disposable> {
  /** Names the binary; its Pack Entry has the same name. */
  readonly id: string;
  /** The binary's name in logs and error messages, e.g. `Chinese segmenter`. */
  readonly label: string;
  readonly logCategory: readonly [string, ...string[]];
  /** Starts the engine over the verified binary. */
  readonly createEngine: (binary: Uint8Array<ArrayBuffer>) => Promise<Engine>;
  /**
   * Start the engine once in each status read, then release it, so a binary
   * that does not start reports `failed` before its first use.
   * @default false
   */
  readonly startOnCheck?: boolean;
}

/** Where a binary stands. Each arm but `ready` names the one step that mends it. */
export type PackBinaryStatus =
  /** Obsidian lists no Resource Pack: install it. */
  | { readonly kind: "pack-absent" }
  /** The pack is older than this plugin reads, or lacks the entry: update the pack. */
  | { readonly kind: "pack-outdated" }
  /** The pack is newer than this plugin reads: update the plugin. */
  | { readonly kind: "plugin-outdated" }
  /** The pack file is not what its index states: install the pack again. */
  | { readonly kind: "pack-damaged" }
  /** The pack of `version` holds the verified binary. */
  | { readonly kind: "ready"; readonly version: string }
  /** The verified binary did not start. */
  | { readonly kind: "failed"; readonly detail: string };

/** Effect-native operations; the layer owns the reads and the shared engine. */
export interface PackBinaryApi<Engine extends Disposable | AsyncDisposable> {
  /**
   * Reads the pack and answers where the binary stands. Every call reads the
   * pack file again, so it sees a pack installed since the last call.
   */
  readonly check: Effect.Effect<PackBinaryStatus>;
  /**
   * Where the binary stands, with no read of the pack file: `pack-absent`
   * with no pack installed, else the status of the last read. `null` while
   * the installed pack is unread; a borrow of the engine reads it. A
   * `pack-absent` answer is also stated to `changes`, so a watcher learns of
   * a missing pack with no read.
   */
  readonly current: Effect.Effect<PackBinaryStatus | null>;
  /**
   * The status last stated, then each one that differs; none before the
   * first. The service reads the pack again and states its status each time
   * Obsidian installs, updates or removes the pack.
   */
  readonly changes: Stream.Stream<PackBinaryStatus>;
  /**
   * The binary's entry in the installed pack, for a reader in another realm;
   * `null` with no pack installed. It carries the SHA-256 of the entry once a
   * read of that pack gave the verified binary, so a repaired or changed
   * entry is another location.
   */
  readonly entry: Effect.Effect<PackEntryLocation | null>;
  /**
   * Borrow the shared engine for the caller's Scope. The first borrower reads
   * the pack and starts the engine; a pack that gives no binary, or a binary
   * that does not start, fails the borrow and sets the status. The first
   * borrower after Obsidian installs, updates or removes the pack reads that
   * pack; an engine borrowed before then stays with its borrower.
   */
  readonly getEngine: Effect.Effect<
    Engine | null,
    ManagedBinaryError,
    Scope.Scope
  >;
}

/** One descriptor becomes one independently scoped service under its own tag. */
export function layerPackBinary<
  Id,
  Engine extends Disposable | AsyncDisposable,
>(
  tag: Context.Service<Id, PackBinaryApi<Engine>>,
  binary: PackBinary<Engine>,
): Layer.Layer<Id, never, ResourcePackPlatform> {
  return Layer.effect(tag, makePackBinary(binary));
}

/** The status a refused pack read gives. */
function refusalStatus(failure: PackFailure): PackBinaryStatus {
  switch (failure.kind) {
    case "pack-absent":
      return { kind: "pack-absent" };
    case "plugin-outdated":
      return { kind: "plugin-outdated" };
    // A pack that this plugin reads and that lacks the entry was built before
    // the entry joined the pack.
    case "pack-outdated":
    case "entry-missing":
      return { kind: "pack-outdated" };
    case "entry-damaged":
    case "pack-unreadable":
      return { kind: "pack-damaged" };
  }
}

const sameStatus = (a: PackBinaryStatus | null, b: PackBinaryStatus) =>
  a !== null &&
  a.kind === b.kind &&
  (a.kind !== "ready" || (b.kind === "ready" && a.version === b.version)) &&
  (a.kind !== "failed" || (b.kind === "failed" && a.detail === b.detail));

type Loaded =
  | { ok: true; bytes: Uint8Array<ArrayBuffer>; version: string }
  | { ok: false; status: PackBinaryStatus };

const makePackBinary = Effect.fn("PackBinary.make")(function* <
  Engine extends Disposable | AsyncDisposable,
>(binary: PackBinary<Engine>) {
  const platform = yield* ResourcePackPlatform;
  const status = yield* SubscriptionRef.make<PackBinaryStatus | null>(null);
  /** The entry the last read verified, in the pack it read; `null` after a refusal. */
  let verified: (PackLocation & { readonly sha256: string }) | null = null;
  let closed = false;
  const log = (
    message: string,
    fields: Record<string, unknown>,
    level: "debug" | "warn" | "error",
  ) =>
    (level === "error"
      ? Effect.logError(message)
      : level === "warn"
        ? Effect.logWarning(message)
        : Effect.logDebug(message)
    ).pipe(
      Effect.annotateLogs({ binary: binary.id, ...fields }),
      withLogCategory(...binary.logCategory),
    );
  const publish = Effect.fn("PackBinary.publish")(function* (
    next: PackBinaryStatus,
  ) {
    if (!sameStatus(yield* SubscriptionRef.get(status), next))
      yield* SubscriptionRef.set(status, Object.freeze(next));
    return next;
  });
  /** The verified binary of the installed pack, or the status of the refusal. */
  const load = Effect.fn("PackBinary.load")(function* () {
    const location = yield* platform.locate;
    if (!location) {
      verified = null;
      // No pack is the state before its install, read each time the row is
      // shown: a decision branch, not a degraded state.
      yield* log(
        "The Resource Pack gave no binary",
        { reason: "pack-absent" },
        "debug",
      );
      return { ok: false, status: { kind: "pack-absent" } } satisfies Loaded;
    }
    const read = yield* platform.readEntry(location, binary.id);
    verified = read.ok ? { ...location, sha256: read.sha256 } : null;
    if (!read.ok) {
      yield* log(
        "The Resource Pack gave no binary",
        { reason: read.failure.kind, failure: read.failure, pack: location },
        read.failure.kind === "pack-absent" ? "debug" : "warn",
      );
      return {
        ok: false,
        status: refusalStatus(read.failure),
      } satisfies Loaded;
    }
    return {
      ok: true,
      bytes: read.bytes,
      version: location.version,
    } satisfies Loaded;
  });
  const start = (bytes: Uint8Array<ArrayBuffer>) =>
    Effect.acquireRelease(
      Effect.tryPromise({
        try: () => binary.createEngine(bytes),
        catch: managedBinaryError,
      }).pipe(
        Effect.tapError((error) =>
          log("The binary did not start", { error }, "error").pipe(
            Effect.andThen(publish({ kind: "failed", detail: error.message })),
          ),
        ),
      ),
      (engine) =>
        Effect.tryPromise({
          try: async () => {
            if (Symbol.asyncDispose in engine)
              await engine[Symbol.asyncDispose]();
            else engine[Symbol.dispose]();
          },
          catch: managedBinaryError,
        }).pipe(
          Effect.catchCause((cause) =>
            log(
              "Could not release the binary engine",
              { error: Cause.squash(cause) },
              "error",
            ),
          ),
        ),
    );
  const check = Effect.gen(function* () {
    const loaded = yield* load();
    if (!loaded.ok) return yield* publish(loaded.status);
    const ready = { kind: "ready", version: loaded.version } as const;
    if (!binary.startOnCheck) return yield* publish(ready);
    return yield* Effect.scoped(start(loaded.bytes)).pipe(
      Effect.andThen(publish(ready)),
      // The failed start set the status.
      Effect.catch((error) =>
        Effect.succeed<PackBinaryStatus>({
          kind: "failed",
          detail: error.message,
        }),
      ),
    );
  }).pipe(Effect.withSpan("PackBinary.check"));
  // One engine shared by every borrower. It stays after its last borrower
  // leaves, until the layer closes.
  const sharedEngine = yield* RcRef.make({
    acquire: Effect.gen(function* () {
      const loaded = yield* load();
      if (!loaded.ok) {
        yield* publish(loaded.status);
        return yield* new ManagedBinaryError({
          message: `The Resource Pack gave no ${binary.label}: ${loaded.status.kind}`,
        });
      }
      const engine = yield* start(loaded.bytes);
      yield* publish({ kind: "ready", version: loaded.version });
      return engine;
    }),
    idleTimeToLive: Duration.infinity,
  });
  // The engine of the pack before the change goes, and each watcher learns
  // where the binary stands in the pack that is there now.
  yield* platform.changes.pipe(
    Stream.runForEach(() =>
      Effect.andThen(RcRef.invalidate(sharedEngine), check),
    ),
    Effect.forkScoped({ startImmediately: true }),
  );
  const getEngine = Effect.suspend(() =>
    closed
      ? Effect.succeed(null)
      : // A borrower that leaves while the engine starts would abandon the start,
        // and the next borrower would start the engine again; it waits for it.
        Effect.uninterruptible(RcRef.get(sharedEngine)),
  ).pipe(Effect.withSpan("PackBinary.getEngine"));
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      closed = true;
      yield* PubSub.shutdown(status.pubsub);
    }),
  );
  const current = Effect.gen(function* () {
    if (!(yield* platform.locate))
      return yield* publish({ kind: "pack-absent" });
    const last = yield* SubscriptionRef.get(status);
    // A pack installed after that status is unread.
    return last?.kind === "pack-absent" ? null : last;
  }).pipe(Effect.withSpan("PackBinary.current"));
  return {
    check,
    current,
    changes: SubscriptionRef.changes(status).pipe(
      Stream.filter((current) => current !== null),
    ),
    entry: Effect.map(platform.locate, (location) =>
      location
        ? {
            ...location,
            entry: binary.id,
            sha256:
              verified?.url === location.url &&
              verified.version === location.version
                ? verified.sha256
                : null,
          }
        : null,
    ).pipe(Effect.withSpan("PackBinary.entry")),
    getEngine,
  } satisfies PackBinaryApi<Engine>;
});
