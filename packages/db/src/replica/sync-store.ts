import type { ZoteroDatabase } from "#client/database.ts";
import { sql } from "drizzle-orm";

import type {
  WebApiCollection,
  WebApiGroup,
  WebApiItem,
} from "@zotlit/zotero-types/web-api";

import type {
  ReplicaObjectType,
  ReplicaOrphans,
  ReplicaProblem,
} from "./apply.ts";
import {
  applyRecords,
  findLibraryID,
  newReplicaOrphans,
  purgeOrphans,
  upsertGroupLibrary,
} from "./apply.ts";
import type { ReplicaAccount } from "./create.ts";
import { writeReplicaAccount } from "./create.ts";

import { USER_LIBRARY_ID } from "#lib/constants.ts";

export interface RemoteLibrary {
  readonly type: "user" | "group";
  readonly id: number;
}

export type SyncLibraryState = "idle" | "downloading" | "complete" | "remove";

export interface SyncLibraryStatus {
  readonly library: RemoteLibrary;
  readonly state: SyncLibraryState;
  readonly sinceVersion: number;
  readonly targetVersion: number | null;
  readonly committedVersion: number | null;
  readonly lastSync: Temporal.Instant | null;
  readonly retained: { readonly deferred: number; readonly skipped: number };
}

function where(library: RemoteLibrary) {
  return sql`libraryType = ${library.type} and remoteID = ${library.id}`;
}

export function committedVersion(
  db: ZoteroDatabase,
  library: RemoteLibrary,
): number | null {
  const libraryID = localLibraryID(db, library);
  if (libraryID === undefined) return null;
  const row = db.get<{ version: number }>(
    sql`select version from libraries where libraryID = ${libraryID}`,
  );
  return row === undefined ? null : Number(row.version);
}

function localLibraryID(
  db: ZoteroDatabase,
  library: RemoteLibrary,
): number | undefined {
  return library.type === "user"
    ? USER_LIBRARY_ID
    : findLibraryID(db, { type: "group", groupID: library.id });
}

export function storedGroupVersions(db: ZoteroDatabase): Map<number, number> {
  return new Map(
    db
      .all<{ groupID: number; version: number }>(
        sql`select groupID, version from groups`,
      )
      .map((row) => [Number(row.groupID), Number(row.version)]),
  );
}

export function storedObjectVersions(
  db: ZoteroDatabase,
  library: RemoteLibrary,
  objectType: ReplicaObjectType,
): Map<string, number> {
  const versions = new Map<string, number>();
  const libraryID = localLibraryID(db, library);
  if (libraryID !== undefined) {
    const table = objectType === "item" ? "items" : "collections";
    for (const row of db.all<{ key: string; version: number }>(
      sql`select key, version from ${sql.identifier(table)} where libraryID = ${libraryID}`,
    )) {
      versions.set(row.key, Number(row.version));
    }
  }
  for (const [key, version] of stagedObjectVersions(db, library, objectType))
    versions.set(key, version);
  return versions;
}

export function stagedObjectVersions(
  db: ZoteroDatabase,
  library: RemoteLibrary,
  objectType: ReplicaObjectType,
): Map<string, number> {
  return new Map(
    db
      .all<{ key: string; version: number }>(
        sql`select key, version from replicaSyncObjects where ${where(library)} and objectType = ${objectType}`,
      )
      .map((row) => [row.key, Number(row.version)]),
  );
}

export function stageAccount(
  db: ZoteroDatabase,
  { userID, username }: ReplicaAccount,
): void {
  const stored = new Map(
    db
      .all<{ key: string; value: unknown }>(
        sql`select key, value from settings where setting = 'account' and key in ('userID', 'username')`,
      )
      .map((row) => [row.key, String(row.value)]),
  );
  if (
    stored.get("userID") === String(userID) &&
    stored.get("username") === username
  ) {
    db.run(sql`delete from replicaSyncAccount`);
    return;
  }
  db.run(
    sql`insert into replicaSyncAccount (account, userID, username) values (1, ${userID}, ${username})
      on conflict (account) do update set userID = excluded.userID, username = excluded.username`,
  );
}

export interface LibraryPass {
  readonly library: RemoteLibrary;
  readonly sinceVersion: number;
  readonly targetVersion: number;
  readonly group?: WebApiGroup;
  readonly notesAccess?: boolean;
  readonly rebuild?: boolean;
}

