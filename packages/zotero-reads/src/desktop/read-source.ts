import type { ConfiguredReadMode, EffectiveReadMode } from "#contract/rpc.ts";
import {
  Cause,
  Deferred,
  Duration,
  Effect,
  FileSystem,
  Ref,
  Schedule,
  Schema,
} from "effect";
import type { Scope, PlatformError } from "effect";
import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  reflink,
  ReflinkUnsupportedError,
} from "@zotlit/obsidian-desktop/reflink.ts";
import { ZOTERO_DB_READ_TEMP_PREFIX } from "@zotlit/plugin-kernel/constants.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log-category.ts";
import {
  isNotFound,
  isPlatformErrno,
  nodeFileSystemCall,
} from "@zotlit/plugin-kernel/errno.ts";

import { planReadParents } from "./read-parent.ts";
import { verifySnapshot } from "./snapshot-integrity.ts";

import { DbUnavailable } from "#contract/rpc.ts";

const CLONE_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 25;
const WAL_HEADER_BYTES = 32;
const JOURNAL_HEADER_BYTES = 8;
const HOT_JOURNAL_MIN_BYTES = 512n;
const JOURNAL_MAGIC = Buffer.from([
  0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7,
]);
const HASH_BUFFER_BYTES = 64 * 1024;

export type ReadFallbackReason = "reflink-unsupported" | "wal-not-replayed";

export interface SqliteUriOptions {
  mode?: "ro";
  immutable?: true;
}

export interface PreparedRead {
  path: string;
  uriOptions: SqliteUriOptions;
  effectiveMode: EffectiveReadMode;
  fallbackReason?: ReadFallbackReason;
}

export type MainIdentity =
  | { exists: false }
  | {
      exists: true;
      dev: bigint;
      ino: bigint;
      size: bigint;
      mtimeNs: bigint;
      ctimeNs: bigint;
      digest: string;
    };

export type WalGeneration =
  | { state: "absent" }
  | { state: "empty" }
  | { state: "unstable" }
  | { state: "present"; digest: string; header: Buffer; size: bigint };

type JournalGeneration =
  | { state: "absent" }
  | { state: "unstable" }
  | ({ state: "active" } & JournalIdentity)
  | ({ state: "inactive" } & JournalIdentity);

interface JournalIdentity {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
  ctimeNs: bigint;
  header: Buffer;
}

interface SourcePair {
  main: MainIdentity;
  wal: WalGeneration;
  journal: JournalGeneration;
}

export interface SourceFingerprint extends SourcePair {
  path: string;
}

type TempReadMode = "reflink" | "copy";

interface AcquiredRead {
  readonly read: PreparedRead;
  readonly release: Effect.Effect<void>;
}

const logDebug = (message: string, annotations: Record<string, unknown> = {}) =>
  Effect.logDebug(message).pipe(
    Effect.annotateLogs(annotations),
    withLogCategory("database", "read-source"),
  );

const logWarning = (
  message: string,
  error: unknown,
  annotations: Record<string, unknown> = {},
) =>
  Effect.logWarning(message, Cause.fail(error)).pipe(
    Effect.annotateLogs(annotations),
    withLogCategory("database", "read-source"),
  );

class UnstableSnapshotError extends Schema.TaggedError<
  UnstableSnapshotError,
  { readonly brand: unique symbol }
>()("UnstableSnapshotError", {}) {
  override get message(): string {
    return "Zotero database changed while preparing a read snapshot";
  }
}

class ReadSnapshotError extends Schema.TaggedError<
  ReadSnapshotError,
  { readonly brand: unique symbol }
>()("ReadSnapshotError", { message: Schema.String }) {}

function toDbUnavailable(cause: unknown): DbUnavailable {
  let error = cause;
  while (error instanceof Error && error.cause instanceof Error) {
    error = error.cause;
  }
  return new DbUnavailable({
    message: error instanceof Error ? error.message : String(error),
  });
}

function bigintStat(path: string) {
  return nodeFileSystemCall("stat", path, () => stat(path, { bigint: true }));
}

