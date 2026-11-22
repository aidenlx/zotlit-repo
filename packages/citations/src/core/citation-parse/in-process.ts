import { Effect } from "effect";
import type { Scope } from "effect";
import { RpcClient, RpcServer } from "effect/rpc";
import type { RpcClientError, RpcGroup } from "effect/rpc";

import { makeInMemoryRpcProtocols } from "@zotlit/plugin-kernel/effect-rpc-in-process.ts";

import { decodeParseReply, ParseFailed } from "./client.ts";
import type { ParseClient } from "./client.ts";
import { layerParseHandlers } from "./handlers.ts";
import { CitationParseRpc } from "./rpc.ts";

export type ParseRpcClient = RpcClient.RpcClient<
  RpcGroup.Rpcs<typeof CitationParseRpc>,
  RpcClientError.RpcClientError
>;

export const makeInProcessClient = Effect.fnUntraced(
  function* (): Effect.fn.Return<ParseRpcClient, never, Scope.Scope> {
    const protocols = yield* makeInMemoryRpcProtocols;
    yield* RpcServer.make(CitationParseRpc, { disableTracing: true }).pipe(
      Effect.provide(layerParseHandlers),
      Effect.provideService(RpcServer.Protocol, protocols.server),
      Effect.forkScoped,
    );
    return yield* RpcClient.make(CitationParseRpc, {
      disableTracing: true,
    }).pipe(Effect.provideService(RpcClient.Protocol, protocols.client));
  },
);

export const inProcessParseClient: ParseClient = {
  parse: (request) =>
    Effect.flatMap(makeInProcessClient(), (client) =>
      client.Parse(request).pipe(
        Effect.mapError((error) => new ParseFailed({ message: String(error) })),
        Effect.flatMap((json) =>
          Effect.try({
            try: () => decodeParseReply(json),
            catch: (error) => new ParseFailed({ message: String(error) }),
          }),
        ),
      ),
    ).pipe(Effect.scoped),
};
