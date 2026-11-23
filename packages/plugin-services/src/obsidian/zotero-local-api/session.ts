import type {
  AuthorizationGrant,
  LocalApiAnnotation,
  LocalApiFailure,
  LocalApiResult,
  ZoteroReply,
} from "#core/zotero-local-api/wire.ts";
import {
  Cause,
  Deferred,
  DateTime,
  Duration,
  Effect,
  Exit,
  Fiber,
  PubSub,
  Ref,
  Semaphore,
} from "effect";
import * as v from "valibot";

import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import {
  exchangeWithZotero,
  isTransportAbort,
  parseJson,
  zoteroOrigin,
} from "@zotlit/plugin-kernel/zotero-http.ts";
import type {
  ZoteroHttp,
  ZoteroMethod,
} from "@zotlit/plugin-kernel/zotero-http.ts";
import { parseIndexedKey } from "@zotlit/zotero-types/keys";

import type { WriteAuthorizationStore } from "./write-authorization.ts";

import {
  API_VERSION,
  AUTHORIZE_PATH,
  classifyReply,
  CLIENT_NAME,
  invalid,
  isServerID,
  libraryPath,
  NO_CACHE_HEADERS,
  readAnnotationItem,
  readAnnotationPage,
  readGrant,
  totalResults,
} from "#core/zotero-local-api/wire.ts";

export type {
  AuthorizationGrant,
  LocalApiAnnotation,
  LocalApiFailure,
  LocalApiResult,
} from "#core/zotero-local-api/wire.ts";
export type {
  SecretStore,
  WriteAuthorizationStore,
} from "./write-authorization.ts";

const LOG_CATEGORY = "zotero-local-api";

const PAGE_SIZE = 100;

const PROBE_TIMEOUT = Duration.seconds(5);

export interface LocalApiSource {
  kind: "zotero-local-api";
  serverID: string;
}

export type LocalApiState =
  | { kind: "probing" }
  | {
      kind: "available";
      source: LocalApiSource;
      authorized: boolean;
    }
  | { kind: "unavailable"; failure: LocalApiFailure };

export interface WriteAuthorizationState {
  authorizing: boolean;
  libraryReadOnly: boolean;
  cooldownUntil: DateTime.Utc | null;
}

export type LocalApiEvent =
  | { readonly _tag: "changed" }
  | { readonly _tag: "capability-changed" }
  | {
      readonly _tag: "write-refused";
      readonly failure: LocalApiFailure;
      readonly library: string;
    }
  | { readonly _tag: "server-changed"; readonly serverID: string }
  | { readonly _tag: "write-refusals-retired" };

export interface AuthorizedSendOptions {
  library: string;
  expectedServerID?: string;
  silent?: boolean;
  method: ZoteroMethod;
  body?: string;
  headers?: Readonly<Record<string, string>>;
}

export interface LocalApiSessionDeps {
  http: ZoteroHttp["Service"];
  httpPort: Effect.Effect<number | null>;
  bus: PubSub.PubSub<LocalApiEvent>;
  credentials: WriteAuthorizationStore;
  confirmGrant: Effect.Effect<boolean>;
}

type ProbeState = LocalApiState | { kind: "unprobed" };

interface ProbeSlot {
  readonly done: Deferred.Deferred<void> | null;
  readonly moved: boolean;
  readonly stale: boolean;
}

type WriteBackPhase = "queued" | "reading" | "writing";

interface ReadQueue {
  readonly permits: Semaphore.Semaphore;
  users: number;
}

