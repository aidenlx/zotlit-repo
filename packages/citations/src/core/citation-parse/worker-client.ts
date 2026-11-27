import * as BrowserWorker from "@effect/platform-browser/BrowserWorker";
import { Cause, Context, Effect, Layer, Option, Schema } from "effect";
import type { RpcMessage } from "effect/rpc";
import { RpcClient, RpcClientError } from "effect/rpc";
import { Worker } from "effect/workers";

import { CitationParseRpc } from "./rpc.ts";

const singleWorkerProtocol = RpcClient.Protocol.make(
  Effect.fnUntraced(function* (writeResponse, clientIds) {
    const platform = yield* Worker.WorkerPlatform;
    const worker = yield* platform.spawn<
      RpcMessage.FromServerEncoded,
      RpcMessage.FromClientEncoded
    >(0);
    const receive = (response: RpcMessage.FromServerEncoded) => {
      const id = clientIds.values().next().value;
      return id === undefined ? Effect.void : writeResponse(id, response);
    };
    yield* worker.run(receive).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) =>
          receive({
            _tag: "ClientProtocolError",
            error: new RpcClientError.RpcClientError({
              reason: new RpcClientError.RpcClientDefect({
                message: "Parse worker protocol failed",
                cause: Cause.squash(cause),
              }),
            }),
          }),
      ),
      Effect.forkScoped,
    );
    return {
      send: (_clientId: number, request: RpcMessage.FromClientEncoded) =>
        worker
          .send(request)
          .pipe(
            Effect.mapError(
              (error) =>
                new RpcClientError.RpcClientError({ reason: error.reason }),
            ),
          ),
      supportsAck: true,
      supportsTransferables: false,
      codecFor: Schema.toCodecJson,
    };
  }),
);

export const makeParseWorkerClient = Effect.fnUntraced(function* (
  spawn: () => Worker | MessagePort,
  measureEncoding?: () => ((payload: unknown) => void) | undefined,
) {
  const protocol = yield* Layer.build(
    Layer.effect(RpcClient.Protocol, singleWorkerProtocol).pipe(
      Layer.provide(BrowserWorker.layer(spawn)),
    ),
  );
  const transport = Context.get(protocol, RpcClient.Protocol);
  const measured = measureEncoding
    ? {
        ...transport,
        codecFor: <S extends Schema.Top>(schema: S) =>
          transport.codecFor(schema).pipe(
            Schema.middlewareEncoding((encode) =>
              Effect.suspend(() => {
                const end = measureEncoding();
                return end
                  ? encode.pipe(
                      Effect.tap((payload) =>
                        Effect.sync(() => end(Option.getOrUndefined(payload))),
                      ),
                    )
                  : encode;
              }),
            ),
          ),
      }
    : transport;
  return yield* RpcClient.make(CitationParseRpc, { disableTracing: true }).pipe(
    Effect.provideService(RpcClient.Protocol, measured),
  );
});
