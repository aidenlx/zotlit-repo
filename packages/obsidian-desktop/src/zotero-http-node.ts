// The Zotero loopback client over Node's own HTTP stack, for desktop only.

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { Effect, Layer } from "effect";
import * as http from "node:http";
import * as https from "node:https";

import { layerZoteroHttp } from "@zotlit/plugin-kernel/zotero-http.ts";
import type { ZoteroHttp } from "@zotlit/plugin-kernel/zotero-http.ts";

const AGENT_OPTIONS = { keepAlive: true };

/**
 * The agents of the client. Zotero's server speaks HTTP only, so the HTTPS
 * agent, and with it `node:https`, loads at the first HTTPS request.
 */
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

/**
 * {@link ZoteroHttp} over `node:http`, so a request leaves the process without
 * Chromium: no `Origin`, no user agent, no CORS check, and no proxy read from
 * the environment. An interrupt destroys the request.
 *
 * The agents keep connections alive, as Node's global agent did for the
 * `fetch` this replaces, so the `Connection` header on the wire is unchanged.
 * Never `layerUndici`: undici reads a proxy from the environment and stays out
 * of the bundle.
 */
export const layerZoteroHttpNode: Layer.Layer<ZoteroHttp> =
  layerZoteroHttp.pipe(
    Layer.provide(NodeHttpClient.layerNodeHttpNoAgent),
    Layer.provide(layerAgent),
  );
