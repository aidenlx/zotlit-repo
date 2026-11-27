import { Clock, Data, Duration, Effect, Schema } from "effect";

import type { ZoteroDatabase } from "@zotlit/db";
import {
  beginLibraryPass,
  committedLibraries,
  committedNotesAccess,
  committedVersion,
  completeLibraryPass,
  ensureSyncTables,
  hasStagedPasses,
  isGroupLastReadSetting,
  reconcileStagedLibraries,
  recordUnchanged,
  replaceStagedSettings,
  stageAccount,
  stageLibraryRemoval,
  stageObjects,
  stagedObjectVersions,
  stageSettings,
  storedGroupLastReadSettings,
  storedGroupVersions,
  storedObjectVersions,
} from "@zotlit/db/replica";
import type { ListedLibrary, RemoteLibrary } from "@zotlit/db/replica";
import { withLogCategory } from "@zotlit/shared/logging";
import type {
  WebApiCollection,
  WebApiGroup,
  WebApiItem,
  WebApiKey,
} from "@zotlit/zotero-types/web-api";

import {
  DeletionList,
  GroupRecord,
  KeyDescription,
  ObjectList,
  SettingList,
  VersionMap,
} from "./answers.ts";
import type {
  WebApiAnswer,
  WebApiClient,
  WebApiClientOptions,
} from "./api-client.ts";
import {
  isHeaderSafeKey,
  makeWebApiClient,
  MAX_CONCURRENT_REQUESTS,
} from "./api-client.ts";
import type { WebApiError, WebLibrarySyncError } from "./errors.ts";
import {
  describeStorageFailure,
  ReplicaStorageError,
  WebApiKeyInvalid,
  WebApiNoAccess,
  WebApiProtocolError,
} from "./errors.ts";

export const OBJECTS_PER_REQUEST = 50;
export const MAX_PASS_ATTEMPTS = 5;
export const RESTART_DELAYS_SECONDS = [2, 4, 8, 16] as const;

export type SyncObjectType = "collection" | "item";

export interface SyncProgress {
  readonly library: RemoteLibrary;
  readonly phase: "collections" | "items";
  readonly done: number;
  readonly total: number;
}

export interface DownloadOptions extends WebApiClientOptions {
  readonly onProgress?: (progress: SyncProgress) => void;
  readonly verified?: VerifiedKey | KeyLibraries;
  readonly rebuild?: boolean;
}

type PassMode = "incremental" | "compare" | "rebuild";

export interface VerifiedKey {
  readonly userID: number;
  readonly client: WebApiClient;
  readonly key: WebApiKey;
}

export interface KeyLibraries extends VerifiedKey {
  readonly readsLibraries: boolean;
  readonly groups: ReadonlyMap<number, number>;
}

export interface SyncAccount {
  readonly userID: number;
  readonly username: string;
}

export type LibraryDownload =
  | {
      readonly library: RemoteLibrary;
      readonly outcome: "unchanged";
      readonly version: number;
    }
  | {
      readonly library: RemoteLibrary;
      readonly outcome: "staged";
      readonly version: number;
      readonly fetched: number;
    }
  | { readonly library: RemoteLibrary; readonly outcome: "removed" }
  | {
      readonly library: RemoteLibrary;
      readonly outcome: "failed";
      readonly error: WebApiError | ReplicaStorageError;
    };

export interface DownloadReport {
  readonly account: SyncAccount;
  readonly libraries: readonly LibraryDownload[];
  readonly needsApply: boolean;
}

function storage<A>(run: () => A): Effect.Effect<A, ReplicaStorageError> {
  return Effect.try({
    try: run,
    catch: (cause) =>
      new ReplicaStorageError(
        describeStorageFailure(
          "The replica could not store the download",
          cause,
        ),
      ),
  });
}

function libraryPath(library: RemoteLibrary): string {
  return library.type === "user"
    ? `/users/${library.id}`
    : `/groups/${library.id}`;
}

function groupReadTimes(
  settings: Readonly<Record<string, { readonly value: unknown }>>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(settings)
      .filter(
        ([key, { value }]) =>
          isGroupLastReadSetting(key) && Number.isInteger(value),
      )
      .map(([key, { value }]) => [key, value as number]),
  );
}

function libraryLabel(library: RemoteLibrary): string {
  return `${library.type}:${library.id}`;
}

function readsGroup(key: WebApiKey, groupID: number): boolean {
  const groups = key.access.groups ?? {};
  return !!(groups.all?.library || groups[String(groupID)]?.library);
}