export function committedNotesAccess(
  db: ZoteroDatabase,
  library: RemoteLibrary,
): boolean | null {
  const row = db.get<{ notesAccess: number | null }>(
    sql`select notesAccess from replicaSyncLibraries where ${where(library)}`,
  );
  return row?.notesAccess == null ? null : Number(row.notesAccess) === 1;
}

export function beginLibraryPass(
  db: ZoteroDatabase,
  {
    library,
    sinceVersion,
    targetVersion,
    group,
    notesAccess = true,
    rebuild = false,
  }: LibraryPass,
): void {
  db.transaction(() => {
    db.run(
      sql`insert into replicaSyncLibraries (libraryType, remoteID, state, sinceVersion, targetVersion, targetNotesAccess, targetRebuild, groupJSON)
        values (${library.type}, ${library.id}, 'downloading', ${sinceVersion}, ${targetVersion}, ${notesAccess ? 1 : 0}, ${rebuild ? 1 : 0},
          ${group ? JSON.stringify(group) : null})
        on conflict (libraryType, remoteID) do update set state = 'downloading', sinceVersion = excluded.sinceVersion,
          targetVersion = excluded.targetVersion, targetNotesAccess = excluded.targetNotesAccess,
          targetRebuild = excluded.targetRebuild, groupJSON = coalesce(excluded.groupJSON, groupJSON)`,
    );
    db.run(sql`delete from replicaSyncDeletions where ${where(library)}`);
  });
}

export function stageObjects(
  db: ZoteroDatabase,
  library: RemoteLibrary,
  objects: {
    readonly collections?: readonly WebApiCollection[];
    readonly items?: readonly WebApiItem[];
  },
): void {
  db.transaction(() => {
    for (const [objectType, list] of [
      ["collection", objects.collections ?? []],
      ["item", objects.items ?? []],
    ] as const) {
      for (const object of list) {
        db.run(
          sql`insert into replicaSyncObjects (libraryType, remoteID, objectType, key, version, state, parentKey, json)
            values (${library.type}, ${library.id}, ${objectType}, ${object.key}, ${object.version}, 'pending',
              ${parentKeyOf(object)}, ${JSON.stringify(object)})
            on conflict (libraryType, remoteID, objectType, key) do update set version = excluded.version,
              state = 'pending', vocabularyVersion = null, parentKey = excluded.parentKey, json = excluded.json`,
        );
      }
    }
  });
}

const GROUP_LAST_READ_RE = /^lastRead_g[0-9]+_[A-Z0-9]{8}$/;

export function isGroupLastReadSetting(key: string): boolean {
  return GROUP_LAST_READ_RE.test(key);
}

export function stageSettings(
  db: ZoteroDatabase,
  library: RemoteLibrary,
  settings: Readonly<Record<string, number | null>>,
): void {
  db.transaction(() => insertSettings(db, library, settings));
}

function insertSettings(
  db: ZoteroDatabase,
  library: RemoteLibrary,
  settings: Readonly<Record<string, number | null>>,
): void {
  for (const [key, value] of Object.entries(settings)) {
    db.run(
      sql`insert into replicaSyncSettings (libraryType, remoteID, key, value)
        values (${library.type}, ${library.id}, ${key}, ${value})
        on conflict (libraryType, remoteID, key) do update set value = excluded.value`,
    );
  }
}

export function replaceStagedSettings(
  db: ZoteroDatabase,
  library: RemoteLibrary,
  settings: Readonly<Record<string, number | null>>,
): void {
  db.transaction(() => {
    db.run(sql`delete from replicaSyncSettings where ${where(library)}`);
    insertSettings(db, library, settings);
  });
}

export function storedGroupLastReadSettings(db: ZoteroDatabase): string[] {
  return db
    .all<{ key: string }>(
      sql`select key from replicaSyncReadTimes order by key`,
    )
    .map((row) => row.key);
}

function commitReadTimes(db: ZoteroDatabase, library: RemoteLibrary): void {
  db.run(
    sql`delete from replicaSyncReadTimes where key in (
      select key from replicaSyncSettings where ${where(library)} and (value is null or value = 0))`,
  );
  db.run(
    sql`insert into replicaSyncReadTimes (key, lastRead)
      select key, value from replicaSyncSettings where ${where(library)} and value is not null and value != 0
      on conflict (key) do update set lastRead = excluded.lastRead`,
  );
  db.run(sql`delete from replicaSyncSettings where ${where(library)}`);
}