export const makeLocalApiSession = Effect.fnUntraced(function* ({
  http,
  httpPort,
  bus,
  credentials,
  confirmGrant,
}: LocalApiSessionDeps) {
  const scope = yield* Effect.scope;
  const state = yield* Ref.make<ProbeState>({ kind: "unprobed" });
  const announced = yield* Ref.make<ProbeState>({ kind: "unprobed" });
  const probeSlot = yield* Ref.make<ProbeSlot>({
    done: null,
    moved: false,
    stale: false,
  });
  const authorizing = yield* Ref.make<Deferred.Deferred<
    LocalApiResult<void>
  > | null>(null);
  const readOnlyLibraries = yield* Ref.make<ReadonlySet<string>>(new Set());
  const cooldownUntil = yield* Ref.make<DateTime.Utc | null>(null);
  const readQueues = new Map<string, ReadQueue>();

  const publish = (event: LocalApiEvent) =>
    PubSub.publish(bus, event).pipe(Effect.asVoid);

  const storedKey = (serverID: string) =>
    Effect.tryPromise(() => credentials.read(serverID)).pipe(Effect.orDie);
  const forgetKey = Effect.tryPromise(() => credentials.forget()).pipe(
    Effect.orDie,
  );
  const hasKey = (serverID: string) =>
    Effect.map(storedKey(serverID), (key) => key !== null);

  const heldServerID = Effect.map(Ref.get(state), (current) =>
    serverIDOf(current),
  );

  const setAuthorized = Effect.fnUntraced(function* (authorized: boolean) {
    const changed = yield* Ref.modify(
      state,
      (current): readonly [boolean, ProbeState] =>
        current.kind !== "available" || current.authorized === authorized
          ? [false, current]
          : [true, { ...current, authorized }],
    );
    if (changed) yield* publish({ _tag: "capability-changed" });
  });

  const send = Effect.fnUntraced(function* (
    path: string,
    options: {
      serverID: string | null;
      method?: ZoteroMethod;
      body?: string;
      headers?: Readonly<Record<string, string>>;
    },
  ): Effect.fn.Return<LocalApiResult<ZoteroReply>> {
    const port = yield* httpPort;
    if (port === null) {
      yield* Effect.logDebug(
        "Zotero runs on a port its profile cannot disclose",
      );
      return { failure: { kind: "unreachable" } };
    }
    const { serverID, method, body } = options;
    return yield* exchangeWithZotero(http, {
      port,
      path,
      method,
      body,
      headers: {
        ...NO_CACHE_HEADERS,
        ...(serverID !== null && { "Zotero-Server-ID": serverID }),
        ...options.headers,
      },
    }).pipe(
      Effect.map((reply): LocalApiResult<ZoteroReply> => {
        const failure = classifyReply(reply, serverID);
        return failure ? { failure } : { value: reply };
      }),
      Effect.catch((error): Effect.Effect<LocalApiResult<ZoteroReply>> =>
        isTransportAbort(error)
          ? Effect.succeed({ failure: { kind: "unknown-outcome" } })
          : Effect.logDebug("Zotero's HTTP server did not answer").pipe(
              Effect.annotateLogs({
                url: `${zoteroOrigin(port)}${path}`,
                error,
              }),
              Effect.as({ failure: { kind: "unreachable" } }),
            ),
      ),
    );
  });

  const sessionFrom = Effect.fnUntraced(function* (
    reply: ZoteroReply,
  ): Effect.fn.Return<ProbeState> {
    const version = reply.headers.get("zotero-api-version");
    if (version !== API_VERSION) {
      return { kind: "unavailable", failure: { kind: "incompatible-zotero" } };
    }
    const serverID = reply.headers.get("zotero-server-id");
    if (serverID === null) {
      return { kind: "unavailable", failure: { kind: "incompatible-zotero" } };
    }
    if (!isServerID(serverID)) {
      return { kind: "unavailable", failure: invalid(`server id ${serverID}`) };
    }
    yield* Effect.logDebug("Zotero answered its local API").pipe(
      Effect.annotateLogs({
        serverID,
        schemaVersion: reply.headers.get("zotero-schema-version"),
      }),
    );
    return {
      kind: "available",
      source: { kind: "zotero-local-api", serverID },
      authorized: yield* hasKey(serverID),
    };
  });

  const retireWriteRefusals = Effect.gen(function* () {
    const retired = yield* Ref.modify(
      readOnlyLibraries,
      (libraries): readonly [boolean, ReadonlySet<string>] =>
        libraries.size === 0 ? [false, libraries] : [true, new Set()],
    );
    if (retired) yield* publish({ _tag: "write-refusals-retired" });
  });

  const probe = Effect.fnUntraced(function* (reason: string, silent: boolean) {
    const previous = yield* Ref.get(state);
    const heldServerIDBefore = serverIDOf(previous);
    if (previous.kind === "unprobed")
      yield* Ref.set(state, { kind: "probing" });
    yield* retireWriteRefusals;
    yield* Ref.update(probeSlot, (slot) => ({ ...slot, stale: false }));
    const reply = yield* send("/api/", { serverID: null }).pipe(
      Effect.timeoutOrElse({
        duration: PROBE_TIMEOUT,
        orElse: () =>
          Effect.succeed<LocalApiResult<ZoteroReply>>({
            failure: { kind: "unknown-outcome" },
          }),
      }),
    );
    const next: ProbeState =
      "failure" in reply
        ? { kind: "unavailable", failure: probeFailure(reply.failure) }
        : yield* sessionFrom(reply.value);
    if ((yield* Ref.get(probeSlot)).stale) {
      yield* Effect.logDebug(
        "Zotero Local API probe discarded: the resolved paths moved",
      ).pipe(Effect.annotateLogs({ reason, answered: next }));
      return;
    }
    yield* Ref.set(state, next);
    yield* Effect.logDebug("Zotero Local API probed").pipe(
      Effect.annotateLogs({
        reason,
        was: previous.kind,
        state: next,
        ...("failure" in reply ? { answered: reply.failure } : {}),
      }),
    );
    if (!sameProbeState(yield* Ref.get(announced), next)) {
      yield* Ref.set(announced, next);
      yield* publish({ _tag: "capability-changed" });
    }
    const adopted = serverIDOf(next);
    if (
      adopted !== null &&
      heldServerIDBefore !== null &&
      adopted !== heldServerIDBefore
    ) {
      yield* Effect.logDebug("Another Zotero database answers this port").pipe(
        Effect.annotateLogs({ was: heldServerIDBefore, serverID: adopted }),
      );
      if (!silent)
        yield* publish({ _tag: "server-changed", serverID: adopted });
    }
  });

  const startProbe = Effect.fnUntraced(function* (
    reason: string,
    {
      moved = false,
      silent = false,
      stale = false,
    }: { moved?: boolean; silent?: boolean; stale?: boolean } = {},
  ) {
    const before = yield* heldServerID;
    const [done, started] = yield* Ref.modify(
      probeSlot,
      (
        slot,
      ): readonly [readonly [Deferred.Deferred<void>, boolean], ProbeSlot] => {
        if (slot.done !== null) {
          return [
            [slot.done, false],
            {
              ...slot,
              moved: slot.moved || moved,
              stale: slot.stale || stale,
            },
          ];
        }
        const fresh = Deferred.makeUnsafe<void>();
        return [
          [fresh, true],
          { ...slot, done: fresh, moved: slot.moved || moved },
        ];
      },
    );
    if (!started) return done;

    const settle = Effect.gen(function* () {
      yield* probe(reason, silent);
      for (;;) {
        const released = yield* Ref.modify(
          probeSlot,
          (slot): readonly [{ moved: boolean } | null, ProbeSlot] =>
            slot.stale
              ? [null, slot]
              : [
                  { moved: slot.moved },
                  { done: null, moved: false, stale: false },
                ],
        );
        if (released !== null) {
          const serverID = yield* heldServerID;
          if (serverID !== before || (released.moved && serverID !== null)) {
            yield* publish({ _tag: "changed" });
          }
          return;
        }
        yield* probe("resolved paths moved during a probe", silent);
      }
    }).pipe(
      Effect.onExit((exit) =>
        Ref.update(probeSlot, (slot) =>
          slot.done === done
            ? { done: null, moved: false, stale: false }
            : slot,
        ).pipe(Effect.andThen(Deferred.done(done, exit))),
      ),
    );
    yield* Effect.forkIn(settle, scope, { startImmediately: true });
    return done;
  });

  const reprobe = Effect.fnUntraced(function* (
    reason: string,
    options?: { moved?: boolean; silent?: boolean; stale?: boolean },
  ) {
    yield* Deferred.await(yield* startProbe(reason, options));
  });

  const refused = Effect.fnUntraced(function* (failure: LocalApiFailure) {
    if (failure.kind === "cooldown") {
      const now = yield* DateTime.now;
      yield* Ref.set(
        cooldownUntil,
        DateTime.addDuration(now, failure.retryAfter),
      );
      yield* publish({ _tag: "capability-changed" });
    }
    yield* Effect.logDebug("Zotero granted no write authorization").pipe(
      Effect.annotateLogs({ failure: failure.kind }),
    );
    return failure;
  });

  const cooling = Effect.gen(function* () {
    const until = yield* Ref.get(cooldownUntil);
    if (until === null) return null;
    const current = yield* DateTime.now;
    if (DateTime.isLessThanOrEqualTo(until, current)) {
      yield* Ref.set(cooldownUntil, null);
      return null;
    }
    const failure: LocalApiFailure = {
      kind: "cooldown",
      retryAfter: DateTime.distance(current, until),
    };
    return failure;
  });

  const granted = Effect.fnUntraced(function* (
    serverID: string,
    grant: AuthorizationGrant,
  ): Effect.fn.Return<LocalApiResult<void>> {
    if (!grant.remember) {
      yield* Effect.logDebug(
        "Zotero answered Allow, which ZotLit does not keep",
      ).pipe(Effect.annotateLogs({ serverID }));
      return { failure: { kind: "not-remembered" } };
    }
    if (!(yield* confirmGrant)) {
      yield* Effect.logDebug(
        "The researcher did not confirm the write authorization",
      ).pipe(Effect.annotateLogs({ serverID }));
      return { failure: { kind: "not-confirmed" } };
    }
    const saved = yield* Effect.tryPromise(() =>
      credentials.remember(serverID, grant.key),
    ).pipe(
      Effect.as(true),
      Effect.catch((failure) =>
        Effect.logWarning("The write authorization could not be saved").pipe(
          Effect.annotateLogs({ serverID, error: failure.cause }),
          Effect.as(false),
        ),
      ),
    );
    if (!saved) return { failure: { kind: "not-saved" } };
    yield* setAuthorized(true);
    return { value: undefined };
  });

  const authorizeBody: Effect.Effect<LocalApiResult<void>> = Effect.gen(
    function* () {
      const probing = yield* startProbe("authorization gesture");
      yield* Deferred.await(probing);
      const current = yield* Ref.get(state);
      if (current.kind !== "available") {
        return { failure: noSessionFailure(current) };
      }
      if (current.authorized) return { value: undefined };

      const cooldown = yield* cooling;
      if (cooldown) return { failure: cooldown };

      const { serverID } = current.source;
      yield* Effect.logDebug("Asking Zotero for a write authorization").pipe(
        Effect.annotateLogs({ serverID }),
      );
      const reply = yield* send(AUTHORIZE_PATH, {
        serverID,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appName: CLIENT_NAME }),
      });
      if ("failure" in reply) return { failure: yield* refused(reply.failure) };

      const grant = readGrant(reply.value.text);
      if ("failure" in grant) return grant;
      return yield* granted(serverID, grant.value);
    },
  );

  const request = Effect.gen(function* () {
    const [done, started] = yield* Ref.modify(
      authorizing,
      (
        slot,
      ): readonly [
        readonly [Deferred.Deferred<LocalApiResult<void>>, boolean],
        Deferred.Deferred<LocalApiResult<void>> | null,
      ] => {
        if (slot !== null) return [[slot, false], slot];
        const fresh = Deferred.makeUnsafe<LocalApiResult<void>>();
        return [[fresh, true], fresh];
      },
    );
    if (started) {
      yield* publish({ _tag: "capability-changed" });
      yield* authorizeBody.pipe(
        Effect.onExit((exit) =>
          Ref.set(authorizing, null).pipe(
            Effect.andThen(Deferred.done(done, exit)),
            Effect.andThen(publish({ _tag: "capability-changed" })),
          ),
        ),
        Effect.forkIn(scope, { startImmediately: true }),
      );
    }
    return yield* Deferred.await(done);
  });

  const writeRefused = Effect.fnUntraced(function* (
    failure: LocalApiFailure,
    library: string,
    silent = false,
  ) {
    if (!silent) yield* publish({ _tag: "write-refused", failure, library });
    if (
      failure.kind === "incompatible-zotero" ||
      failure.kind === "server-changed"
    ) {
      const probing = yield* startProbe(`a write met ${failure.kind}`, {
        silent,
      });
      if (silent) yield* Deferred.await(probing);
    }
    if (failure.kind === "unauthorized") {
      yield* Effect.logDebug(
        "Zotero no longer honours this write authorization",
      );
      yield* forgetKey;
      yield* setAuthorized(false);
      return;
    }
    if (failure.kind === "library-read-only") {
      yield* Effect.logDebug("Zotero refuses writes to this library").pipe(
        Effect.annotateLogs({ library }),
      );
      yield* Ref.update(readOnlyLibraries, (libraries) =>
        new Set(libraries).add(library),
      );
      yield* publish({ _tag: "capability-changed" });
    }
  });

  const report = Effect.fnUntraced(function* (result: {
    failure: LocalApiFailure;
  }) {
    const { failure } = result;
    if (failure.kind === "unknown-outcome") return result;
    yield* Effect.logDebug("The Zotero Local API stopped answering").pipe(
      Effect.annotateLogs({ failure }),
    );
    yield* Ref.set(state, { kind: "unavailable", failure });
    yield* publish({ _tag: "changed" });
    return result;
  });

  const writeBackSkipped = (attachmentKey: string, reason: string) =>
    Effect.logTrace("Read write-back skipped").pipe(
      Effect.annotateLogs({ attachmentKey, reason }),
    );

  const queued = <A, E, R>(target: string, work: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const queue = readQueues.get(target) ?? {
          permits: Semaphore.makeUnsafe(1),
          users: 0,
        };
        queue.users += 1;
        readQueues.set(target, queue);
        return queue;
      }),
      (queue) => queue.permits.withPermit(work),
      (queue) =>
        Effect.sync(() => {
          queue.users -= 1;
          if (queue.users === 0) readQueues.delete(target);
        }),
    );

  const writeLastReadNow = Effect.fnUntraced(function* ({
    attachmentKey,
    serverID,
    instant,
    phase,
  }: {
    attachmentKey: string;
    serverID: string;
    instant: DateTime.Utc;
    phase: Ref.Ref<WriteBackPhase>;
  }) {
    const parsed = parseIndexedKey(attachmentKey);
    if (!parsed || parsed.groupID !== null) {
      yield* writeBackSkipped(attachmentKey, "not a personal attachment");
      return;
    }
    const current = yield* Ref.get(state);
    const unwritable = unwritableReason(current, serverID);
    if (unwritable !== null) {
      yield* writeBackSkipped(attachmentKey, unwritable);
      return;
    }
    if ((yield* Ref.get(readOnlyLibraries)).has("users/0")) {
      yield* writeBackSkipped(attachmentKey, "read-only library");
      return;
    }
    if (!(yield* hasKey(serverID))) {
      if ((yield* heldServerID) === serverID) yield* setAuthorized(false);
      yield* writeBackSkipped(attachmentKey, "missing authorization");
      return;
    }
    if ((yield* heldServerID) !== serverID) {
      yield* writeBackSkipped(attachmentKey, "source changed");
      return;
    }
    const path = `/api/users/0/items/${parsed.key}`;
    yield* Ref.set(phase, "reading");
    const reply = yield* send(path, { serverID });
    if ((yield* heldServerID) !== serverID) {
      yield* writeBackSkipped(attachmentKey, "source changed");
      return;
    }
    if ("failure" in reply) {
      yield* Effect.logTrace("Read write-back refused").pipe(
        Effect.annotateLogs({ attachmentKey, reason: reply.failure.kind }),
      );
      if (reply.failure.kind === "server-changed") {
        yield* writeRefused(reply.failure, "users/0", true);
      } else {
        yield* report(reply);
      }
      return;
    }
    const item = v.safeParse(
      v.object({
        key: v.literal(parsed.key),
        version: v.pipe(v.number(), v.integer(), v.minValue(0)),
        library: v.object({ type: v.literal("user") }),
        data: v.object({
          itemType: v.literal("attachment"),
          lastRead: v.optional(v.nullable(v.number())),
        }),
      }),
      parseJson(reply.value.text),
    );
    if (!item.success) {
      yield* writeBackSkipped(attachmentKey, "malformed attachment");
      return;
    }
    const lastRead = Math.floor(DateTime.toEpochMillis(instant) / 1000);
    if ((item.output.data.lastRead ?? 0) >= lastRead) {
      yield* writeBackSkipped(attachmentKey, "stored read is newer or equal");
      return;
    }
    yield* Ref.set(phase, "writing");
    const written = yield* authorizedSend(path, {
      library: "users/0",
      expectedServerID: serverID,
      silent: true,
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: item.output.version, lastRead }),
    });
    yield* Effect.logTrace("Read write-back outcome").pipe(
      Effect.annotateLogs({
        attachmentKey,
        outcome: "failure" in written ? "refused" : "sent",
        reason: "failure" in written ? written.failure.kind : "accepted",
      }),
    );
  });

  const authorizedSend = Effect.fn("ZoteroLocalApi.authorizedSend")(function* (
    path: string,
    options: AuthorizedSendOptions,
  ): Effect.fn.Return<LocalApiResult<ZoteroReply>> {
    const current = yield* Ref.get(state);
    if (current.kind !== "available") {
      return { failure: noSessionFailure(current) };
    }
    const { library, method, body, headers } = options;
    if ((yield* Ref.get(readOnlyLibraries)).has(library)) {
      return { failure: { kind: "library-read-only" } };
    }
    const { serverID } = current.source;
    if (
      options.expectedServerID !== undefined &&
      options.expectedServerID !== serverID
    ) {
      return { failure: { kind: "server-changed" } };
    }
    const key = yield* storedKey(serverID);
    if (
      options.expectedServerID !== undefined &&
      (yield* heldServerID) !== serverID
    ) {
      return { failure: { kind: "server-changed" } };
    }
    if (key === null) {
      yield* setAuthorized(false);
      return { failure: { kind: "unauthorized" } };
    }

    const reply = yield* send(path, {
      serverID,
      method,
      body,
      headers: { ...headers, "Zotero-API-Key": key },
    });
    if (
      "failure" in reply &&
      (options.expectedServerID === undefined ||
        (yield* heldServerID) === serverID)
    ) {
      yield* writeRefused(reply.failure, library, options.silent);
    }
    return reply;
  }, withLogCategory(LOG_CATEGORY));

  return {
    freshnessSignal: Effect.asVoid(
      startProbe("freshness signal", { moved: true }),
    ),

    resolvedPathsMoved: Effect.asVoid(
      startProbe("resolved paths changed", { moved: true, stale: true }),
    ),

    demandSource: Effect.gen(function* () {
      const current = yield* Ref.get(state);
      if (current.kind === "unprobed") yield* startProbe("first demand");
      return current.kind === "available" ? current.source : null;
    }).pipe(withLogCategory(LOG_CATEGORY)),

    state: Effect.map(Ref.get(state), (current): LocalApiState =>
      current.kind === "unprobed" ? { kind: "probing" } : current,
    ).pipe(withLogCategory(LOG_CATEGORY)),

    probe: reprobe("asked").pipe(
      Effect.withSpan("ZoteroLocalApi.probe"),
      withLogCategory(LOG_CATEGORY),
    ),

    writeStateFor: Effect.fnUntraced(function* (
      attachmentKey: string | null,
    ): Effect.fn.Return<WriteAuthorizationState> {
      const parsed =
        attachmentKey === null ? null : parseIndexedKey(attachmentKey);
      const authorizingNow = (yield* Ref.get(authorizing)) !== null;
      const libraryReadOnly =
        parsed !== null &&
        (yield* Ref.get(readOnlyLibraries)).has(libraryPath(parsed));
      return {
        authorizing: authorizingNow,
        libraryReadOnly,
        cooldownUntil: yield* Ref.get(cooldownUntil),
      };
    }, withLogCategory(LOG_CATEGORY)),

    remembered: Effect.tryPromise(() => credentials.has()).pipe(
      Effect.orDie,
      Effect.withSpan("ZoteroLocalApi.remembered"),
      withLogCategory(LOG_CATEGORY),
    ),

    authorize: request.pipe(
      Effect.withSpan("ZoteroLocalApi.authorize"),
      withLogCategory(LOG_CATEGORY),
    ),

    forgetAuthorization: Effect.andThen(forgetKey, setAuthorized(false)).pipe(
      Effect.withSpan("ZoteroLocalApi.forgetAuthorization"),
      withLogCategory(LOG_CATEGORY),
    ),

    authorizedSend,

    writeLastRead: Effect.fn("ZoteroLocalApi.writeLastRead")(function* (
      attachmentKey: string,
      serverID: string,
      instant: DateTime.Utc,
    ) {
      const current = yield* Ref.get(state);
      const unwritable = unwritableReason(current, serverID);
      if (unwritable !== null) {
        yield* writeBackSkipped(attachmentKey, unwritable);
        return;
      }
      const phase = yield* Ref.make<WriteBackPhase>("queued");
      const writing = yield* queued(
        `${serverID}/${attachmentKey}`,
        writeLastReadNow({ attachmentKey, serverID, instant, phase }),
      ).pipe(
        Effect.onInterrupt(() =>
          Effect.flatMap(Ref.get(phase), (reached) => {
            switch (reached) {
              case "queued":
                return writeBackSkipped(attachmentKey, "cancelled");
              case "reading":
                return Effect.logTrace("Read write-back refused").pipe(
                  Effect.annotateLogs({
                    attachmentKey,
                    reason: "unknown-outcome",
                  }),
                );
              case "writing":
                return Effect.logTrace("Read write-back outcome").pipe(
                  Effect.annotateLogs({
                    attachmentKey,
                    outcome: "refused",
                    reason: "unknown-outcome",
                  }),
                );
            }
          }),
        ),
        Effect.timeoutOrElse({
          duration: PROBE_TIMEOUT,
          orElse: () => Effect.void,
        }),
        Effect.forkIn(scope, { startImmediately: true }),
      );
      const exit = yield* Fiber.await(writing);
      if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
        return yield* Effect.failCause(exit.cause);
      }
    }, withLogCategory(LOG_CATEGORY)),

    readAnnotation: Effect.fn("ZoteroLocalApi.readAnnotation")(function* (
      annotationKey: string,
      attachmentKey: string,
    ): Effect.fn.Return<LocalApiResult<LocalApiAnnotation>> {
      const current = yield* Ref.get(state);
      if (current.kind !== "available") {
        return { failure: noSessionFailure(current) };
      }
      const parsed = parseIndexedKey(annotationKey);
      if (!parsed) {
        return { failure: invalid(`annotation key ${annotationKey}`) };
      }
      const reply = yield* send(
        `/api/${libraryPath(parsed)}/items/${parsed.key}`,
        { serverID: current.source.serverID },
      );
      if ("failure" in reply) return reply;
      return readAnnotationItem(reply.value.text, attachmentKey);
    }, withLogCategory(LOG_CATEGORY)),

    listAnnotations: Effect.fn("ZoteroLocalApi.listAnnotations")(function* (
      attachmentKey: string,
    ): Effect.fn.Return<LocalApiResult<readonly LocalApiAnnotation[]>> {
      const current = yield* Ref.get(state);
      if (current.kind !== "available") {
        return { failure: noSessionFailure(current) };
      }
      const parsed = parseIndexedKey(attachmentKey);
      if (!parsed) {
        return { failure: invalid(`attachment key ${attachmentKey}`) };
      }
      const library = libraryPath(parsed);

      const annotations: LocalApiAnnotation[] = [];
      const keys = new Set<string>();
      let expectedTotal: number | null | undefined;
      for (;;) {
        const query = new URLSearchParams({
          itemType: "annotation",
          limit: String(PAGE_SIZE),
          start: String(annotations.length),
          sort: "dateAdded",
          direction: "asc",
        });
        const reply = yield* send(
          `/api/${library}/items/${parsed.key}/children?${query.toString()}`,
          { serverID: current.source.serverID },
        );
        if ("failure" in reply) return yield* report(reply);

        const page = readAnnotationPage(reply.value.text, attachmentKey);
        if ("failure" in page) return yield* report(page);
        const total = totalResults(reply.value.headers);
        if (total === null) {
          return yield* report({
            failure: invalid("annotation page named no valid total"),
          });
        }
        if (expectedTotal === undefined) expectedTotal = total;
        if (expectedTotal !== total) {
          return yield* report({
            failure: invalid("annotation total changed during pagination"),
          });
        }
        for (const { key } of page.value) {
          if (keys.has(key)) {
            return yield* report({
              failure: invalid("annotation page repeated an annotation"),
            });
          }
          keys.add(key);
        }
        annotations.push(...page.value);

        if (
          page.value.length < PAGE_SIZE ||
          annotations.length >= expectedTotal
        ) {
          if (annotations.length !== expectedTotal) {
            return yield* report({
              failure: invalid("annotation pages did not match their total"),
            });
          }
          yield* Effect.logDebug(
            "Annotations read from the Zotero Local API",
          ).pipe(
            Effect.annotateLogs({
              attachmentKey,
              annotations: annotations.length,
              serverID: current.source.serverID,
            }),
          );
          return { value: annotations.toSorted(byReadingOrder) };
        }
      }
    }, withLogCategory(LOG_CATEGORY)),
  };
});

