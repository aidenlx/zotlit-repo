import type { EffectBridge } from "#effect-bridge.ts";
import { Cause, Context, Effect, Exit, Layer, Option } from "effect";
import type { HttpMethod } from "effect/http";
import {
  HttpBody,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
} from "effect/http";

import { AbortError } from "#abort-error.ts";

export const ZOTERO_ALLOWED_REQUEST: Readonly<Record<string, string>> = {
  "Zotero-Allowed-Request": "1",
};

export function zoteroOrigin(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export class ZoteroHttp extends Context.Service<
  ZoteroHttp,
  HttpClient.HttpClient
>()("zotlit/zotero-http/ZoteroHttp") {}

export function withZoteroHeaders(
  client: HttpClient.HttpClient,
): HttpClient.HttpClient {
  return HttpClient.mapRequest(
    client,
    HttpClientRequest.setHeaders(ZOTERO_ALLOWED_REQUEST),
  );
}

export const layerZoteroHttp: Layer.Layer<
  ZoteroHttp,
  never,
  HttpClient.HttpClient
> = Layer.effect(
  ZoteroHttp,
  Effect.map(HttpClient.HttpClient, (client) => withZoteroHeaders(client)),
);

export interface ZoteroRequest {
  readonly port: number;
  readonly path: string;
  readonly method?: ZoteroMethod;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export type ZoteroMethod = HttpMethod.HttpMethod;

export interface ZoteroAnswer {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

export function exchangeWithZotero(
  http: ZoteroHttp["Service"],
  { port, path, method = "GET", headers = {}, body }: ZoteroRequest,
): Effect.Effect<ZoteroAnswer, HttpClientError.HttpClientError> {
  const request = HttpClientRequest.make(method)(
    `${zoteroOrigin(port)}${path}`,
    {
      body:
        body === undefined
          ? undefined
          : HttpBody.raw(body, {
              contentLength: new TextEncoder().encode(body).byteLength,
            }),
    },
  ).pipe(HttpClientRequest.setHeaders(headers));
  return Effect.flatMap(http.execute(request), (response) =>
    Effect.map(response.text, (text) => ({
      status: response.status,
      headers: new Headers(response.headers),
      text,
    })),
  );
}

export type ZoteroRunner = Pick<EffectBridge, "runPromiseExit">;

export async function sendToZotero(
  runner: ZoteroRunner,
  http: ZoteroHttp["Service"],
  { signal, ...request }: ZoteroRequest & { readonly signal?: AbortSignal },
): Promise<ZoteroAnswer> {
  const exit = await runner.runPromiseExit(exchangeWithZotero(http, request), {
    signal,
  });
  if (Exit.isSuccess(exit)) return exit.value;
  if (signal?.aborted) throw new AbortError();
  const error = Option.getOrElse(Exit.findErrorOption(exit), () =>
    Cause.squash(exit.cause),
  );
  if (isTransportAbort(error)) throw new AbortError();
  throw new TypeError("fetch failed", {
    cause: transportReason(error),
  });
}

export function isTransportAbort(error: unknown): boolean {
  const reason = transportReason(error);
  const cause =
    typeof reason === "object" && reason !== null && "cause" in reason
      ? reason.cause
      : undefined;
  return isAbort(reason) || isAbort(cause);
}

function transportReason(error: unknown): unknown {
  return HttpClientError.isHttpClientError(error) ? error.reason : error;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