function writeGroupReadTimes(db: ZoteroDatabase): number {
  const result = db.run(
    sql`update itemAttachments set lastRead = setting.lastRead
      from (
        select a.itemID, r.lastRead
        from itemAttachments a join items i using (itemID) join groups g using (libraryID)
        left join replicaSyncReadTimes r on r.key = 'lastRead_g' || g.groupID || '_' || i.key
      ) as setting
      where itemAttachments.itemID = setting.itemID
        and itemAttachments.lastRead is not setting.lastRead`,
  ) as { changes?: number } | undefined;
  return Number(result?.changes ?? 0);
}

function parentKeyOf(object: WebApiCollection | WebApiItem): string | null {
  const data = object.data as {
    readonly parentCollection?: string | false;
    readonly parentItem?: string | false;
  };
  return data.parentCollection || data.parentItem || null;
}

export const DEFAULT_REPLICA_LOCALE = "en-US";

export class ReplicaLanguageMismatch extends Error {
  override readonly name = "ReplicaLanguageMismatch";
  readonly recorded: string;
  readonly asked: string;
  constructor(recorded: string, asked: string) {
    super(
      `The replica holds dates read in ${recorded}, and the apply asks for ${asked}`,
    );
    this.recorded = recorded;
    this.asked = asked;
  }
}

export function replicaLocale(db: ZoteroDatabase): string | null {
  const row = db.get<{ value: string }>(
    sql`select value from replicaSyncMeta where key = 'zoteroLocale'`,
  );
  return row === undefined ? null : row.value;
}

export function storedAccountUserID(db: ZoteroDatabase): number | undefined {
  const row = db.get<{ userID: unknown }>(
    sql`select userID from replicaSyncAccount where account = 1
      union all select value from settings where setting = 'account' and key = 'userID' limit 1`,
  );
  return row === undefined ? undefined : Number(row.userID);
}

export function completeLibraryPass(
  db: ZoteroDatabase,
  library: RemoteLibrary,
  deleted: {
    readonly collections: readonly string[];
    readonly items: readonly string[];
  },
): void {
  db.transaction(() => {
    db.run(sql`delete from replicaSyncDeletions where ${where(library)}`);
    for (const [objectType, keys] of [
      ["collection", deleted.collections],
      ["item", deleted.items],
    ] as const) {
      for (const key of keys) {
        db.run(
          sql`insert into replicaSyncDeletions (libraryType, remoteID, objectType, key)
            values (${library.type}, ${library.id}, ${objectType}, ${key}) on conflict do nothing`,
        );
      }
    }
    db.run(
      sql`update replicaSyncLibraries set state = 'complete' where ${where(library)}`,
    );
  });
}

export function committedLibraries(
  db: ZoteroDatabase,
  userID: number,
): RemoteLibrary[] {
  const user: RemoteLibrary = { type: "user", id: userID };
  return [
    ...((committedVersion(db, user) ?? 0) > 0 ? [user] : []),
    ...[...storedGroupVersions(db).keys()].map((id): RemoteLibrary => ({
      type: "group",
      id,
    })),
  ];
}

export function stageLibraryRemoval(
  db: ZoteroDatabase,
  library: RemoteLibrary,
): void {
  db.run(
    sql`insert into replicaSyncLibraries (libraryType, remoteID, state) values (${library.type}, ${library.id}, 'remove')
      on conflict (libraryType, remoteID) do update set state = 'remove'`,
  );
}

export interface ListedLibrary extends RemoteLibrary {
  readonly notesAccess: boolean;
}

export interface StagedSync {
  readonly listed: readonly ListedLibrary[];
  readonly rebuild: boolean;
}

