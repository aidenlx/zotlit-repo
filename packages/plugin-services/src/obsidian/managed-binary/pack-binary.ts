import type { Context, Scope } from "effect";
import { Cause, Duration, Effect, Layer, RcRef, Schema, Stream } from "effect";

import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { refusalStatus } from "@zotlit/resource-pack/status.ts";
import type {
  PackBinaryRefusal,
  PackBinaryStatus,
} from "@zotlit/resource-pack/status.ts";
import { PackBinaryRefusalSchema } from "@zotlit/zotero-reads/contract/rpc.ts";

import { ResourcePackPlatform } from "./pack-platform.ts";
import type { PackStatusApi } from "./pack-status.ts";
import { makePackStatus } from "./pack-status.ts";

export class ManagedBinaryError extends Schema.TaggedError<
  ManagedBinaryError,
  { readonly brand: unique symbol }
>()("ManagedBinaryError", {
  message: Schema.String,
  status: PackBinaryRefusalSchema,
  cause: Schema.optional(Schema.Defect()),
}) {}

class EngineReleaseError extends Schema.TaggedError<
  EngineReleaseError,
  { readonly brand: unique symbol }
>()("EngineReleaseError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

function startError(cause: unknown): ManagedBinaryError {
  const message = Error.isError(cause) ? cause.message : String(cause);
  return new ManagedBinaryError({
    message,
    status: { kind: "failed", detail: message },
    cause,
  });
}

export interface PackBinary<Engine extends AsyncDisposable | Disposable> {
  readonly id: string;
  readonly label: string;
  readonly logCategory: readonly [string, ...string[]];
  readonly createEngine: (binary: Uint8Array<ArrayBuffer>) => Promise<Engine>;
}

export interface PackBinaryApi<
  Engine extends Disposable | AsyncDisposable,
> extends PackStatusApi {
  readonly check: Effect.Effect<PackBinaryStatus>;
  readonly getEngine: Effect.Effect<
    Engine | null,
    ManagedBinaryError,
    Scope.Scope
  >;
}

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
      sha256: string;
    }
  | { ok: false; status: PackBinaryRefusal };

const makePackBinary = Effect.fn("PackBinary.make")(function* <
  Engine extends Disposable | AsyncDisposable,
>(binary: PackBinary<Engine>) {
  const platform = yield* ResourcePackPlatform;
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
  const load = Effect.fn("PackBinary.load")(function* () {
    const location = yield* platform.locate;
    if (!location) {
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
        catch: startError,
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
            Effect.andThen(publish(error.status)),
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
          catch: (cause) =>
            new EngineReleaseError({
              message: Error.isError(cause) ? cause.message : String(cause),
              cause,
            }),
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
  const sharedEngine = yield* RcRef.make({
    acquire: Effect.gen(function* () {
      const loaded = yield* load();
      if (!loaded.ok) {
        yield* publish(loaded.status);
        return yield* new ManagedBinaryError({
          message: `The Resource Pack gave no ${binary.label}: ${loaded.status.kind}`,
          status: loaded.status,
        });
      }
      const engine = yield* start(loaded);
      yield* publish({ kind: "ready", version: loaded.version });
      return engine;
    }),
    idleTimeToLive: Duration.infinity,
  });
  yield* platform.changes.pipe(
    Stream.runForEach(() =>
      Effect.andThen(RcRef.invalidate(sharedEngine), checkChanged),
    ),
    Effect.forkScoped({ startImmediately: true }),
  );
  const getEngine = Effect.suspend(() =>
    closed
      ? Effect.succeed(null)
      : Effect.uninterruptible(RcRef.get(sharedEngine)),
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
