import type { ZoteroReadsClient } from "#contract/rpc.ts";
import { Effect } from "effect";
import type { FileSystem, Scope } from "effect";
import { RpcClient, RpcServer } from "effect/rpc";

import { makeInMemoryRpcProtocols } from "@zotlit/plugin-kernel/worker/effect-rpc-in-process.ts";

import type { Connection } from "./connection.ts";
import { handlersLayer } from "./handlers.ts";
import type { HandlersOptions } from "./handlers.ts";

import { ZoteroReads } from "#contract/rpc.ts";

export const makeInProcessClient = Effect.fnUntraced(function* (
  options: HandlersOptions,
): Effect.fn.Return<
  ZoteroReadsClient,
  never,
  Connection | FileSystem.FileSystem | Scope.Scope
> {
  const protocols = yield* makeInMemoryRpcProtocols;
  yield* RpcServer.make(ZoteroReads).pipe(
    Effect.provide(handlersLayer(options)),
    Effect.provideService(RpcServer.Protocol, protocols.server),
    Effect.forkScoped,
  );
  return yield* RpcClient.make(ZoteroReads).pipe(
    Effect.provideService(RpcClient.Protocol, protocols.client),
  );
});
