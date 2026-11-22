import { FetchHttpClient, HttpClient } from "effect/http";

import { Effect, Layer } from "effect";

export function layerFakeFetch(
  fetch: typeof globalThis.fetch,
): Layer.Layer<HttpClient.HttpClient> {
  return FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
  );
}

export function fakeFetchClient(
  fetch: typeof globalThis.fetch,
): HttpClient.HttpClient {
  return Effect.runSync(
    Effect.provide(HttpClient.HttpClient, layerFakeFetch(fetch)),
  );
}