export function reconcileStagedLibraries(
  db: ZoteroDatabase,
  { listed, rebuild }: StagedSync,
): void {
  const libraries = JSON.stringify(
    listed.map((library) => [
      library.type,
      library.id,
      library.notesAccess ? 1 : 0,
    ]),
  );
  const isListed = sql`exists (select 1 from json_each(${libraries}) j
    where j.value ->> 0 = l.libraryType and j.value ->> 1 = l.remoteID)`;
  const isCurrent = sql`exists (select 1 from json_each(${libraries}) j
    where j.value ->> 0 = l.libraryType and j.value ->> 1 = l.remoteID
      and j.value ->> 2 is l.targetNotesAccess and l.targetRebuild is ${rebuild ? 1 : 0})`;
  const stale = sql`select libraryType, remoteID from replicaSyncLibraries l
    where (state in ('downloading', 'complete') and not ${isCurrent}) or (state = 'remove' and ${isListed})`;
  const unread = sql`select libraryType, remoteID from replicaSyncLibraries l
    where libraryType = 'group' and not ${isListed} and not exists (select 1 from groups g where g.groupID = l.remoteID)`;
  db.transaction(() => {
    db.run(
      sql`delete from replicaSyncObjects where state = 'pending' and (libraryType, remoteID) in (${stale})`,
    );
    for (const table of ["replicaSyncDeletions", "replicaSyncSettings"]) {
      db.run(
        sql`delete from ${sql.identifier(table)} where (libraryType, remoteID) in (${stale})`,
      );
    }
    db.run(
      sql`update replicaSyncLibraries set state = 'idle', targetVersion = null, targetNotesAccess = null, targetRebuild = null,
          groupJSON = null where (libraryType, remoteID) in (${stale})`,
    );
    for (const table of ["replicaSyncObjects", "replicaSyncLibraries"]) {
      db.run(
        sql`delete from ${sql.identifier(table)} where (libraryType, remoteID) in (${unread})`,
      );
    }
    db.run(
      sql`delete from replicaSyncDeletions where (libraryType, remoteID) in (
        select libraryType, remoteID from replicaSyncLibraries where state = 'complete')`,
    );
    db.run(
      sql`update replicaSyncLibraries set state = 'downloading' where state = 'complete'`,
    );
  });
}

export function recordUnchanged(
  db: ZoteroDatabase,
  library: RemoteLibrary,
  now: Temporal.Instant,
): void {
  db.run(
    sql`insert into replicaSyncLibraries (libraryType, remoteID, state, sinceVersion, lastSync)
      values (${library.type}, ${library.id}, 'idle', 0, ${now.epochMilliseconds})
      on conflict (libraryType, remoteID) do update set lastSync = excluded.lastSync`,
  );
}

export function readSyncStatus(db: ZoteroDatabase): SyncLibraryStatus[] {
  return db
    .all<{
      libraryType: "user" | "group";
      remoteID: number;
      state: SyncLibraryState;
      sinceVersion: number;
      targetVersion: number | null;
      lastSync: number | null;
    }>(
      sql`select libraryType, remoteID, state, sinceVersion, targetVersion, lastSync from replicaSyncLibraries order by libraryType desc, remoteID`,
    )
    .map((row) => {
      const library: RemoteLibrary = {
        type: row.libraryType,
        id: Number(row.remoteID),
      };
      const retained = (state: string) =>
        Number(
          db.get<{ n: number }>(
            sql`select count(*) as n from replicaSyncObjects where ${where(library)} and state = ${state}`,
          )!.n,
        );
      return {
        library,
        state: row.state,
        sinceVersion: Number(row.sinceVersion),
        targetVersion:
          row.targetVersion === null ? null : Number(row.targetVersion),
        committedVersion: committedVersion(db, library),
        lastSync:
          row.lastSync === null
            ? null
            : Temporal.Instant.fromEpochMilliseconds(Number(row.lastSync)),
        retained: {
          deferred: retained("deferred"),
          skipped: retained("skipped"),
        },
      };
    });
}

export function hasStagedPasses(db: ZoteroDatabase): boolean {
  return (
    db.get(
      sql`select 1 from replicaSyncLibraries where state in ('complete', 'remove')
        union all select 1 from replicaSyncAccount limit 1`,
    ) !== undefined
  );
}

export interface AppliedLibrary {
  readonly library: RemoteLibrary;
  readonly outcome: "applied" | "removed";
  readonly version: number | null;
  readonly applied: number;
  readonly removed: number;
  readonly changed: boolean;
  readonly deferred: readonly ReplicaProblem[];
  readonly skipped: readonly ReplicaProblem[];
}

export const APPLY_PAGE_SIZE = 500;

export interface ApplyStagedOptions {
  readonly now: Temporal.Instant;
  readonly currentYear?: number;
  readonly locale?: string;
  readonly replacesLocale?: boolean;
  readonly pageSize?: number;
}

export interface ApplyStep {
  readonly applied: number;
  readonly total: number;
}

