// The Profile Matches of Items, which ZotLit Query evaluates. Profile
// selection and the Template Workbench's Match tab test a Match through this
// port; the host fills it with its Item Query service.
import { Context } from "effect";
import type { Effect } from "effect";
import type { RpcClientError } from "effect/rpc";

import type { Item } from "@zotlit/db";
import type { Diagnostic } from "@zotlit/item-query";
import type { SnapshotExpired } from "@zotlit/zotero-reads/contract/rpc.ts";

export type MatchItem = Pick<Item, "key" | "groupID">;

/** Whether each filter holds for one Item, and each filter's Diagnostic. */
export interface ItemMatches {
  matched: readonly boolean[];
  faults: readonly (Diagnostic | undefined)[];
}

/** One query's test of many Items, by Indexed Key; a missing Item has none. */
export type BatchMatches =
  | { kind: "result"; byKey: ReadonlyMap<string, ItemMatches> }
  | { kind: "failed"; diagnostic?: Diagnostic };

/** What a read of ZotLit Query fails with. */
export type ItemMatchError = SnapshotExpired | RpcClientError.RpcClientError;

export class ItemMatchQuery extends Context.Service<
  ItemMatchQuery,
  {
    /**
     * Test each of `items` against each of `filters` in one Items query,
     * over the Libraries the Items belong to.
     */
    matches(
      items: readonly MatchItem[],
      filters: readonly string[],
    ): Effect.Effect<BatchMatches, ItemMatchError>;
    /**
     * The custom fields of the active Zotero source, by name; none when the
     * read is interrupted first.
     */
    readonly customFieldNames: Effect.Effect<readonly string[], ItemMatchError>;
  }
>()("zotlit/profile-selection/ItemMatchQuery") {}

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    ItemMatchQuery: ItemMatchQuery;
  }
}
