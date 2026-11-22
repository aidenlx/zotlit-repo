import { Effect, Queue, Schema } from "effect";
import { RpcClient, RpcServer } from "effect/rpc";
import type { RpcMessage, RpcSerialization } from "effect/rpc";

const CLIENT_ID = 0;

export const makeInMemoryRpcProtocols = Effect.gen(function* () {
  let toServer: (
    message: RpcMessage.FromClientEncoded,
  ) => Effect.Effect<void> = () => Effect.void;
  let toClient: (
    message: RpcMessage.FromServerEncoded,
  ) => Effect.Effect<void> = () => Effect.void;
  let clientSideId = 0;
  const codecFor = Schema.toCodecJson as RpcSerialization.CodecFor;
  const disconnects = yield* Queue.make<number>();

  const server = yield* RpcServer.Protocol.make((writeRequest) => {
    toServer = (message) => writeRequest(CLIENT_ID, message);
    return Effect.succeed({
      disconnects,
      send: (_clientId: number, response: RpcMessage.FromServerEncoded) =>
        Effect.suspend(() => toClient(structuredClone(response))),
      end: () => Effect.void,
      clientIds: Effect.succeed(new Set([CLIENT_ID])),
      initialMessage: Effect.succeedNone,
      supportsAck: true,
      supportsTransferables: false,
      supportsSpanPropagation: false,
      supportsNotifications: false,
      codecFor,
    });
  });

  const client = yield* RpcClient.Protocol.make((writeResponse) => {
    toClient = (message) => writeResponse(clientSideId, message);
    return Effect.succeed({
      send: (clientId: number, request: RpcMessage.FromClientEncoded) =>
        Effect.suspend(() => {
          clientSideId = clientId;
          return toServer(structuredClone(request));
        }),
      supportsAck: true,
      supportsTransferables: false,
      codecFor,
    });
  });

  return { server, client };
});