function decoded<S extends Schema.Top>(
  schema: S,
  { body, path, what }: { body: unknown; path: string; what: string },
): Effect.Effect<S["Type"], WebApiProtocolError> {
  return Schema.is(schema)(body)
    ? Effect.succeed(body)
    : Effect.fail(
        protocol(path, "body", `The answer to ${path} is not ${what}`),
      );
}

function protocol(
  path: string,
  reason: WebApiProtocolError["reason"],
  message: string,
): WebApiProtocolError {
  return new WebApiProtocolError({ message, path, reason });
}

class VersionChanged extends Data.TaggedError("VersionChanged") {}

function atAnchor(
  answer: WebApiAnswer,
  path: string,
  anchor: number,
): Effect.Effect<WebApiAnswer, WebApiProtocolError | VersionChanged> {
  if (answer.libraryVersion === null) {
    return Effect.fail(
      protocol(
        path,
        "missingVersion",
        `The answer to ${path} has no library version`,
      ),
    );
  }
  return answer.libraryVersion === anchor
    ? Effect.succeed(answer)
    : Effect.fail(new VersionChanged());
}

interface LibraryRun {
  readonly db: ZoteroDatabase;
  readonly client: WebApiClient;
  readonly library: RemoteLibrary;
  readonly group: WebApiGroup | undefined;
  readonly onProgress: ((progress: SyncProgress) => void) | undefined;
  readonly mode: PassMode;
  readonly notesAccess: boolean;
}

const fetchVersions = Effect.fnUntraced(function* (
  run: LibraryRun,
  objectType: SyncObjectType,
  { since, anchor }: { since: number; anchor: number },
) {
  const path = `${libraryPath(run.library)}/${objectType === "item" ? "items" : "collections"}`;
  const answer = yield* run.client.get({
    path,
    query: {
      format: "versions",
      since,
      ...(objectType === "item" ? { includeTrashed: 1 } : {}),
    },
  });
  yield* atAnchor(answer, path, anchor);
  return yield* decoded(VersionMap, {
    body: answer.body,
    path,
    what: "a version map",
  });
});

const fetchBatch = Effect.fnUntraced(function* (
  run: LibraryRun,
  objectType: SyncObjectType,
  { keys, anchor }: { keys: readonly string[]; anchor: number },
) {
  const plural = objectType === "item" ? "items" : "collections";
  const path = `${libraryPath(run.library)}/${plural}`;
  const found = new Map<string, WebApiItem | WebApiCollection>();
  let missing = [...keys];
  while (missing.length > 0) {
    const answer = yield* run.client.get({
      path,
      query: {
        [`${objectType}Key`]: missing.join(","),
        limit: missing.length,
        ...(objectType === "item" ? { includeTrashed: 1 } : {}),
      },
    });
    yield* atAnchor(answer, path, anchor);
    const list = (yield* decoded(ObjectList, {
      body: answer.body,
      path,
      what: "a list of objects",
    })) as readonly (WebApiItem | WebApiCollection)[];
    const requested = new Set(missing);
    const objects = list.filter((object) => requested.has(object.key));
    const total = Number(answer.headers.get("Total-Results"));
    const before = found.size;
    for (const object of objects) found.set(object.key, object);
    if (!Number.isInteger(total) || total <= list.length) break;
    if (found.size === before) {
      return yield* protocol(
        path,
        "truncated",
        `The answer to ${path} held ${list.length} of ${total} objects and gave no new one`,
      );
    }
    missing = missing.filter((key) => !found.has(key));
  }
  return [...found.values()];
});

const downloadObjects = Effect.fnUntraced(function* (
  run: LibraryRun,
  objectType: SyncObjectType,
  {
    versions,
    anchor,
  }: { versions: Readonly<Record<string, number>>; anchor: number },
) {
  const known = yield* storage(() =>
    (run.mode === "rebuild" ? stagedObjectVersions : storedObjectVersions)(
      run.db,
      run.library,
      objectType,
    ),
  );
  const wanted = Object.entries(versions)
    .filter(([key, version]) => known.get(key) !== version)
    .map(([key]) => key);
  const total = Object.keys(versions).length;
  let done = total - wanted.length;
  const phase = objectType === "item" ? "items" : "collections";
  const report = () =>
    run.onProgress?.({ library: run.library, phase, done, total });
  report();
  const batches: string[][] = [];
  for (let start = 0; start < wanted.length; start += OBJECTS_PER_REQUEST) {
    batches.push(wanted.slice(start, start + OBJECTS_PER_REQUEST));
  }
  yield* Effect.forEach(
    batches,
    (keys) =>
      Effect.gen(function* () {
        const objects = yield* fetchBatch(run, objectType, { keys, anchor });
        yield* storage(() =>
          stageObjects(
            run.db,
            run.library,
            objectType === "item"
              ? { items: objects as WebApiItem[] }
              : { collections: objects as WebApiCollection[] },
          ),
        );
        done += keys.length;
        report();
      }),
    { concurrency: MAX_CONCURRENT_REQUESTS, discard: true },
  );
  return wanted.length;
});