export function buildSqliteUri(
  dbPath: string,
  options: SqliteUriOptions,
): string {
  const url = pathToFileURL(dbPath);
  if (options.mode) url.searchParams.set("mode", options.mode);
  if (options.immutable) url.searchParams.set("immutable", "1");
  return url.href;
}

export const prepareRead = Effect.fnUntraced(function* (
  configuredMode: ConfiguredReadMode,
  sourcePath: string,
  owner?: string,
): Effect.fn.Return<
  PreparedRead,
  DbUnavailable,
  Scope.Scope | FileSystem.FileSystem
> {
  const pending = yield* makePendingRead();
  yield* Effect.addFinalizer(() => pending.cancel);
  yield* Effect.forkDetach(
    acquireRead(configuredMode, sourcePath, owner).pipe(
      Effect.matchEffect({
        onFailure: (error) => pending.fail(error),
        onSuccess: (acquired) => pending.complete(acquired),
      }),
    ),
  );
  return yield* pending.result;
});

const makePendingRead = Effect.fnUntraced(function* () {
  const deferred = yield* Deferred.make<PreparedRead, DbUnavailable>();
  const state = yield* Ref.make({
    canceled: false,
    release: null as Effect.Effect<void> | null,
  });
  const complete = (acquired: AcquiredRead) =>
    Effect.gen(function* () {
      const abandoned = yield* Ref.modify(state, (current) =>
        current.canceled
          ? [true, current]
          : [false, { ...current, release: acquired.release }],
      );
      if (abandoned) yield* acquired.release;
      else yield* Deferred.succeed(deferred, acquired.read);
    });
  return {
    result: Deferred.await(deferred),
    complete,
    fail: (error: PrepareReadError) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(state);
        if (!current.canceled)
          yield* Deferred.fail(deferred, toDbUnavailable(error));
      }),
    cancel: Effect.gen(function* () {
      const held = yield* Ref.modify(state, (current) => [
        current.release,
        { canceled: true, release: null },
      ]);
      if (held) yield* held;
    }),
  };
});

function acquireRead(
  configuredMode: ConfiguredReadMode,
  sourcePath: string,
  owner?: string,
): Effect.Effect<AcquiredRead, PrepareReadError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    if (configuredMode === "immutable") {
      const fallbackReason = yield* staleWalReason(sourcePath);
      const acquired = yield* prepareImmutableRead(sourcePath, owner);
      return fallbackReason
        ? {
            ...acquired,
            read: { ...acquired.read, fallbackReason },
          }
        : acquired;
    }
    if (configuredMode === "copy")
      return yield* prepareTempRead("copy", sourcePath, { owner });

    return yield* prepareTempRead("reflink", sourcePath, { owner }).pipe(
      Effect.catchIf(
        (error) => error instanceof ReflinkUnsupportedError,
        () =>
          prepareTempRead("copy", sourcePath, { owner }).pipe(
            Effect.map((acquired) => ({
              ...acquired,
              read: {
                ...acquired.read,
                fallbackReason: "reflink-unsupported" as const,
              },
            })),
          ),
      ),
    );
  });
}

export const staleWalReason = Effect.fnUntraced(
  function* (sourcePath: string) {
    const wal = yield* walGeneration(`${sourcePath}-wal`);
    return wal.state === "present" || wal.state === "unstable"
      ? "wal-not-replayed"
      : undefined;
  },
  Effect.mapError((cause) => toDbUnavailable(cause)),
);

const prepareImmutableRead = Effect.fnUntraced(function* (
  sourcePath: string,
  owner: string | undefined,
) {
  return yield* prepareTempRead("reflink", sourcePath, {
    includeWal: false,
    immutable: true,
    owner,
  }).pipe(
    Effect.catchIf(
      (error) => error instanceof ReflinkUnsupportedError,
      () =>
        prepareTempRead("copy", sourcePath, {
          includeWal: false,
          immutable: true,
          owner,
        }),
    ),
  );
});

