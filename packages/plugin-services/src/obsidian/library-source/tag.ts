import { Context } from "effect";
import type { Effect, Stream } from "effect";

import type { DeviceStorageError } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import type {
  DbUnavailable,
  ZoteroReadsClient,
} from "@zotlit/zotero-reads/contract/rpc.ts";

import type { LibrarySourceView } from "./status.ts";

export type LibrarySourceKind = "file" | "web-api";

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
    readonly syncNow: Effect.Effect<void, DbUnavailable>;
    readonly removeData: Effect.Effect<void, DbUnavailable>;
    replaceData(keyUserID: number): Effect.Effect<void, DbUnavailable>;
    readonly language: Effect.Effect<ZoteroLanguage>;
    readonly reads: ZoteroReadsClient | null;
  }
>()("zotlit/library-source/LibrarySource") {}
