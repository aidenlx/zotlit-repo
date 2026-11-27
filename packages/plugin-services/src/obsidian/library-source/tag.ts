import type { Effect, Stream } from "effect";
import { Context } from "effect";

import type { DeviceStorageError } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import type { UserCancelled } from "@zotlit/plugin-kernel/user-cancel.ts";
import type {
  DbUnavailable,
  ZoteroReadsClient,
} from "@zotlit/zotero-reads/contract/rpc.ts";
import type { WebSyncStatus } from "@zotlit/zotero-reads/contract/web-worker-rpc.ts";

import type { LibrarySourceView } from "./status.ts";
import type {
  OtherDataRefused,
  StoredReplicaFolder,
} from "./stored-replica.ts";

export type LibrarySourceKind = "file" | "web-api";

export type OtherDataScope = "gone-vaults" | "other-folders";

export interface OtherStoredReplicas {
  readonly scope: OtherDataScope;
  readonly folders: readonly StoredReplicaFolder[];
}

export type OtherDataView =
  | { readonly kind: "unread" }
  | ({ readonly kind: "listed" } & OtherStoredReplicas)
  | { readonly kind: "unreadable"; readonly message: string };

export interface ZoteroLanguage {
  readonly setting: string;
  readonly automatic: string;
  readonly effective: string;
}

export class LibrarySource extends Context.Service<
  LibrarySource,
  {
    readonly active: LibrarySourceKind;
    readonly view: Effect.Effect<LibrarySourceView>;
    readonly viewChanges: Stream.Stream<LibrarySourceView>;
    select(kind: LibrarySourceKind): Effect.Effect<void, DeviceStorageError>;
    readonly reload: Effect.Effect<void>;
    readonly keySecret: Effect.Effect<string | null>;
    selectKeySecret(name: string | null): Effect.Effect<void>;
    readonly syncNow: Effect.Effect<void, DbUnavailable | UserCancelled>;
    readonly stopSync: Effect.Effect<void>;
    readonly removeData: Effect.Effect<void, DbUnavailable>;
    replaceData(keyUserID: number): Effect.Effect<void, DbUnavailable>;
    readonly otherData: Effect.Effect<OtherDataView>;
    readonly otherDataChanges: Stream.Stream<OtherDataView>;
    readonly readOtherData: Effect.Effect<void>;
    removeOtherData(
      id: string,
    ): Effect.Effect<void, DbUnavailable | OtherDataRefused>;
    readonly language: Effect.Effect<ZoteroLanguage>;
    readonly syncStatus: Effect.Effect<WebSyncStatus, DbUnavailable>;
    readonly reads: ZoteroReadsClient | null;
  }
>()("zotlit/library-source/LibrarySource") {}