const prepareTempRead = Effect.fnUntraced(function* (
  mode: TempReadMode,
  sourcePath: string,
  options: { includeWal?: boolean; immutable?: boolean; owner?: string } = {},
) {
  const plan = yield* planParents(sourcePath);
  const tryParent = (
    index: number,
  ): Effect.Effect<AcquiredRead, PrepareReadError, FileSystem.FileSystem> => {
    const parent = plan.parents[index];
    if (parent === undefined)
      return Effect.fail(
        new ReadSnapshotError({
          message: "No database read snapshot parent was available",
        }),
      );
    return cloneInto(sourcePath, { parent, mode, ...options }).pipe(
      Effect.tap(() =>
        logDebug("Prepared a database read snapshot", {
          parent,
          reason: plan.reason,
          afterFallback: index > 0,
          mode,
        }),
      ),
      Effect.catchIf(
        (error) =>
          index < plan.parents.length - 1 &&
          error instanceof SnapshotParentError,
        (error) =>
          logDebug("Database read snapshot parent unusable, falling back", {
            error,
            parent,
            reason: plan.reason,
          }).pipe(Effect.andThen(tryParent(index + 1))),
      ),
    );
  };
  return yield* tryParent(0);
});

class SnapshotParentError extends Schema.TaggedError<
  SnapshotParentError,
  { readonly brand: unique symbol }
>()("SnapshotParentError", { parent: Schema.String, cause: Schema.Defect() }) {
  override get message(): string {
    return `Cannot create a database read snapshot under ${this.parent}`;
  }
}

type PrepareReadError =
  | DbUnavailable
  | ReadSnapshotError
  | ReflinkUnsupportedError
  | SnapshotParentError
  | PlatformError.PlatformError;

const planParents = Effect.fnUntraced(function* (sourcePath: string) {
  const [tempDevice, databaseDevice] = yield* Effect.all([
    deviceId(tmpdir()),
    deviceId(dirname(sourcePath)),
  ]);
  return planReadParents({
    databasePath: sourcePath,
    tempDevice,
    databaseDevice,
  });
});

const deviceId = Effect.fnUntraced(function* (path: string) {
  return yield* bigintStat(path).pipe(
    Effect.map((stats) => stats.dev),
    Effect.catch((error) =>
      logDebug("Failed to read a volume id", { error, path }).pipe(
        Effect.as(0n),
      ),
    ),
  );
});

const cloneInto = Effect.fnUntraced(function* (
  sourcePath: string,
  {
    parent,
    mode,
    includeWal = true,
    immutable = false,
    owner,
  }: {
    parent: string;
    mode: TempReadMode;
    includeWal?: boolean;
    immutable?: boolean;
    owner?: string;
  },
) {
  const attempt = Effect.gen(function* () {
    const dir = yield* createSnapshotDir(parent, owner);
    return yield* cloneAttempt(sourcePath, {
      dir,
      mode,
      includeWal,
      immutable,
    }).pipe(
      Effect.onError(() => removeAttemptDir(dir)),
      Effect.catch((error) =>
        Effect.gen(function* () {
          const cloneUnsupported =
            mode === "reflink" && isNativeCloneCapabilityError(error);
          yield* logDebug("Database read snapshot attempt failed", {
            error,
            mode,
            parent,
            cloneUnsupported,
          });
          if (cloneUnsupported)
            return yield* new ReflinkUnsupportedError({ cause: error });
          if (isParentWriteFailure(error))
            return yield* new SnapshotParentError({ parent, cause: error });
          return yield* error;
        }),
      ),
    );
  });
  return yield* attempt.pipe(
    Effect.retry({
      schedule: Schedule.spaced(Duration.millis(RETRY_BACKOFF_MS)),
      times: CLONE_ATTEMPTS - 1,
      while: (error) => error instanceof UnstableSnapshotError,
    }),
    Effect.catchIf(
      (error) => error instanceof UnstableSnapshotError,
      () =>
        Effect.fail(
          new ReadSnapshotError({
            message: "Zotero database changed while preparing a read snapshot",
          }),
        ),
    ),
  );
});