const fetchDeleted = Effect.fnUntraced(function* (
  run: LibraryRun,
  { since, anchor }: { since: number; anchor: number },
) {
  const path = `${libraryPath(run.library)}/deleted`;
  const answer = yield* run.client.get({ path, query: { since } });
  yield* atAnchor(answer, path, anchor);
  const {
    collections,
    items,
    settings = [],
  } = yield* decoded(DeletionList, {
    body: answer.body,
    path,
    what: "a deletion list",
  });
  return { collections, items, settings };
});

const stageAllSettings = (
  run: LibraryRun,
  remote: Readonly<Record<string, { readonly value: unknown }>>,
) =>
  storage(() => {
    const gone = storedGroupLastReadSettings(run.db).filter(
      (key) => !(key in remote),
    );
    replaceStagedSettings(run.db, run.library, {
      ...groupReadTimes(remote),
      ...Object.fromEntries(gone.map((key) => [key, null])),
    });
  });

const reconcile = Effect.fnUntraced(function* (
  run: LibraryRun,
  anchor: number,
) {
  yield* Effect.logDebug(
    "The deletion log starts after the stored version; the library is compared in full",
  ).pipe(Effect.annotateLogs({ library: libraryLabel(run.library) }));
  if (run.library.type === "user") {
    const path = `${libraryPath(run.library)}/settings`;
    const answer = yield* run.client.get({ path });
    yield* atAnchor(answer, path, anchor);
    yield* stageAllSettings(
      run,
      yield* decoded(SettingList, {
        body: answer.body,
        path,
        what: "a list of settings",
      }),
    );
  }
  return (yield* compareInFull(run, anchor)).deleted;
});

const compareInFull = Effect.fnUntraced(function* (
  run: LibraryRun,
  anchor: number,
) {
  const window = { since: 0, anchor };
  const deleted = { collections: [] as string[], items: [] as string[] };
  let fetched = 0;
  for (const objectType of ["collection", "item"] as const) {
    const versions = yield* fetchVersions(run, objectType, window);
    fetched += yield* downloadObjects(run, objectType, { versions, anchor });
    const local = yield* storage(() =>
      storedObjectVersions(run.db, run.library, objectType),
    );
    const gone = [...local.keys()].filter((key) => !(key in versions));
    (objectType === "item" ? deleted.items : deleted.collections).push(...gone);
  }
  return { deleted, fetched };
});

const runPass = Effect.fnUntraced(function* (run: LibraryRun) {
  const { db, client, library, group } = run;
  const since =
    run.mode === "incremental"
      ? ((yield* storage(() => committedVersion(db, library))) ?? 0)
      : 0;
  const settingsPath = `${libraryPath(library)}/settings`;
  const settings = yield* client.get(
    since > 0
      ? { path: settingsPath, query: { since }, ifModifiedSinceVersion: since }
      : { path: settingsPath },
  );
  if (settings.status === 304) {
    if (group === undefined) {
      const now = yield* Clock.currentTimeMillis;
      yield* storage(() =>
        recordUnchanged(
          db,
          library,
          Temporal.Instant.fromEpochMilliseconds(now),
        ),
      );
      return { outcome: "unchanged", version: since } as const;
    }
    yield* storage(() => {
      beginLibraryPass(db, {
        library,
        sinceVersion: since,
        targetVersion: since,
        group,
        notesAccess: run.notesAccess,
        rebuild: run.mode === "rebuild",
      });
      completeLibraryPass(db, library, { collections: [], items: [] });
    });
    return { outcome: "staged", version: since, fetched: 0 } as const;
  }
  if (settings.libraryVersion === null) {
    return yield* protocol(
      settingsPath,
      "missingVersion",
      `The answer to ${settingsPath} has no library version`,
    );
  }
  const anchor = settings.libraryVersion;
  yield* storage(() =>
    beginLibraryPass(db, {
      library,
      sinceVersion: since,
      targetVersion: anchor,
      group,
      notesAccess: run.notesAccess,
      rebuild: run.mode === "rebuild",
    }),
  );
  if (library.type === "user") {
    const changed = yield* decoded(SettingList, {
      body: settings.body,
      path: settingsPath,
      what: "a list of settings",
    });
    yield* run.mode === "incremental"
      ? storage(() =>
          replaceStagedSettings(db, library, groupReadTimes(changed)),
        )
      : stageAllSettings(run, changed);
  }
  if (run.mode !== "incremental") {
    const { deleted, fetched } = yield* compareInFull(run, anchor);
    yield* storage(() => completeLibraryPass(db, library, deleted));
    return { outcome: "staged", version: anchor, fetched } as const;
  }
  const window = { since, anchor };
  const collectionVersions = yield* fetchVersions(run, "collection", window);
  const itemVersions = yield* fetchVersions(run, "item", window);
  const collections = yield* downloadObjects(run, "collection", {
    versions: collectionVersions,
    anchor,
  });
  const items = yield* downloadObjects(run, "item", {
    versions: itemVersions,
    anchor,
  });
  const deleted = yield* fetchDeleted(run, window).pipe(
    Effect.catchIf(
      (error) =>
        error._tag === "WebApiProtocolError" &&
        error.reason === "deleteLogExpired",
      () => reconcile(run, anchor),
    ),
  );
  yield* storage(() => {
    if (library.type === "user" && "settings" in deleted) {
      stageSettings(
        db,
        library,
        Object.fromEntries(
          deleted.settings
            .filter(isGroupLastReadSetting)
            .map((key) => [key, null]),
        ),
      );
    }
    completeLibraryPass(db, library, deleted);
  });
  return {
    outcome: "staged",
    version: anchor,
    fetched: collections + items,
  } as const;
});

