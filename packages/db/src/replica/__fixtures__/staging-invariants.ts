import type { ZoteroDatabase } from "#client/database.ts";
import { sql } from "drizzle-orm";

import type { ReplicaObjectType } from "#replica/apply.ts";
import type { RemoteLibrary } from "#replica/sync-store.ts";

export type StagingRule =
  | "pass-has-target"
  | "idle-has-no-pass"
  | "group-pass-has-record"
  | "deletion-under-pass"
  | "pending-under-pass"
  | "setting-under-pass"
  | "skipped-records-vocabulary"
  | "account-differs"
  | "pass-is-listed"
  | "removal-is-unlisted"
  | "pass-is-current"
  | "apply-leaves-no-pass"
  | "apply-leaves-no-account"
  | "apply-leaves-no-deletion"
  | "apply-records-language";

export interface StagingViolation {
  readonly rule: StagingRule;
  readonly library: RemoteLibrary | null;
  readonly objectType?: ReplicaObjectType;
  readonly key?: string;
}

export interface StagingCheckOptions {
  readonly afterApply?: boolean;
  readonly listed?: readonly (RemoteLibrary & { readonly notesAccess?: boolean })[];
  readonly rebuild?: boolean;
}

export function stagingViolations(
  db: ZoteroDatabase,
  { afterApply = false, listed, rebuild }: StagingCheckOptions = {},
): StagingViolation[] {
  const applied = afterApply ? 1 : 0;
  const downloaded = listed === undefined ? 0 : 1;
  const libraries = JSON.stringify(
    (listed ?? []).map((library) => [
      library.type,
      library.id,
      library.notesAccess === undefined ? null : library.notesAccess ? 1 : 0,
    ]),
  );
  const rebuilt = rebuild === undefined ? null : rebuild ? 1 : 0;
  const isListed = sql`exists (select 1 from json_each(${libraries}) j
    where j.value ->> 0 = libraryType and j.value ->> 1 = remoteID)`;
  return db
    .all<{
      rule: StagingRule;
      libraryType: "user" | "group" | null;
      remoteID: number | null;
      objectType: ReplicaObjectType | null;
      key: string | null;
    }>(
      sql`select 'pass-has-target' as rule, libraryType, remoteID, null as objectType, null as key
          from replicaSyncLibraries where state in ('downloading', 'complete')
            and (targetVersion is null or targetNotesAccess is null or targetRebuild is null)
        union all select 'idle-has-no-pass', libraryType, remoteID, null, null
          from replicaSyncLibraries where state = 'idle'
            and (targetVersion is not null or targetNotesAccess is not null or targetRebuild is not null or groupJSON is not null)
        union all select 'group-pass-has-record', libraryType, remoteID, null, null
          from replicaSyncLibraries l where libraryType = 'group' and state = 'complete' and groupJSON is null
            and not exists (select 1 from groups g where g.groupID = l.remoteID)
        union all select 'setting-under-pass', s.libraryType, s.remoteID, null, s.key
          from replicaSyncSettings s left join replicaSyncLibraries l
            on l.libraryType = s.libraryType and l.remoteID = s.remoteID
          where s.libraryType != 'user' or l.state is null or l.state not in ('downloading', 'complete')
        union all select 'deletion-under-pass', d.libraryType, d.remoteID, d.objectType, d.key
          from replicaSyncDeletions d left join replicaSyncLibraries l
            on l.libraryType = d.libraryType and l.remoteID = d.remoteID
          where l.state is null or l.state not in ('complete', 'remove')
        union all select 'pending-under-pass', o.libraryType, o.remoteID, o.objectType, o.key
          from replicaSyncObjects o left join replicaSyncLibraries l
            on l.libraryType = o.libraryType and l.remoteID = o.remoteID
          where o.state = 'pending' and (l.state is null or l.state not in ('downloading', 'complete', 'remove'))
        union all select 'skipped-records-vocabulary', libraryType, remoteID, objectType, key
          from replicaSyncObjects where (state = 'skipped') != (vocabularyVersion is not null)
        union all select 'account-differs', null, null, null, null
          from replicaSyncAccount a
          where a.userID = (select value from settings where setting = 'account' and key = 'userID')
            and a.username = (select cast(value as text) from settings where setting = 'account' and key = 'username')
        union all select 'pass-is-listed', libraryType, remoteID, null, null
          from replicaSyncLibraries where ${downloaded} and state in ('downloading', 'complete') and not ${isListed}
        union all select 'removal-is-unlisted', libraryType, remoteID, null, null
          from replicaSyncLibraries where ${downloaded} and state = 'remove' and ${isListed}
        union all select 'pass-is-current', libraryType, remoteID, null, null
          from replicaSyncLibraries l where ${downloaded} and state in ('downloading', 'complete')
            and (exists (select 1 from json_each(${libraries}) j
                where j.value ->> 0 = l.libraryType and j.value ->> 1 = l.remoteID
                  and j.value ->> 2 is not null and j.value ->> 2 is not l.targetNotesAccess)
              or (${rebuilt} is not null and l.targetRebuild is not ${rebuilt}))
        union all select 'apply-leaves-no-pass', libraryType, remoteID, null, null
          from replicaSyncLibraries where ${applied} and state in ('complete', 'remove')
        union all select 'apply-leaves-no-account', null, null, null, null
          from replicaSyncAccount where ${applied}
        union all select 'apply-leaves-no-deletion', libraryType, remoteID, objectType, key
          from replicaSyncDeletions where ${applied}
        union all select 'apply-records-language', null, null, null, null
          where ${applied} and not exists (select 1 from replicaSyncMeta where key = 'zoteroLocale')
        order by rule, libraryType, remoteID, objectType, key`,
    )
    .map(({ rule, libraryType, remoteID, objectType, key }) => ({
      rule,
      library:
        libraryType === null
          ? null
          : { type: libraryType, id: Number(remoteID) },
      ...(objectType === null ? {} : { objectType }),
      ...(key === null ? {} : { key }),
    }));
}