function serverIDOf(state: ProbeState): string | null {
  return state.kind === "available" ? state.source.serverID : null;
}

function unwritableReason(state: ProbeState, serverID: string): string | null {
  if (state.kind !== "available") return "unavailable";
  if (!state.authorized) return "unauthorized";
  if (state.source.serverID !== serverID) return "source changed";
  return null;
}

function noSessionFailure(
  state: Exclude<ProbeState, { kind: "available" }>,
): LocalApiFailure {
  return state.kind === "unavailable" ? state.failure : { kind: "unreachable" };
}

function sameProbeState(a: ProbeState, b: ProbeState): boolean {
  if (a.kind === "available" && b.kind === "available") {
    return (
      a.source.serverID === b.source.serverID && a.authorized === b.authorized
    );
  }
  if (a.kind === "unavailable" && b.kind === "unavailable") {
    return a.failure.kind === b.failure.kind;
  }
  return a.kind === b.kind;
}

function probeFailure(failure: LocalApiFailure): LocalApiFailure {
  switch (failure.kind) {
    case "unreachable":
    case "local-api-disabled":
    case "incompatible-zotero":
      return failure;
    default:
      return { kind: "unreachable" };
  }
}

function byReadingOrder(a: LocalApiAnnotation, b: LocalApiAnnotation): number {
  return a.sortIndex < b.sortIndex ? -1 : a.sortIndex > b.sortIndex ? 1 : 0;
}