const syncLibrary = Effect.fnUntraced(function* (
  run: LibraryRun,
): Effect.fn.Return<LibraryDownload> {
  const label = libraryLabel(run.library);
  for (let attempt = 1; ; attempt++) {
    const result = yield* runPass(run).pipe(
      Effect.map((value): LibraryDownload => ({
        ...value,
        library: run.library,
      })),
      Effect.catchTag("VersionChanged", () =>
        attempt < MAX_PASS_ATTEMPTS
          ? Effect.as(
              Effect.logDebug(
                "The library changed during the sync; the pass starts again",
              ).pipe(
                Effect.annotateLogs({ library: label, attempt }),
                Effect.andThen(
                  Effect.sleep(
                    Duration.seconds(RESTART_DELAYS_SECONDS[attempt - 1]!),
                  ),
                ),
              ),
              null,
            )
          : Effect.fail(
              protocol(
                libraryPath(run.library),
                "libraryChanging",
                `The library ${label} changed during each of ${attempt} passes`,
              ),
            ),
      ),
      Effect.catch((error) =>
        Effect.as(
          Effect.logWarning("The library could not be downloaded").pipe(
            Effect.annotateLogs({ library: label, error: error.message }),
          ),
          { library: run.library, outcome: "failed", error } as LibraryDownload,
        ),
      ),
    );
    if (result !== null) return result;
  }
});

const checkKey = Effect.fnUntraced(function* (client: WebApiClient) {
  const path = "/keys/current";
  const answer = yield* client.get({ path }).pipe(
    Effect.catchTag("WebApiNoAccess", () =>
      Effect.fail(
        new WebApiKeyInvalid({
          message: "The Zotero Web API does not accept this API key",
        }),
      ),
    ),
  );
  return yield* decoded(KeyDescription, {
    body: answer.body,
    path,
    what: "a key description",
  });
});

const listGroups = Effect.fnUntraced(function* (
  client: WebApiClient,
  key: WebApiKey,
) {
  const groups = key.access.groups ?? {};
  if (!Object.values(groups).some((access) => access.library)) {
    return new Map<number, number>();
  }
  const path = `/users/${key.userID}/groups`;
  const answer = yield* client.get({ path, query: { format: "versions" } });
  const versions = yield* decoded(VersionMap, {
    body: answer.body,
    path,
    what: "a version map",
  });
  const listed = Object.keys(versions).length;
  const total = answer.headers.get("Total-Results");
  if (total === null || Number(total) !== listed) {
    return yield* protocol(
      path,
      "truncated",
      `The answer to ${path} held ${listed} groups and gave Total-Results ${total ?? "none"}`,
    );
  }
  return new Map(
    Object.entries(versions)
      .map(([id, version]) => [Number(id), version] as const)
      .filter(([id]) => readsGroup(key, id)),
  );
});

