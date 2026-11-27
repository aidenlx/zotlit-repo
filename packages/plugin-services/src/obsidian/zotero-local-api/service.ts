import type {
  LocalApiAnnotation,
  LocalApiFailure,
  LocalApiResult,
  ZoteroReply,
} from "#core/zotero-local-api/wire.ts";
import type { DateTime } from "effect";
import { Context, Effect, Layer, PubSub, Stream } from "effect";

import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { filterTag, forkEach } from "@zotlit/plugin-kernel/effect-stream.ts";
import { ZoteroHttp } from "@zotlit/plugin-kernel/zotero-http.ts";

import type {
  AuthorizedSendOptions,
  LocalApiEvent,
  LocalApiSource,
  LocalApiState,
  WriteAuthorizationState,
} from "./session.ts";
import { makeLocalApiSession } from "./session.ts";
import type { WriteAuthorizationStore } from "./write-authorization.ts";

import { LocalServer } from "#core/local-server/service.ts";
import { resolvedChanged, ZoteroPref } from "#core/zotero-pref/service.ts";

export type {
  AuthorizationGrant,
  LocalApiAnnotation,
  LocalApiFailure,
  LocalApiResult,
} from "#core/zotero-local-api/wire.ts";
export type {
  AuthorizedSendOptions,
  LocalApiEvent,
  LocalApiSource,
  LocalApiState,
  WriteAuthorizationState,
} from "./session.ts";
export type {
  SecretStore,
  WriteAuthorizationStore,
} from "./write-authorization.ts";

export class ZoteroLocalApi extends Context.Service<
  ZoteroLocalApi,
  {
    readonly demandSource: Effect.Effect<LocalApiSource | null>;
    readonly state: Effect.Effect<LocalApiState>;
    readonly probe: Effect.Effect<void>;
    writeStateFor(
      attachmentKey: string | null,
    ): Effect.Effect<WriteAuthorizationState>;
    readonly remembered: Effect.Effect<boolean>;
    readonly authorize: Effect.Effect<LocalApiResult<void>>;
    readonly forgetAuthorization: Effect.Effect<void>;
    authorizedSend(
      path: string,
      options: AuthorizedSendOptions,
    ): Effect.Effect<LocalApiResult<ZoteroReply>>;
    writeLastRead(
      attachmentKey: string,
      serverID: string,
      instant: DateTime.Utc,
    ): Effect.Effect<void>;
    readAnnotation(
      annotationKey: string,
      attachmentKey: string,
    ): Effect.Effect<LocalApiResult<LocalApiAnnotation>>;
    listAnnotations(
      attachmentKey: string,
    ): Effect.Effect<LocalApiResult<readonly LocalApiAnnotation[]>>;
    readonly changes: Stream.Stream<void>;
    readonly capabilityChanges: Stream.Stream<void>;
    readonly writeRefusals: Stream.Stream<{
      readonly failure: LocalApiFailure;
      readonly library: string;
    }>;
    readonly serverChanges: Stream.Stream<string>;
    readonly writeRefusalsRetired: Stream.Stream<void>;
  }
>()("zotlit/zotero-local-api/ZoteroLocalApi") {}

export function layerZoteroLocalApi(options: {
  readonly credentials: WriteAuthorizationStore;
  readonly confirmGrant: Effect.Effect<boolean>;
}): Layer.Layer<ZoteroLocalApi, never, ZoteroPref | LocalServer | ZoteroHttp> {
  return Layer.effect(
    ZoteroLocalApi,
    Effect.gen(function* () {
      const pref = yield* ZoteroPref;
      const server = yield* LocalServer;
      const http = yield* ZoteroHttp;
      const bus = yield* PubSub.unbounded<LocalApiEvent>();
      yield* Effect.addFinalizer(() => PubSub.shutdown(bus));
      const { freshnessSignal, resolvedPathsMoved, ...api } =
        yield* makeLocalApiSession({
          http,
          httpPort: Effect.map(pref.current, ({ httpPort }) => httpPort),
          bus,
          credentials: options.credentials,
          confirmGrant: options.confirmGrant,
        });
      yield* forkEach(server.dbUpdated, () => freshnessSignal);
      yield* forkEach(resolvedChanged(pref), () => resolvedPathsMoved);

      const events = Stream.fromPubSub(bus);
      const byTag = <T extends LocalApiEvent["_tag"]>(tag: T) =>
        filterTag(events, tag);
      return ZoteroLocalApi.of({
        ...api,
        changes: byTag("changed").pipe(Stream.as(undefined)),
        capabilityChanges: byTag("capability-changed").pipe(
          Stream.as(undefined),
        ),
        writeRefusals: byTag("write-refused").pipe(
          Stream.map(({ failure, library }) => ({ failure, library })),
        ),
        serverChanges: byTag("server-changed").pipe(
          Stream.map(({ serverID }) => serverID),
        ),
        writeRefusalsRetired: byTag("write-refusals-retired").pipe(
          Stream.as(undefined),
        ),
      });
    }).pipe(withLogCategory("zotero-local-api")),
  );
}