const cloneAttempt = Effect.fnUntraced(function* (
  sourcePath: string,
  {
    dir,
    mode,
    includeWal,
    immutable,
  }: {
    dir: string;
    mode: TempReadMode;
    includeWal: boolean;
    immutable: boolean;
  },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = join(dir, basename(sourcePath));
  const walPath = `${sourcePath}-wal`;
  const journalPath = `${sourcePath}-journal`;
  const before = yield* snapshotPair(sourcePath, {
    walPath,
    journalPath,
    includeWal,
  });
  const observed = yield* Effect.gen(function* () {
    if (!journalIsSafe(before.journal)) return {};
    yield* Effect.all(
      [
        copySource(mode, sourcePath, path),
        includeWal && before.wal.state !== "absent"
          ? copySource(mode, walPath, `${path}-wal`)
          : Effect.void,
      ],
      { concurrency: "unbounded" },
    );
    const acquired = yield* snapshotPair(path, {
      walPath: `${path}-wal`,
      journalPath: `${path}-journal`,
      includeWal,
    });
    const after = yield* snapshotPair(sourcePath, {
      walPath,
      journalPath,
      includeWal,
    });
    return { acquired, after };
  });
  const matches =
    observed.after !== undefined &&
    observed.acquired !== undefined &&
    sourcePairsEqual(before, observed.after) &&
    sourcePairContentsEqual(before, observed.acquired);
  yield* logDebug("Database read snapshot fingerprint checked", {
    verdict: matches ? "unchanged" : "changed",
    beforeJournalState: before.journal.state,
    beforeWalState: before.wal.state,
    beforeWalSize: walGenerationSize(before.wal),
    acquiredWalState: observed.acquired?.wal.state,
    acquiredWalSize: walGenerationSize(observed.acquired?.wal),
    afterJournalState: observed.after?.journal.state,
    afterWalState: observed.after?.wal.state,
    afterWalSize: walGenerationSize(observed.after?.wal),
  });
  if (!matches) return yield* new UnstableSnapshotError();
  yield* verifySnapshot(path);
  const uriOptions: SqliteUriOptions = immutable
    ? { mode: "ro", immutable: true }
    : { mode: "ro" };
  const effectiveMode: EffectiveReadMode = immutable ? "immutable" : mode;
  return {
    read: {
      path,
      uriOptions,
      effectiveMode,
    },
    release: removeReadDir(dir).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
    ),
  };
});

const createSnapshotDir = Effect.fnUntraced(function* (
  parent: string,
  owner: string | undefined,
) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.makeDirectory(parent, { recursive: true }).pipe(
    Effect.andThen(
      fs.makeTempDirectory({
        directory: parent,
        prefix: `${ZOTERO_DB_READ_TEMP_PREFIX}${process.pid}-${owner ? `${owner}-` : ""}`,
      }),
    ),
    Effect.mapError((cause) => new SnapshotParentError({ parent, cause })),
  );
});

const PARENT_WRITE_ERRNOS: readonly string[] = ["ENOSPC", "EDQUOT", "EROFS"];

function isParentWriteFailure(error: unknown): boolean {
  return PARENT_WRITE_ERRNOS.some((code) => isPlatformErrno(error, code));
}

const copySource = Effect.fnUntraced(function* (
  mode: TempReadMode,
  sourcePath: string,
  targetPath: string,
) {
  if (mode === "copy") {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.copyFile(sourcePath, targetPath);
  }
  return yield* nodeFileSystemCall("reflink", targetPath, () =>
    reflink(sourcePath, targetPath),
  ).pipe(
    Effect.mapError((error) =>
      error.cause instanceof ReflinkUnsupportedError ? error.cause : error,
    ),
  );
});

export const snapshotSource = Effect.fnUntraced(
  function* (sourcePath: string) {
    const pair = yield* snapshotPair(sourcePath, {
      walPath: `${sourcePath}-wal`,
      journalPath: `${sourcePath}-journal`,
    });
    return { path: sourcePath, ...pair };
  },
  Effect.mapError((cause) => toDbUnavailable(cause)),
);

export function sourceFingerprintsEqual(
  a: SourceFingerprint,
  b: SourceFingerprint,
): boolean {
  return a.path === b.path && sourcePairsEqual(a, b);
}