const fetchGroup = Effect.fnUntraced(function* (
  client: WebApiClient,
  groupID: number,
) {
  const path = `/groups/${groupID}`;
  const answer = yield* client.get({ path });
  const group = yield* decoded(GroupRecord, {
    body: answer.body,
    path,
    what: "a group",
  });
  if (group.id !== groupID) {
    return yield* protocol(
      path,
      "body",
      `The answer to ${path} is another group`,
    );
  }
  return group as WebApiGroup;
});

export const verifyKey = Effect.fnUntraced(function* (
  options: WebApiClientOptions,
): Effect.fn.Return<VerifiedKey, WebLibrarySyncError> {
  if (!isHeaderSafeKey(options.apiKey))
    return yield* new WebApiKeyInvalid({
      message: "The Zotero Web API does not accept this API key",
    });
  const client = yield* makeWebApiClient(options);
  const key = yield* checkKey(client);
  return { userID: key.userID, client, key };
});

export const listKeyLibraries = Effect.fnUntraced(function* (
  verified: VerifiedKey,
): Effect.fn.Return<KeyLibraries, WebLibrarySyncError> {
  const groups = yield* listGroups(verified.client, verified.key);
  return {
    ...verified,
    readsLibraries: !!verified.key.access.user?.library || groups.size > 0,
    groups,
  };
});

const hasGroups = (key: VerifiedKey | KeyLibraries): key is KeyLibraries =>
  "groups" in key;

export const downloadReplica = Effect.fnUntraced(
  function* (
    db: ZoteroDatabase,
    {
      onProgress,
      verified,
      rebuild = false,
      ...clientOptions
    }: DownloadOptions,
  ): Effect.fn.Return<DownloadReport, WebLibrarySyncError> {
    const checked = verified ?? (yield* verifyKey(clientOptions));
    const { client, key } = checked;
    yield* storage(() => ensureSyncTables(db));
    const readsUser = !!key.access.user?.library;
    const groupVersions = hasGroups(checked)
      ? checked.groups
      : yield* listGroups(client, key);
    if (!readsUser && groupVersions.size === 0) {
      return yield* new WebApiNoAccess({
        message:
          "The API key cannot read the personal library or any group library",
        path: "/keys/current",
      });
    }
    const account = { userID: key.userID, username: key.username };
    yield* storage(() => stageAccount(db, account));
    const listed: ListedLibrary[] = [
      ...(readsUser
        ? [
            {
              type: "user",
              id: key.userID,
              notesAccess: !!key.access.user?.notes,
            } as const,
          ]
        : []),
      ...[...groupVersions.keys()].map(
        (id) => ({ type: "group", id, notesAccess: true }) as const,
      ),
    ];
    yield* storage(() => reconcileStagedLibraries(db, { listed, rebuild }));

    const libraries: LibraryDownload[] = [];
    const stored = yield* storage(() => storedGroupVersions(db));
    const unread = yield* storage(() =>
      committedLibraries(db, key.userID).filter(
        (library) =>
          !listed.some(
            (read) => read.type === library.type && read.id === library.id,
          ),
      ),
    );
    for (const library of unread) {
      yield* storage(() => stageLibraryRemoval(db, library));
      libraries.push({ library, outcome: "removed" });
    }

    const runs: { library: RemoteLibrary; groupVersion?: number }[] = [
      ...(readsUser
        ? [{ library: { type: "user", id: key.userID } as const }]
        : []),
      ...[...groupVersions].map(([id, version]) => ({
        library: { type: "group", id } as const,
        groupVersion: version,
      })),
    ];
    for (const { library, groupVersion } of runs) {
      const group =
        groupVersion !== undefined && stored.get(library.id) !== groupVersion
          ? yield* fetchGroup(client, library.id).pipe(Effect.result)
          : undefined;
      if (group !== undefined && group._tag === "Failure") {
        libraries.push({ library, outcome: "failed", error: group.failure });
        continue;
      }
      const { notesAccess } = listed.find(
        (read) => read.type === library.type && read.id === library.id,
      )!;
      const mode = rebuild
        ? "rebuild"
        : yield* storage(() =>
            (committedVersion(db, library) ?? 0) > 0 &&
            committedNotesAccess(db, library) !== notesAccess
              ? "compare"
              : "incremental",
          );
      libraries.push(
        yield* syncLibrary({
          db,
          client,
          library,
          group: group?.success,
          onProgress,
          mode,
          notesAccess,
        }),
      );
    }
    const needsApply = yield* storage(() => hasStagedPasses(db));
    return { account, libraries, needsApply };
  },
  withLogCategory("zotlit", "web-library"),
);