function drain<R>(steps: Generator<ApplyStep, R>): R {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

export function applyStagedPasses(
  db: ZoteroDatabase,
  options: ApplyStagedOptions,
): AppliedLibrary[] {
  return db.transaction(() => drain(applyStagedSteps(db, options)));
}

export function* applyStagedSteps(
  db: ZoteroDatabase,
  {
    now,
    currentYear,
    locale: asked,
    replacesLocale = false,
    pageSize = APPLY_PAGE_SIZE,
  }: ApplyStagedOptions,
): Generator<ApplyStep, AppliedLibrary[]> {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new RangeError(
      `The apply page size must be a positive integer, not ${pageSize}`,
    );
  }
  const recorded = replacesLocale ? null : replicaLocale(db);
  if (recorded !== null && asked !== undefined && asked !== recorded)
    throw new ReplicaLanguageMismatch(recorded, asked);
  const locale = recorded ?? asked ?? DEFAULT_REPLICA_LOCALE;
  if (recorded === null)
    db.run(
      sql`insert into replicaSyncMeta (key, value) values ('zoteroLocale', ${locale})
        on conflict (key) do update set value = excluded.value`,
    );
  const account = db.get<{ userID: number; username: string }>(
    sql`select userID, username from replicaSyncAccount where account = 1`,
  );
  if (account) {
    writeReplicaAccount(db, {
      userID: Number(account.userID),
      username: account.username,
    });
    db.run(sql`delete from replicaSyncAccount`);
  }
  const vocabularyVersion = Number(
    db.get<{ version: number }>(
      sql`select version from version where schema = 'globalSchema'`,
    )?.version ?? 0,
  );
  const rows = db.all<{
    libraryType: "user" | "group";
    remoteID: number;
    state: SyncLibraryState;
    targetVersion: number | null;
    targetRebuild: number | null;
    groupJSON: string | null;
  }>(
    sql`select libraryType, remoteID, state, targetVersion, targetRebuild, groupJSON from replicaSyncLibraries
      where state in ('complete', 'remove') order by libraryType desc, remoteID`,
  );
  const progress = {
    applied: 0,
    total: rows.reduce(
      (total, row) =>
        row.state === "complete"
          ? total +
            stagedWork(
              db,
              { type: row.libraryType, id: Number(row.remoteID) },
              vocabularyVersion,
            )
          : total,
      0,
    ),
  };
  for (const row of rows) {
    if (row.state !== "complete" || Number(row.targetRebuild) !== 1) continue;
    const libraryID = localLibraryID(db, {
      type: row.libraryType,
      id: Number(row.remoteID),
    });
    if (libraryID !== undefined)
      yield* clearLibrarySteps(db, libraryID, { pageSize, progress });
  }
  const results: AppliedLibrary[] = [];
  for (const row of rows) {
    const library: RemoteLibrary = {
      type: row.libraryType,
      id: Number(row.remoteID),
    };
    if (row.state === "remove") {
      results.push(yield* removeLibrary(db, { library, pageSize, progress }));
      continue;
    }
    results.push(
      yield* applyLibrary(db, {
        library,
        targetVersion: Number(row.targetVersion),
        group:
          row.groupJSON === null
            ? undefined
            : (JSON.parse(row.groupJSON) as WebApiGroup),
        vocabularyVersion,
        now,
        currentYear,
        locale,
        pageSize,
        progress,
      }),
    );
  }
  if (results.some((result) => result.outcome === "applied")) {
    const changed = writeGroupReadTimes(db);
    const owner = Math.max(
      results.findIndex((result) => result.library.type === "user"),
      0,
    );
    const counted = results[owner];
    if (changed > 0 && counted)
      results[owner] = {
        ...counted,
        applied: counted.applied + changed,
        changed: true,
      };
  }
  return results;
}

function stagedWork(
  db: ZoteroDatabase,
  library: RemoteLibrary,
  vocabularyVersion: number,
): number {
  const row = db.get<{ n: number }>(
    sql`select (select count(*) from replicaSyncObjects where ${where(library)}
        and (state != 'skipped' or vocabularyVersion < ${vocabularyVersion}))
      + (select count(*) from replicaSyncDeletions where ${where(library)}) as n`,
  );
  return Number(row?.n ?? 0);
}