const snapshotPair = Effect.fnUntraced(function* (
  sourcePath: string,
  {
    walPath,
    journalPath,
    includeWal = true,
  }: { walPath: string; journalPath: string; includeWal?: boolean },
) {
  const journalBefore = yield* journalGeneration(journalPath);
  const [main, wal] = yield* Effect.all([
    mainIdentity(sourcePath),
    includeWal
      ? walGeneration(walPath)
      : Effect.succeed({ state: "absent" } as const),
  ]);
  const journalAfter = yield* journalGeneration(journalPath);
  const journal = bracketedJournal(journalBefore, journalAfter);
  return { main, wal, journal };
});

function bracketedJournal(
  before: JournalGeneration,
  after: JournalGeneration,
): JournalGeneration {
  return journalGenerationsEqual(before, after)
    ? before
    : { state: "unstable" };
}

function sourcePairsEqual(a: SourcePair, b: SourcePair): boolean {
  return (
    mainIdentitiesEqual(a.main, b.main) &&
    walGenerationsEqual(a.wal, b.wal) &&
    journalIsSafe(a.journal) &&
    journalIsSafe(b.journal) &&
    journalGenerationsEqual(a.journal, b.journal)
  );
}

function sourcePairContentsEqual(a: SourcePair, b: SourcePair): boolean {
  return (
    mainContentsEqual(a.main, b.main) &&
    walGenerationsEqual(a.wal, b.wal) &&
    journalIsSafe(a.journal) &&
    journalIsSafe(b.journal)
  );
}

const mainIdentity = Effect.fnUntraced(function* (path: string) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const file = yield* openFile(path);
      const before = yield* fileStat(file);
      const digest = yield* fileDigest(file);
      const stats = yield* fileStat(file);
      if (!sameFileState(before, stats))
        return yield* new ReadSnapshotError({
          message: "SQLite database changed while it was fingerprinted",
        });
      return {
        exists: true,
        dev: stats.dev,
        ino: stats.ino,
        size: stats.size,
        mtimeNs: stats.mtimeNs,
        ctimeNs: stats.ctimeNs,
        digest,
      };
    }),
  ).pipe(
    Effect.catchReason("PlatformError", "NotFound", () =>
      Effect.succeed({ exists: false as const }),
    ),
  );
});

function mainIdentitiesEqual(a: MainIdentity, b: MainIdentity): boolean {
  if (!a.exists || !b.exists) return a.exists === b.exists;
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs &&
    a.digest === b.digest
  );
}

function mainContentsEqual(a: MainIdentity, b: MainIdentity): boolean {
  if (!a.exists || !b.exists) return a.exists === b.exists;
  return a.size === b.size && a.digest === b.digest;
}

const walGeneration = Effect.fnUntraced(function* (path: string) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const file = yield* openFile(path);
      const before = yield* fileStat(file);
      if (before.size === 0n) {
        const after = yield* fileStat(file);
        return after.size === 0n
          ? { state: "empty" as const }
          : { state: "unstable" as const };
      }

      const header = Buffer.alloc(WAL_HEADER_BYTES);
      const verification = Buffer.alloc(WAL_HEADER_BYTES);
      const firstRead = yield* fileRead(file, header, 0);
      const digest = yield* fileDigest(file);
      const secondRead = yield* fileRead(file, verification, 0);
      const after = yield* fileStat(file);
      if (
        firstRead.bytesRead === WAL_HEADER_BYTES &&
        secondRead.bytesRead === WAL_HEADER_BYTES &&
        sameFileState(before, after) &&
        header.equals(verification)
      ) {
        return {
          state: "present" as const,
          digest,
          header,
          size: after.size,
        };
      }
      return { state: "unstable" as const };
    }),
  ).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        isNotFound(error)
          ? { state: "absent" as const }
          : { state: "unstable" as const },
      ),
    ),
  );
});

function walGenerationsEqual(a: WalGeneration, b: WalGeneration): boolean {
  if (a.state !== b.state || a.state === "unstable") return false;
  if (a.state !== "present" || b.state !== "present") return true;
  return (
    a.size === b.size && a.header.equals(b.header) && a.digest === b.digest
  );
}

