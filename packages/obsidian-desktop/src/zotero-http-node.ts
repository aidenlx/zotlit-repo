import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { Effect, Layer } from "effect";
import * as http from "node:http";
import * as https from "node:https";

import { layerZoteroHttp } from "@zotlit/plugin-kernel/zotero-http.ts";
import type { ZoteroHttp } from "@zotlit/plugin-kernel/zotero-http.ts";

const AGENT_OPTIONS = { keepAlive: true };

const layerAgent = Layer.effect(
  NodeHttpClient.HttpAgent,
  Effect.gen(function* () {
    let secure: https.Agent | undefined;
    const plain = yield* Effect.acquireRelease(
      Effect.sync(() => new http.Agent(AGENT_OPTIONS)),
      (agent) =>
        Effect.sync(() => {
          agent.destroy();
          secure?.destroy();
        }),
    );
    return {
      http: plain,
      get https() {
        return (secure ??= new https.Agent(AGENT_OPTIONS));
      },
    };
  }),
);

export const layerZoteroHttpNode: Layer.Layer<ZoteroHttp> =
  layerZoteroHttp.pipe(
    Layer.provide(NodeHttpClient.layerNodeHttpNoAgent),
    Layer.provide(layerAgent),
  );