function* applyLibrary(
  db: ZoteroDatabase,
  {
    library,
    targetVersion,
    group,
    vocabularyVersion,
    now,
    currentYear,
    locale,
    pageSize,
    progress,
  }: {
    library: RemoteLibrary;
    targetVersion: number;
    group: WebApiGroup | undefined;
    vocabularyVersion: number;
    now: Temporal.Instant;
    currentYear: number | undefined;
    locale: string | undefined;
    pageSize: number;
    progress: { applied: number } & ApplyStep;
  },
): Generator<ApplyStep, AppliedLibrary> {
  const renamed = group !== undefined && groupRecordDiffers(db, group);
  const libraryID =
    library.type === "user"
      ? USER_LIBRARY_ID
      : group
        ? upsertGroupLibrary(db, group)
        : findLibraryID(db, { type: "group", groupID: library.id });
  if (libraryID === undefined) {
    throw new Error(
      `The staged pass of group ${library.id} has no group record`,
    );
  }
  const deletions = db.all<{ objectType: ReplicaObjectType; key: string }>(
    sql`select objectType, key from replicaSyncDeletions where ${where(library)}`,
  );
  const plan = yield* planApply(db, { library, vocabularyVersion, progress });
  for (let start = 0; start < deletions.length; start += STAGING_CHUNK) {
    const page = deletions.slice(start, start + STAGING_CHUNK);
    for (const objectType of ["collection", "item"] as const) {
      const keys = page
        .filter((row) => row.objectType === objectType)
        .map((row) => row.key);
      if (keys.length === 0) continue;
      const planned = plan.get(objectType)!;
      for (const key of keys) {
        if (planned.delete(key)) progress.applied++;
      }
      db.run(
        sql`delete from replicaSyncObjects where ${where(library)} and objectType = ${objectType}
          and key in (select value from json_each(${JSON.stringify(keys)}))`,
      );
    }
    yield { ...progress };
  }
  const orphans = newReplicaOrphans();
  const options = {
    orphans,
    now,
    ...(currentYear === undefined ? {} : { currentYear }),
    ...(locale === undefined ? {} : { locale }),
  };
  const totals = { applied: 0, removed: 0 };
  const deferred: ReplicaProblem[] = [];
  const skipped: ReplicaProblem[] = [];
  for (const objectType of ["collection", "item"] as const) {
    const order = yield* applyOrder(plan.get(objectType)!, progress);
    for (let start = 0; start < order.length; start += pageSize) {
      const keys = order.slice(start, start + pageSize);
      const json = new Map(
        db
          .all<{ key: string; json: string }>(
            sql`select key, json from replicaSyncObjects where ${where(library)} and objectType = ${objectType}
              and key in (select value from json_each(${JSON.stringify(keys)}))`,
          )
          .map((row) => [row.key, row.json]),
      );
      const objects = keys.map(
        (key) => JSON.parse(json.get(key)!) as WebApiCollection & WebApiItem,
      );
      const result = applyRecords(
        db,
        objectType === "collection"
          ? { libraryID, collections: objects }
          : { libraryID, items: objects },
        options,
      );
      totals.applied +=
        result.applied.collections.length + result.applied.items.length;
      deferred.push(...result.deferred);
      skipped.push(...result.skipped);
      const states = new Map<string, "deferred" | "skipped">([
        ...result.deferred.map((problem) => [problem.key, "deferred"] as const),
        ...result.skipped.map((problem) => [problem.key, "skipped"] as const),
      ]);
      for (const object of objects) {
        progress.applied++;
        const state = states.get(object.key);
        const row = sql`${where(library)} and objectType = ${objectType} and key = ${object.key}`;
        if (state === undefined) {
          db.run(sql`delete from replicaSyncObjects where ${row}`);
        } else {
          db.run(
            sql`update replicaSyncObjects set state = ${state},
              vocabularyVersion = ${state === "skipped" ? vocabularyVersion : null} where ${row}`,
          );
        }
      }
      yield { ...progress };
    }
  }
  for (let start = 0; start < deletions.length; start += pageSize) {
    const page = deletions.slice(start, start + pageSize);
    const keysOf = (objectType: ReplicaObjectType) =>
      page.filter((row) => row.objectType === objectType).map((row) => row.key);
    const result = applyRecords(
      db,
      {
        libraryID,
        deleted: { collections: keysOf("collection"), items: keysOf("item") },
      },
      options,
    );
    totals.removed +=
      result.removed.collections.length + result.removed.items.length;
    progress.applied += page.length;
    yield { ...progress };
  }
  yield* purgeInSteps(db, orphans, progress);
  db.run(sql`delete from replicaSyncDeletions where ${where(library)}`);
  if (library.type === "user") commitReadTimes(db, library);
  db.run(
    sql`update libraries set version = ${targetVersion}, lastSync = ${Math.floor(now.epochMilliseconds / 1000)} where libraryID = ${libraryID}`,
  );
  db.run(
    sql`update replicaSyncLibraries set state = 'idle', sinceVersion = ${targetVersion}, targetVersion = null,
      notesAccess = targetNotesAccess, targetNotesAccess = null, targetRebuild = null, groupJSON = null,
      lastSync = ${now.epochMilliseconds}
      where ${where(library)}`,
  );
  return {
    library,
    outcome: "applied",
    version: targetVersion,
    applied: totals.applied,
    removed: totals.removed,
    changed: renamed || totals.applied > 0 || totals.removed > 0,
    deferred,
    skipped,
  };
}

