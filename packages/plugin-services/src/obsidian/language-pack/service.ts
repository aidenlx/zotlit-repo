import {
  Context,
  Effect,
  Fiber,
  Layer,
  Option,
  PubSub,
  Ref,
  Schema,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";
import type { Exit } from "effect";
import { HttpClient, HttpClientError } from "effect/http";

import {
  LanguagePackSchemaVersionError,
  languageEndonym,
  validateLanguagePack,
} from "@zotlit/obsidian-i18n";
import type {
  LanguagePackRestartNotice,
  LanguagePackRuntime,
  LanguagePackSituation,
  LocaleCatalog,
  PackSource,
  RemotePackInfo,
} from "@zotlit/obsidian-i18n";
import { DeviceStorage } from "@zotlit/obsidian-kit/obsidian-device-storage.ts";
import { ObsidianEnv } from "@zotlit/obsidian-kit/obsidian-env.ts";
import {
  bridgeLog,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import { resolvePluginLocale } from "@zotlit/plugin-kernel/i18n/locale.ts";
import {
  releaseOrigin,
  resourceReleaseUrl,
} from "@zotlit/plugin-kernel/worker/release-url.ts";

export type { LanguagePackRestartNotice, LanguagePackSituation };

export interface LanguagePackIdentity {
  readonly catalog: LocaleCatalog;
  readonly runtime: LanguagePackRuntime;
  readonly namespace: string;
  readonly repository: string;
}

const CONSENT_ACCEPTED = "accepted";
const CONSENT_DECLINED = "declined";

const packCacheKeyPrefix = (namespace: string): string =>
  `${namespace}:i18n:pack:`;
const consentKeyPrefix = (namespace: string): string =>
  `${namespace}:i18n:consent:`;
const packCacheKey = (
  namespace: string,
  pluginVersion: string,
  locale: string,
): string => `${packCacheKeyPrefix(namespace)}${pluginVersion}:${locale}`;
const consentKey = (namespace: string, locale: string): string =>
  `${consentKeyPrefix(namespace)}${locale}`;

export class NoLanguagePack extends Schema.TaggedError<
  NoLanguagePack,
  { readonly brand: unique symbol }
>()("NoLanguagePack", { message: Schema.String }) {}

export class LanguagePackStorageFailed extends Schema.TaggedError<
  LanguagePackStorageFailed,
  { readonly brand: unique symbol }
>()("LanguagePackStorageFailed", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export class LanguagePackDownloadFailed extends Schema.TaggedError<
  LanguagePackDownloadFailed,
  { readonly brand: unique symbol }
>()("LanguagePackDownloadFailed", {
  message: Schema.String,
  updateNeeded: Schema.Boolean,
  cause: Schema.optional(Schema.Defect()),
}) {}

export type LanguagePackInstallError =
  | NoLanguagePack
  | LanguagePackStorageFailed
  | LanguagePackDownloadFailed;

export class LanguagePack extends Context.Service<
  LanguagePack,
  {
    readonly locale: string;
    readonly plugin: string;
    readonly endonym: string;
    readonly situation: Effect.Effect<LanguagePackSituation>;
    readonly changes: Stream.Stream<LanguagePackSituation>;
    readonly install: Effect.Effect<
      LanguagePackRestartNotice,
      LanguagePackInstallError
    >;
    readonly decline: Effect.Effect<void, LanguagePackStorageFailed>;
    readonly reset: Effect.Effect<void, LanguagePackStorageFailed>;
    readonly refresh: Option.Option<
      Effect.Effect<
        Exit.Exit<LanguagePackRestartNotice, LanguagePackInstallError>
      >
    >;
  }
>()("zotlit/language-pack/LanguagePack") {}

export interface LanguagePackStartup {
  readonly identity: LanguagePackIdentity;
  readonly pluginVersion: string;
  readonly plugin: string;
  readonly locale: string;
  readonly endonym: string;
  readonly remote?: {
    readonly pack: RemotePackInfo;
    readonly url: string;
    readonly found: "installed" | "refresh" | "declined" | "offered";
  };
}

const packSource = (repository: string, pluginVersion: string): PackSource =>
  typeof __LANGUAGE_PACK_DEV_SERVER__ === "string"
    ? {
        baseUrl: __LANGUAGE_PACK_DEV_SERVER__,
        origin: new URL(__LANGUAGE_PACK_DEV_SERVER__).host,
      }
    : {
        baseUrl: resourceReleaseUrl(repository, pluginVersion),
        origin: releaseOrigin(repository),
      };

const deviceStorage = (storage: DeviceStorage["Service"]) => ({
  keys: Effect.mapError(storage.keys, ({ cause }) => storageFailed(cause)),
  load: (key: string) =>
    Effect.mapError(storage.load(key), ({ cause }) => storageFailed(cause)),
  save: (key: string, value: unknown) =>
    Effect.mapError(storage.save(key, value), ({ cause }) =>
      storageFailed(cause),
    ),
});

const storageFailed = (cause: unknown) =>
  new LanguagePackStorageFailed({
    message: Error.isError(cause) ? cause.message : String(cause),
    cause,
  });

export const startLanguagePack = Effect.fn("LanguagePack.start")(function* (
  identity: LanguagePackIdentity,
  pluginVersion: string,
  plugin: string,
) {
  const { catalog, runtime, namespace, repository } = identity;
  const storage = deviceStorage(yield* DeviceStorage);
  const { language } = yield* ObsidianEnv;
  runtime.reset();
  runtime.setLogger(
    bridgeLog({ runSync: Effect.runSyncWith(yield* Effect.context()) }, "i18n"),
  );
  const locale = resolvePluginLocale(language, catalog);
  runtime.setTargetLocale(locale);
  const endonym = languageEndonym(language) ?? locale;
  const remote =
    locale === catalog.baseLocale ? undefined : catalog.packs[locale];
  yield* Effect.logInfo(
    "Language Pack startup: Obsidian language resolved to a locale",
  ).pipe(
    Effect.annotateLogs({
      namespace,
      language,
      locale,
      endonym,
      pluginVersion,
      remote,
    }),
  );
  if (remote === undefined) {
    yield* Effect.logInfo(
      "No Language Pack ships for the locale; using the bundled base pack",
    ).pipe(Effect.annotateLogs({ locale }));
    return {
      identity,
      pluginVersion,
      plugin,
      locale,
      endonym,
    } satisfies LanguagePackStartup;
  }
  const source = packSource(repository, pluginVersion);
  const pack: RemotePackInfo = {
    fileName: remote.fileName,
    origin: source.origin,
  };
  const url = `${source.baseUrl}/${remote.fileName}`;
  const started = (
    found: NonNullable<LanguagePackStartup["remote"]>["found"],
  ) =>
    ({
      identity,
      pluginVersion,
      plugin,
      locale,
      endonym,
      remote: { pack, url, found },
    }) satisfies LanguagePackStartup;

  const cacheKey = packCacheKey(namespace, pluginVersion, locale);
  const cached = yield* storage.load(cacheKey);
  if (typeof cached === "string") {
    const applied = yield* Effect.try(() =>
      validateLanguagePack(cached, { expectedLocale: locale }),
    ).pipe(
      Effect.tapError((error) =>
        Effect.logWarning("Discarding the cached Language Pack").pipe(
          Effect.annotateLogs({ cacheKey, locale, error }),
        ),
      ),
      Effect.option,
    );
    if (Option.isSome(applied)) {
      runtime.install(applied.value);
      yield* Effect.logInfo("Applied the cached Language Pack").pipe(
        Effect.annotateLogs({ locale, cacheKey }),
      );
      return started("installed");
    }
  }

  const consent = yield* storage.load(consentKey(namespace, locale));
  yield* Effect.logDebug("No cached Language Pack; read the consent").pipe(
    Effect.annotateLogs({ cacheKey, consent }),
  );
  if (consent === CONSENT_ACCEPTED) {
    yield* Effect.logInfo(
      "Refreshing the Language Pack in the background under existing consent",
    ).pipe(Effect.annotateLogs({ locale, url }));
    return started("refresh");
  }
  if (consent === CONSENT_DECLINED) {
    yield* Effect.logInfo(
      "The Language Pack was declined; the settings item is the only entry point",
    ).pipe(Effect.annotateLogs({ locale }));
    return started("declined");
  }
  yield* Effect.logInfo("Offering to install the Language Pack").pipe(
    Effect.annotateLogs({ locale, fileName: pack.fileName, url }),
  );
  return started("offered");
}, withLogCategory("i18n"));

interface PackRecord {
  readonly state: "installed" | "cached" | "none";
  readonly downloading: boolean;
  readonly offer: boolean;
}

const situationOf =
  (pack: RemotePackInfo) =>
  (record: PackRecord): LanguagePackSituation => {
    if (record.downloading) return { kind: "downloading", pack };
    if (record.state === "cached") return { kind: "restart-pending", pack };
    if (record.state === "installed") return { kind: "active", pack };
    if (record.offer) return { kind: "offered", pack };
    return { kind: "installable", pack };
  };

const UNAVAILABLE: LanguagePackSituation = { kind: "unavailable" };

export function layerLanguagePack(
  startup: LanguagePackStartup,
): Layer.Layer<LanguagePack, never, DeviceStorage | HttpClient.HttpClient> {
  return Layer.effect(
    LanguagePack,
    Effect.gen(function* () {
      const storage = deviceStorage(yield* DeviceStorage);
      const http = yield* HttpClient.HttpClient;
      const { identity, pluginVersion, plugin, locale, endonym, remote } =
        startup;
      const { namespace } = identity;

      const clearStoredPacks = Effect.gen(function* () {
        const packPrefix = packCacheKeyPrefix(namespace);
        const consentPrefix = consentKeyPrefix(namespace);
        const removedKeys = (yield* storage.keys).filter(
          (key) => key.startsWith(packPrefix) || key.startsWith(consentPrefix),
        );
        for (const key of removedKeys) {
          yield* storage.save(key, null);
        }
        yield* Effect.logInfo(
          "Reset Language Packs: cleared stored packs and consent",
        ).pipe(Effect.annotateLogs({ namespace, removedKeys }));
      });
      const asReset = <E>(effect: Effect.Effect<void, E>) =>
        effect.pipe(
          withLogCategory("i18n"),
          Effect.withSpan("LanguagePack.reset"),
        );

      if (remote === undefined) {
        const situation = yield* SubscriptionRef.make(UNAVAILABLE);
        yield* Effect.addFinalizer(() => PubSub.shutdown(situation.pubsub));
        return LanguagePack.of({
          locale,
          plugin,
          endonym,
          situation: SubscriptionRef.get(situation),
          changes: SubscriptionRef.changes(situation),
          install: Effect.fail(
            new NoLanguagePack({
              message: `No Language Pack ships for locale ${locale}`,
            }),
          ),
          decline: Effect.void,
          reset: asReset(clearStoredPacks),
          refresh: Option.none(),
        });
      }

      const { pack, url, found } = remote;
      const cacheKey = packCacheKey(namespace, pluginVersion, locale);
      const record = yield* SubscriptionRef.make<PackRecord>({
        state: found === "installed" ? "installed" : "none",
        downloading: false,
        offer: found === "offered",
      });
      yield* Effect.addFinalizer(() => PubSub.shutdown(record.pubsub));
      const layerScope = yield* Scope.Scope;
      const turn = yield* Semaphore.make(1);
      const inFlight = yield* Ref.make(
        Option.none<
          Fiber.Fiber<LanguagePackRestartNotice, LanguagePackInstallError>
        >(),
      );

      const downloadFailed = (error: unknown) =>
        error instanceof LanguagePackDownloadFailed ||
        error instanceof LanguagePackStorageFailed
          ? error
          : new LanguagePackDownloadFailed({
              message: Error.isError(error) ? error.message : String(error),
              updateNeeded:
                error instanceof LanguagePackSchemaVersionError &&
                error.updateNeeded,
              cause: error,
            });

      const fetchPack = http.get(url).pipe(
        Effect.mapError((error) =>
          downloadFailed(
            HttpClientError.isHttpClientError(error) &&
              Error.isError(error.reason.cause)
              ? error.reason.cause
              : error,
          ),
        ),
        Effect.flatMap((response) =>
          Effect.flatMap(
            Effect.mapError(response.text, (error) => downloadFailed(error)),
            (text) => {
              const { status } = response;
              return Effect.logDebug("Language Pack download responded").pipe(
                Effect.annotateLogs({ status, length: text.length, url }),
                Effect.andThen(
                  status < 200 || status >= 300
                    ? Effect.fail(
                        new LanguagePackDownloadFailed({
                          message: `${url} responded ${status}`,
                          updateNeeded: false,
                        }),
                      )
                    : Effect.succeed(text),
                ),
              );
            },
          ),
        ),
      );

      const download: Effect.Effect<
        LanguagePackRestartNotice,
        LanguagePackInstallError
      > = Effect.gen(function* () {
        yield* Effect.logInfo("Downloading the Language Pack").pipe(
          Effect.annotateLogs({ locale, url }),
        );
        const text = yield* fetchPack;
        const validated = yield* Effect.try({
          try: () => validateLanguagePack(text, { expectedLocale: locale }),
          catch: (error) => downloadFailed(error),
        });
        yield* Effect.uninterruptible(
          storage.save(cacheKey, text).pipe(
            Effect.andThen(
              SubscriptionRef.update(record, (current) => ({
                ...current,
                state: "cached" as const,
                downloading: false,
              })),
            ),
          ),
        );
        yield* Effect.logInfo("Cached the Language Pack").pipe(
          Effect.annotateLogs({
            locale,
            cacheKey,
            messageCount: Object.keys(validated.messages).length,
          }),
        );
        return { fileName: pack.fileName };
      }).pipe(
        Effect.tapError((error) =>
          SubscriptionRef.update(record, (current) => ({
            ...current,
            downloading: false,
          })).pipe(
            Effect.andThen(
              Effect.logError("Language Pack install failed").pipe(
                Effect.annotateLogs({ locale, url, error }),
              ),
            ),
          ),
        ),
        Effect.onInterrupt(() =>
          Effect.logInfo(
            "Discarding the Language Pack download: it was reset mid-download",
          ).pipe(Effect.annotateLogs({ locale, cacheKey })),
        ),
        Effect.ensuring(Ref.set(inFlight, Option.none())),
        withLogCategory("i18n"),
      );

      const startDownload = turn.withPermits(1)(
        Effect.gen(function* () {
          const running = yield* Ref.get(inFlight);
          if (Option.isSome(running)) return running.value;
          yield* SubscriptionRef.update(record, (current) => ({
            ...current,
            downloading: true,
            offer: false,
          }));
          const fiber = yield* Effect.forkIn(download, layerScope);
          yield* Ref.set(inFlight, Option.some(fiber));
          return fiber;
        }),
      );

      const refresh =
        found === "refresh"
          ? Option.some(Fiber.await(yield* startDownload))
          : Option.none();

      const install = Effect.gen(function* () {
        const running = yield* Ref.get(inFlight);
        if (Option.isNone(running)) {
          yield* Effect.logInfo("Recording Language Pack consent").pipe(
            Effect.annotateLogs({ locale }),
          );
          yield* storage.save(consentKey(namespace, locale), CONSENT_ACCEPTED);
        }
        return yield* Fiber.join(yield* startDownload);
      }).pipe(withLogCategory("i18n"), Effect.withSpan("LanguagePack.install"));

      const decline = Effect.gen(function* () {
        yield* Effect.logInfo("Language Pack install declined").pipe(
          Effect.annotateLogs({ locale }),
        );
        yield* storage.save(consentKey(namespace, locale), CONSENT_DECLINED);
        yield* SubscriptionRef.update(record, (current) => ({
          ...current,
          offer: false,
        }));
      }).pipe(withLogCategory("i18n"), Effect.withSpan("LanguagePack.decline"));

      const reset = asReset(
        turn.withPermits(1)(
          Effect.gen(function* () {
            const running = yield* Ref.get(inFlight);
            if (Option.isSome(running)) yield* Fiber.interrupt(running.value);
            yield* clearStoredPacks;
            yield* SubscriptionRef.update(record, (current) => ({
              ...current,
              state: current.state === "cached" ? "none" : current.state,
              downloading: false,
            }));
          }),
        ),
      );

      const situation = situationOf(pack);
      return LanguagePack.of({
        locale,
        plugin,
        endonym,
        situation: Effect.map(SubscriptionRef.get(record), (current) =>
          situation(current),
        ),
        changes: Stream.map(SubscriptionRef.changes(record), (current) =>
          situation(current),
        ),
        install,
        decline,
        reset,
        refresh,
      });
    }),
  );
}
