// One Managed Binary that ships in the Resource Pack: its status, read from
// the installed pack, and the engine it starts from the verified bytes.
import { Cause, Duration, Effect, Layer, RcRef, Schema, Stream } from "effect";
import type { Context, Scope } from "effect";

import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { refusalStatus } from "@zotlit/resource-pack/status.ts";
import type { PackBinaryStatus } from "@zotlit/resource-pack/status.ts";

import { ResourcePackPlatform } from "./pack-platform.ts";
import { makePackStatus } from "./pack-status.ts";
import type { PackStatusApi } from "./pack-status.ts";

export type { PackBinaryStatus };

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
}

/** Effect-native operations; the layer owns the reads and the shared engine. */
export interface PackBinaryApi<
  Engine extends Disposable | AsyncDisposable,
> extends PackStatusApi {
  /**
   * Reads the pack and answers where the binary stands, as
   * {@link PackStatusApi.check} does. A verified binary that did not start
   * stays `failed` until the pack gives other bytes or a start of those bytes
   * succeeds.
   */
  readonly check: Effect.Effect<PackBinaryStatus>;
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

type Loaded =
  | {
      ok: true;
      bytes: Uint8Array<ArrayBuffer>;
      version: string;
      /** The SHA-256 of the entry text: the identity of `bytes`. */
      sha256: string;
    }
  | { ok: false; status: PackBinaryStatus };

const makePackBinary = Effect.fn("PackBinary.make")(function* <
  Engine extends Disposable | AsyncDisposable,
>(binary: PackBinary<Engine>) {
  const platform = yield* ResourcePackPlatform;
  /**
   * The start that failed last, by the SHA-256 of the entry it started from:
   * a status read of the same bytes states it, with no start.
   */
  let failedStart: { readonly sha256: string; readonly detail: string } | null =
    null;
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
  /** The verified binary of the installed pack, or the status of the refusal. */
  const load = Effect.fn("PackBinary.load")(function* () {
    const location = yield* platform.locate;
    if (!location) {
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
      sha256: read.sha256,
    } satisfies Loaded;
  });
  const start = ({ bytes, sha256 }: Extract<Loaded, { ok: true }>) =>
    Effect.acquireRelease(
      Effect.tryPromise({
        try: () => binary.createEngine(bytes),
        catch: managedBinaryError,
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            failedStart = null;
          }),
        ),
        Effect.tapError((error) =>
          log("The binary did not start", { error }, "error").pipe(
            Effect.andThen(
              Effect.sync(() => {
                failedStart = { sha256, detail: error.message };
              }),
            ),
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
  const { publish, check, checkChanged, current, changes } =
    yield* makePackStatus(
      Effect.gen(function* () {
        const loaded = yield* load();
        if (!loaded.ok) return loaded.status;
        return failedStart?.sha256 === loaded.sha256
          ? ({ kind: "failed", detail: failedStart.detail } as const)
          : ({ kind: "ready", version: loaded.version } as const);
      }),
    );
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
      const engine = yield* start(loaded);
      yield* publish({ kind: "ready", version: loaded.version });
      return engine;
    }),
    idleTimeToLive: Duration.infinity,
  });
  // The engine of the pack before the change goes, and each watcher learns
  // where the binary stands in the pack that is there now.
  yield* platform.changes.pipe(
    Stream.runForEach(() =>
      Effect.andThen(RcRef.invalidate(sharedEngine), checkChanged),
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
    Effect.sync(() => {
      closed = true;
    }),
  );
  return {
    check,
    current,
    changes,
    getEngine,
  } satisfies PackBinaryApi<Engine>;
});