function groupRecordDiffers(db: ZoteroDatabase, group: WebApiGroup): boolean {
  const stored = db.get<{ name: string; description: string }>(
    sql`select name, description from groups where groupID = ${group.id}`,
  );
  return (
    stored?.name !== group.data.name ||
    stored.description !== (group.data.description ?? "")
  );
}

const PURGE_CHUNK = 5000;
const STAGING_CHUNK = 1000;

function* purgeInSteps(
  db: ZoteroDatabase,
  orphans: ReplicaOrphans,
  progress: ApplyStep,
): Generator<ApplyStep> {
  const none = new Set<number>();
  for (const kind of ["valueIDs", "creatorIDs", "tagIDs"] as const) {
    const ids = [...orphans[kind]];
    for (let start = 0; start < ids.length; start += PURGE_CHUNK) {
      purgeOrphans(db, {
        valueIDs: none,
        creatorIDs: none,
        tagIDs: none,
        [kind]: new Set(ids.slice(start, start + PURGE_CHUNK)),
      });
      yield { ...progress };
    }
  }
}

const PLAN_CHUNK = 5000;

function* planApply(
  db: ZoteroDatabase,
  {
    library,
    vocabularyVersion,
    progress,
  }: {
    library: RemoteLibrary;
    vocabularyVersion: number;
    progress: ApplyStep;
  },
): Generator<ApplyStep, Map<ReplicaObjectType, Map<string, number>>> {
  const parents = new Map<ReplicaObjectType, Map<string, string | null>>([
    ["collection", new Map()],
    ["item", new Map()],
  ]);
  let after = { objectType: "", key: "" };
  for (;;) {
    const rows = db.all<{
      objectType: ReplicaObjectType;
      key: string;
      parentKey: string | null;
      state: string;
      vocabularyVersion: number | null;
    }>(
      sql`select objectType, key, parentKey, state, vocabularyVersion from replicaSyncObjects
        where ${where(library)} and (objectType, key) > (${after.objectType}, ${after.key})
        order by objectType, key limit ${PLAN_CHUNK}`,
    );
    for (const row of rows) {
      const eligible =
        row.state !== "skipped" ||
        Number(row.vocabularyVersion) < vocabularyVersion;
      if (eligible) parents.get(row.objectType)!.set(row.key, row.parentKey);
    }
    if (rows.length < PLAN_CHUNK) break;
    after = rows.at(-1)!;
    yield { ...progress };
  }
  const plan = new Map<ReplicaObjectType, Map<string, number>>();
  for (const [objectType, parentOf] of parents) {
    plan.set(objectType, yield* depthsByParentage(parentOf, progress));
  }
  return plan;
}

function* applyOrder(
  depths: ReadonlyMap<string, number>,
  progress: ApplyStep,
): Generator<ApplyStep, string[]> {
  const levels: string[][] = [];
  let counted = 0;
  for (const [key, depth] of depths) {
    (levels[depth] ??= []).push(key);
    if (++counted % PLAN_CHUNK === 0) yield { ...progress };
  }
  return levels.flat();
}

function* depthsByParentage(
  parentOf: ReadonlyMap<string, string | null>,
  progress: ApplyStep,
): Generator<ApplyStep, Map<string, number>> {
  const children = new Map<string, string[]>();
  const depths = new Map<string, number>();
  let level: string[] = [];
  let counted = 0;
  const tick = () => ++counted % PLAN_CHUNK === 0;
  for (const [key, parent] of parentOf) {
    if (parent === null || !parentOf.has(parent)) level.push(key);
    else {
      const siblings = children.get(parent);
      if (siblings) siblings.push(key);
      else children.set(parent, [key]);
    }
    if (tick()) yield { ...progress };
  }
  let depth = 0;
  while (level.length > 0) {
    const next: string[] = [];
    for (const key of level) {
      depths.set(key, depth);
      const below = children.get(key);
      for (const child of below ?? []) {
        next.push(child);
        if (tick()) yield { ...progress };
      }
      if (tick()) yield { ...progress };
    }
    level = next;
    depth++;
  }
  for (const key of parentOf.keys()) {
    if (!depths.has(key)) depths.set(key, depth);
    if (tick()) yield { ...progress };
  }
  const ordered = new Map<string, number>();
  for (const key of parentOf.keys()) {
    ordered.set(key, depths.get(key)!);
    if (tick()) yield { ...progress };
  }
  return ordered;
}

