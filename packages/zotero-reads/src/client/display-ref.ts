import type { DbUnavailable, SnapshotExpired } from "#contract/rpc.ts";
import { Effect, Stream } from "effect";
import type { RpcClientError } from "effect/rpc";

import type { getItemDisplayRefByID } from "@zotlit/db";

import type { ZoteroReadsApi } from "./service.ts";

export type ItemDisplayRef = NonNullable<
  ReturnType<typeof getItemDisplayRefByID>
>;

export const readDisplayRef = Effect.fn("readDisplayRef")(function* (
  reads: Pick<ZoteroReadsApi, "DisplayRefs">,
  itemID: number,
): Effect.fn.Return<
  ItemDisplayRef | null,
  DbUnavailable | SnapshotExpired | RpcClientError.RpcClientError
> {
  const slices = yield* Stream.runCollect(
    reads.DisplayRefs({ itemIDs: [itemID] }),
  );
  return slices.flat()[0]?.ref ?? null;
});
