import { Effect, Layer, Option } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import type { HttpClientRequest } from "effect/http";
import { requestUrl } from "obsidian";
import type { RequestUrlParam, RequestUrlResponse } from "obsidian";

const NULL_BODY_STATUS: ReadonlySet<number> = new Set([
  101, 103, 204, 205, 304,
]);

export type RequestUrl = (
  request: RequestUrlParam,
) => Promise<RequestUrlResponse>;

export function requestUrlHttpClient(
  send: RequestUrl = requestUrl,
): HttpClient.HttpClient {
  return HttpClient.make((request, url) =>
    Effect.flatMap(requestBody(request), (body) =>
      Effect.tryPromise({
        try: async () => {
          const response = await send({
            url: url.href,
            method: request.method,
            headers: { ...request.headers },
            body: Option.getOrUndefined(body),
            throw: false,
          });
          return HttpClientResponse.fromWeb(
            request,
            webResponse(
              response.status,
              response.headers,
              response.arrayBuffer,
            ),
          );
        },
        catch: (cause) => transportError(request, cause),
      }),
    ),
  );
}

export const layerRequestUrlHttpClient: Layer.Layer<HttpClient.HttpClient> =
  Layer.sync(HttpClient.HttpClient, () => requestUrlHttpClient());

function requestBody(
  request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<Option.Option<string | ArrayBuffer>> {
  const { body } = request;
  switch (body._tag) {
    case "Empty":
      return Effect.succeedNone;
    case "Uint8Array":
      return Effect.succeedSome(new Uint8Array(body.body).buffer);
    case "Raw":
      if (typeof body.body === "string") return Effect.succeedSome(body.body);
  }
  return Effect.die(new Error(`requestUrl cannot send a ${body._tag} body`));
}

function webResponse(
  status: number,
  headers: Readonly<Record<string, string>>,
  body: ArrayBuffer,
): Response {
  return new Response(NULL_BODY_STATUS.has(status) ? null : body, {
    status,
    headers,
  });
}

function transportError(
  request: HttpClientRequest.HttpClientRequest,
  cause: unknown,
): HttpClientError.HttpClientError {
  return new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({ request, cause }),
  });
}
