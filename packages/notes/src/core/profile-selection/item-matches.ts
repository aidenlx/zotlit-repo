import { Context } from "effect";
import type { Effect } from "effect";
import type { RpcClientError } from "effect/rpc";

import type { Item } from "@zotlit/db";
import type { Diagnostic } from "@zotlit/item-query";
import type { SnapshotExpired } from "@zotlit/zotero-reads/contract/rpc.ts";

export type MatchItem = Pick<Item, "key" | "groupID">;

export interface ItemMatches {
  matched: readonly boolean[];
  faults: readonly (Diagnostic | undefined)[];
}

export type BatchMatches =
  | { kind: "result"; byKey: ReadonlyMap<string, ItemMatches> }
  | { kind: "failed"; diagnostic?: Diagnostic };

export type ItemMatchError = SnapshotExpired | RpcClientError.RpcClientError;

export class ItemMatchQuery extends Context.Service<
  ItemMatchQuery,
  {
    matches(
      items: readonly MatchItem[],
      filters: readonly string[],
    ): Effect.Effect<BatchMatches, ItemMatchError>;
    readonly customFieldNames: Effect.Effect<readonly string[], ItemMatchError>;
  }
>()("zotlit/profile-selection/ItemMatchQuery") {}
