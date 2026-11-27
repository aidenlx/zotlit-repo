import { Clock, Duration, Effect, Redacted, Ref, Semaphore } from "effect";

import { ZOTERO_VOCABULARY } from "@zotlit/zotero-types/vocabulary";

import {
  WebApiNetworkError,
  WebApiNoAccess,
  WebApiProtocolError,
  WebApiRateLimited,
} from "./errors.ts";
import type { WebApiError } from "./errors.ts";

export type WebApiFetch = (
  url: string,
  init: {
    readonly method: "GET";
    readonly headers: Readonly<Record<string, string>>;
    readonly redirect: "error";
    readonly signal: AbortSignal;
  },
) => Promise<Response>;

export const ZOTERO_API_BASE_URL = "https://api.zotero.org";

const HEADER_SAFE_KEY = /^[\x21-\x7e]+$/;

export function isHeaderSafeKey(apiKey: Redacted.Redacted<string>): boolean {
  return HEADER_SAFE_KEY.test(Redacted.value(apiKey));
}
export const MAX_CONCURRENT_REQUESTS = 4;
export const RATE_LIMIT_DELAYS_SECONDS = [30, 60, 300] as const;
export const MAX_THROTTLED_ATTEMPTS = 5;
export const MAX_TRANSIENT_ATTEMPTS = 3;

export interface RequestPause {
  readonly until: Effect.Effect<number>;
  readonly extend: (until: number) => Effect.Effect<number>;
}

export const makeRequestPause: Effect.Effect<RequestPause> = Effect.map(
  Ref.make(0),
  (deadline) => ({
    until: Ref.get(deadline),
    extend: (until) =>
      Ref.updateAndGet(deadline, (before) => Math.max(before, until)),
  }),
);

export interface RequestPauses {
  readonly endpoint: RequestPause;
  readonly credential: RequestPause;
}

export interface WebApiClientOptions {
  readonly apiKey: Redacted.Redacted<string>;
  readonly fetch: WebApiFetch;
  readonly baseUrl?: string;
  readonly onWait?: (untilMillis: number) => void;
  readonly pauses?: RequestPauses;
}

export interface WebApiRequest {
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number>>;
  readonly ifModifiedSinceVersion?: number;
}

export interface WebApiAnswer {
  readonly status: 200 | 304;
  readonly headers: Headers;
  readonly body: unknown;
  readonly libraryVersion: number | null;
}

export interface WebApiClient {
  readonly get: (
    request: WebApiRequest,
  ) => Effect.Effect<WebApiAnswer, WebApiError>;
}

function wholeSeconds(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 0 ? seconds : undefined;
}