const journalGeneration = Effect.fnUntraced(function* (path: string) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const pathBefore = yield* bigintStat(path);
      const file = yield* openFile(path);
      const before = yield* fileStat(file);
      const header = Buffer.alloc(JOURNAL_HEADER_BYTES);
      const verification = Buffer.alloc(JOURNAL_HEADER_BYTES);
      const firstRead = yield* fileRead(file, header, 0);
      const secondRead = yield* fileRead(file, verification, 0);
      const after = yield* fileStat(file);
      const pathAfter = yield* bigintStat(path);
      if (
        !sameFileState(pathBefore, before) ||
        !sameFileState(before, after) ||
        !sameFileState(after, pathAfter) ||
        firstRead.bytesRead !== secondRead.bytesRead ||
        !header.equals(verification)
      ) {
        return { state: "unstable" as const };
      }
      const observedHeader = header.subarray(0, firstRead.bytesRead);
      return {
        state:
          after.size > HOT_JOURNAL_MIN_BYTES &&
          observedHeader.equals(JOURNAL_MAGIC)
            ? ("active" as const)
            : ("inactive" as const),
        dev: after.dev,
        ino: after.ino,
        size: after.size,
        mtimeNs: after.mtimeNs,
        ctimeNs: after.ctimeNs,
        header: observedHeader,
      };
    }),
  ).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        isNotFound(error)
          ? { state: "absent" as const }
          : { state: "unstable" as const },
      ),
    ),
  );
});

function journalIsSafe(journal: JournalGeneration): boolean {
  return journal.state === "absent" || journal.state === "inactive";
}

function journalGenerationsEqual(
  a: JournalGeneration,
  b: JournalGeneration,
): boolean {
  if (a.state !== b.state || a.state === "unstable" || b.state === "unstable")
    return false;
  if (a.state === "absent" || b.state === "absent") return true;
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs &&
    a.header.equals(b.header)
  );
}

function sameFileState(
  a: {
    dev: bigint;
    ino: bigint;
    size: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
  },
  b: {
    dev: bigint;
    ino: bigint;
    size: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
  },
): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs
  );
}

function openFile(path: string) {
  return Effect.acquireRelease(
    nodeFileSystemCall("open", path, () => open(path, "r")),
    (file) =>
      nodeFileSystemCall("close", path, () => file.close()).pipe(
        Effect.catch((error) =>
          logWarning("Failed to close a read source file", error, { path }),
        ),
      ),
  );
}

function fileStat(file: FileHandle) {
  return nodeFileSystemCall("stat", String(file.fd), () =>
    file.stat({ bigint: true }),
  );
}

function fileRead(file: FileHandle, buffer: Buffer, position: number) {
  return nodeFileSystemCall("read", String(file.fd), () =>
    file.read(buffer, 0, buffer.byteLength, position),
  );
}

const fileDigest = Effect.fnUntraced(function* (file: FileHandle) {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
  let position = 0;
  while (true) {
    const { bytesRead } = yield* fileRead(file, buffer, position);
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest("hex");
});

export function walGenerationSize(
  wal: WalGeneration | undefined,
): string | undefined {
  return wal?.state === "present" ? wal.size.toString() : undefined;
}

function isNativeCloneCapabilityError(error: unknown): boolean {
  if (error instanceof ReflinkUnsupportedError) return true;
  if (process.platform !== "darwin" && process.platform !== "linux") {
    return true;
  }
  return (
    isPlatformErrno(error, "EXDEV") ||
    isPlatformErrno(error, "ENOTSUP") ||
    isPlatformErrno(error, "EOPNOTSUPP")
  );
}

const removeReadDir = Effect.fnUntraced(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs
    .remove(path, { recursive: true, force: true })
    .pipe(
      Effect.catch((error) =>
        logWarning("Failed to remove database read temp", error, { path }),
      ),
    );
});

const removeAttemptDir = Effect.fnUntraced(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(path, { recursive: true, force: true }).pipe(
    Effect.catch((error) =>
      logWarning("Failed to remove failed database read temp", error, {
        path,
      }),
    ),
  );
});