interface GroupRemoval {
  readonly pageSize: number;
  readonly progress: ApplyStep;
}

function* removeLibrary(
  db: ZoteroDatabase,
  {
    library,
    pageSize,
    progress,
  }: GroupRemoval & { readonly library: RemoteLibrary },
): Generator<ApplyStep, AppliedLibrary> {
  const removed =
    library.type === "group"
      ? yield* removeGroupSteps(db, library.id, { pageSize, progress })
      : yield* clearPersonalLibrarySteps(db, { pageSize, progress });
  db.run(sql`delete from replicaSyncSettings where ${where(library)}`);
  for (const table of ["replicaSyncObjects", "replicaSyncDeletions"] as const) {
    for (;;) {
      const batch = db.all<{ objectType: string; key: string }>(
        sql`select objectType, key from ${sql.identifier(table)} where ${where(library)} limit ${STAGING_CHUNK}`,
      );
      if (batch.length === 0) break;
      db.run(
        sql`delete from ${sql.identifier(table)} where ${where(library)} and (objectType, key) in (
          select value ->> 0, value ->> 1 from json_each(${JSON.stringify(batch.map((row) => [row.objectType, row.key]))}))`,
      );
      yield { ...progress };
    }
  }
  db.run(sql`delete from replicaSyncLibraries where ${where(library)}`);
  return {
    library,
    outcome: "removed",
    version: null,
    applied: 0,
    removed,
    changed: true,
    deferred: [],
    skipped: [],
  };
}

export function removeGroupLibrary(
  db: ZoteroDatabase,
  groupID: number,
): number {
  return drain(
    removeGroupSteps(db, groupID, {
      pageSize: APPLY_PAGE_SIZE,
      progress: { applied: 0, total: 0 },
    }),
  );
}

function* removeGroupSteps(
  db: ZoteroDatabase,
  groupID: number,
  removal: GroupRemoval,
): Generator<ApplyStep, number> {
  const libraryID = findLibraryID(db, { type: "group", groupID });
  if (libraryID === undefined) return 0;
  const removed = yield* clearLibrarySteps(db, libraryID, removal);
  db.run(sql`delete from groups where groupID = ${groupID}`);
  db.run(sql`delete from libraries where libraryID = ${libraryID}`);
  return removed;
}

function* clearPersonalLibrarySteps(
  db: ZoteroDatabase,
  removal: GroupRemoval,
): Generator<ApplyStep, number> {
  const removed = yield* clearLibrarySteps(db, USER_LIBRARY_ID, removal);
  db.run(
    sql`update itemAttachments set lastRead = null where lastRead is not null`,
  );
  db.run(sql`delete from replicaSyncReadTimes`);
  db.run(
    sql`update libraries set version = 0, lastSync = 0 where libraryID = ${USER_LIBRARY_ID}`,
  );
  return removed;
}

function* clearLibrarySteps(
  db: ZoteroDatabase,
  libraryID: number,
  { pageSize, progress }: GroupRemoval,
): Generator<ApplyStep, number> {
  const orphans = newReplicaOrphans();
  let removed = 0;
  for (const table of ["items", "collections"] as const) {
    let after: string | null = null;
    for (;;) {
      const keys: string[] = db
        .all<{ key: string }>(
          sql`select key from ${sql.identifier(table)} where libraryID = ${libraryID}
            ${after === null ? sql`` : sql`and key > ${after}`} order by key limit ${pageSize}`,
        )
        .map((row) => row.key);
      if (keys.length === 0) break;
      after = keys.at(-1)!;
      const result = applyRecords(
        db,
        {
          libraryID,
          deleted: table === "items" ? { items: keys } : { collections: keys },
        },
        { orphans },
      );
      removed +=
        result.removed.items.length + result.removed.collections.length;
      yield { ...progress };
    }
  }
  yield* purgeInSteps(db, orphans, progress);
  return removed;
}
