import { Context } from "effect";
import type { Effect, Stream } from "effect";

import type { DbUpdated, ImportMode, UpdateScope } from "@zotlit/protocol";

export interface ReaderTarget {
  itemID: number;
  attachmentID: number;
  selected: readonly number[];
}

export interface UpdateManyRequest {
  readonly items: number[];
  readonly scope: UpdateScope;
  readonly profileId?: string;
}

export interface ImportNotesRequest {
  readonly items: number[];
  readonly mode: ImportMode;
}

export class LocalServer extends Context.Service<
  LocalServer,
  {
    readonly available: Effect.Effect<boolean>;
    readonly availableChanges: Stream.Stream<boolean>;
    readonly effectivePort: Effect.Effect<number | null>;
    readonly effectivePortChanges: Stream.Stream<number | null>;
    readonly readerTarget: Effect.Effect<ReaderTarget | null>;
    readonly readerTargetChanges: Stream.Stream<ReaderTarget | null>;
    readonly readerClosed: Effect.Effect<boolean>;
    readonly readerClosedChanges: Stream.Stream<boolean>;
    readonly dbUpdated: Stream.Stream<DbUpdated>;
    readonly updateManyRequests: Stream.Stream<UpdateManyRequest>;
    readonly importNotesRequests: Stream.Stream<ImportNotesRequest>;
  }
>()("zotlit/local-server/LocalServer") {}