export const makeWebApiClient = Effect.fnUntraced(function* ({
  apiKey,
  fetch,
  baseUrl = ZOTERO_API_BASE_URL,
  onWait,
  pauses,
}: WebApiClientOptions) {
  const permits = yield* Semaphore.make(MAX_CONCURRENT_REQUESTS);
  const endpoint = pauses?.endpoint ?? (yield* makeRequestPause);
  const credential = pauses?.credential ?? (yield* makeRequestPause);
  const rateDelay = yield* Ref.make({ position: 0, burst: 0 });
  const nextRateDelay = (burst: number) =>
    Ref.modify(rateDelay, (state) =>
      state.burst === burst
        ? [
            RATE_LIMIT_DELAYS_SECONDS[
              Math.min(state.position, RATE_LIMIT_DELAYS_SECONDS.length - 1)
            ],
            { position: state.position + 1, burst: burst + 1 },
          ]
        : [undefined, state],
    );

  const pause = (deadline: RequestPause, seconds: number) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Effect.map(deadline.extend(now + seconds * 1000), (until) =>
        onWait?.(until),
      ),
    );

  const waitWhilePaused = Effect.gen(function* () {
    for (;;) {
      const now = yield* Clock.currentTimeMillis;
      const until = Math.max(yield* endpoint.until, yield* credential.until);
      if (now >= until) return;
      onWait?.(until);
      yield* Effect.sleep(Duration.millis(until - now));
    }
  });

  const send = (url: string, path: string, headers: Record<string, string>) =>
    permits.withPermit(
      Effect.andThen(
        waitWhilePaused,
        Effect.flatMap(Ref.get(rateDelay), ({ burst }) =>
          Effect.tryPromise({
            try: (signal) =>
              fetch(url, {
                method: "GET",
                headers: {
                  ...headers,
                  "Zotero-API-Key": Redacted.value(apiKey),
                },
                redirect: "error",
                signal,
              }).then(async (response) => ({
                response,
                burst,
                text: response.status === 304 ? "" : await response.text(),
              })),
            catch: (cause) =>
              new WebApiNetworkError({
                message: `The request to ${path} failed (${Error.isError(cause) ? cause.name : typeof cause})`,
                path,
              }),
          }),
        ),
      ),
    );

  const get = Effect.fnUntraced(function* ({
    path,
    query = {},
    ifModifiedSinceVersion,
  }: WebApiRequest): Effect.fn.Return<WebApiAnswer, WebApiError> {
    const search = new URLSearchParams(
      Object.entries(query).map(([name, value]) => [name, String(value)]),
    ).toString();
    const target = search ? `${path}?${search}` : path;
    const headers: Record<string, string> = {
      "Zotero-API-Version": "3",
      "Zotero-Schema-Version": String(ZOTERO_VOCABULARY.version),
    };
    if (ifModifiedSinceVersion !== undefined)
      headers["If-Modified-Since-Version"] = String(ifModifiedSinceVersion);

    let throttledAttempts = 0;
    let transientAttempts = 0;
    const retryTransient = Effect.fnUntraced(function* (status: number | null) {
      transientAttempts += 1;
      if (transientAttempts >= MAX_TRANSIENT_ATTEMPTS) return false;
      const seconds =
        RATE_LIMIT_DELAYS_SECONDS[
          Math.min(transientAttempts - 1, RATE_LIMIT_DELAYS_SECONDS.length - 1)
        ]!;
      yield* Effect.logDebug(
        "A request to the Zotero Web API failed; it runs again",
      ).pipe(Effect.annotateLogs({ path, status, seconds }));
      yield* Effect.sleep(Duration.seconds(seconds));
      return true;
    });
    for (;;) {
      const sent = yield* send(`${baseUrl}${target}`, path, headers).pipe(
        Effect.result,
      );
      if (sent._tag === "Failure") {
        if (yield* retryTransient(null)) continue;
        return yield* sent.failure;
      }
      const { response, burst, text } = sent.success;
      const backoff = wholeSeconds(response.headers.get("Backoff"));
      if (backoff !== undefined) {
        yield* Effect.logDebug("The Zotero Web API asked for a pause").pipe(
          Effect.annotateLogs({ path, seconds: backoff }),
        );
        yield* pause(endpoint, backoff);
      }
      const retryAfter = wholeSeconds(response.headers.get("Retry-After"));
      const throttled =
        response.status === 429 ||
        (response.status === 503 && retryAfter !== undefined);
      if (throttled) {
        throttledAttempts += 1;
        const seconds = retryAfter ?? (yield* nextRateDelay(burst));
        yield* Effect.logDebug(
          "The Zotero Web API limited the request rate",
        ).pipe(Effect.annotateLogs({ path, status: response.status, seconds }));
        if (seconds !== undefined)
          yield* pause(
            response.status === 429 ? credential : endpoint,
            seconds,
          );
        if (throttledAttempts >= MAX_THROTTLED_ATTEMPTS) {
          return yield* new WebApiRateLimited({
            message: `The Zotero Web API refused ${path} ${throttledAttempts} times for its rate limit`,
            path,
            attempts: throttledAttempts,
          });
        }
        continue;
      }
      if (response.status === 403 || response.status === 404) {
        return yield* new WebApiNoAccess({
          message: `The Zotero Web API answered ${response.status} to ${path}: the key cannot read it`,
          path,
        });
      }
      if (response.status === 409 && path.endsWith("/deleted")) {
        return yield* new WebApiProtocolError({
          message: `The deletion log of ${path} starts after the stored version`,
          path,
          reason: "deleteLogExpired",
          status: 409,
        });
      }
      if (response.status >= 500 && (yield* retryTransient(response.status))) {
        continue;
      }
      if (response.status !== 200 && response.status !== 304) {
        return yield* new WebApiProtocolError({
          message: `The Zotero Web API answered ${response.status} to ${path}`,
          path,
          reason: "status",
          status: response.status,
        });
      }
      const versionHeader = response.headers.get("Last-Modified-Version");
      const libraryVersion =
        versionHeader === null ? null : Number(versionHeader);
      yield* Ref.update(rateDelay, ({ burst }) => ({ position: 0, burst }));
      if (response.status === 304) {
        return {
          status: 304,
          headers: response.headers,
          body: null,
          libraryVersion,
        };
      }
      const body = yield* Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: () =>
          new WebApiProtocolError({
            message: `The answer to ${path} is not JSON`,
            path,
            reason: "body",
          }),
      });
      return { status: 200, headers: response.headers, body, libraryVersion };
    }
  });

  return { get } satisfies WebApiClient;
});
