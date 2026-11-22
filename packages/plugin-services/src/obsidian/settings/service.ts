import type { HydrationOrigin } from "#core/settings/classify.ts";
import type { Settings, SettingsDefinition } from "#core/settings/schema.ts";
import {
  Cause,
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  PubSub,
  Result,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import type { Plugin } from "obsidian";
import * as v from "valibot";

import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";

import { layerPluginData, PluginData } from "./plugin-data.ts";

import {
  classifyDiskData,
  hydrationOriginOf,
  isPlainObject,
  VERSION_KEY,
} from "#core/settings/classify.ts";

const SAVE_DEBOUNCE_MS = 200;
const CURRENT_VERSION = 11;

type SettingsKey = keyof Settings;

export type { Settings } from "#core/settings/schema.ts";

export const RESET_SETTING: unique symbol = Symbol("RESET_SETTING");

export type SettingsPatch = {
  [K in keyof Settings]?: Settings[K] | typeof RESET_SETTING;
};

export interface SettingsDiagnostic {
  readonly key: keyof Settings;
  readonly value: unknown;
}

type BrokenOverrides = ReadonlyMap<SettingsKey, unknown>;

export interface SettingsMigrations {
  migrateLegacy: (raw: unknown) => unknown;
  migrateV1: (raw: unknown) => unknown;
  migrateV2: (raw: unknown) => unknown;
  migrateV3: (raw: unknown) => unknown;
  migrateV4: (raw: unknown) => unknown;
  migrateV5: (raw: unknown) => unknown;
  migrateV6: (raw: unknown) => unknown;
  migrateV7: (raw: unknown) => unknown;
  migrateV8: (raw: unknown) => unknown;
  migrateV9: (raw: unknown) => unknown;
  migrateV10: (raw: unknown) => unknown;
}

export interface PluginSettingsOptions extends Partial<SettingsMigrations> {
  readonly definition: SettingsDefinition;
  handoff?: object;
}

const noMigration = (): never => {
  throw new Error("This host has no migration for this data version");
};

const noMigrations: SettingsMigrations = {
  migrateLegacy: noMigration,
  migrateV1: noMigration,
  migrateV2: noMigration,
  migrateV3: noMigration,
  migrateV4: noMigration,
  migrateV5: noMigration,
  migrateV6: noMigration,
  migrateV7: noMigration,
  migrateV8: noMigration,
  migrateV9: noMigration,
  migrateV10: noMigration,
};

const LAST_WRITE = Symbol.for("zotlit.settings.last-write");
type Handoff = { [LAST_WRITE]?: Promise<void> };

export class SettingsMutationError extends Schema.TaggedError<
  SettingsMutationError,
  { readonly brand: unique symbol }
>()("SettingsMutationError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export class SettingsPersistenceError extends Schema.TaggedError<
  SettingsPersistenceError,
  { readonly brand: unique symbol }
>()("SettingsPersistenceError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

const mutationFailure = (cause: unknown) =>
  new SettingsMutationError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
const persistenceFailure = (cause: unknown) =>
  new SettingsPersistenceError({
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

export class PluginSettings extends Context.Service<
  PluginSettings,
  {
    readonly current: Effect.Effect<Readonly<Settings>>;
    readonly loaded: Effect.Effect<Readonly<Settings>>;
    readonly diagnostics: Effect.Effect<readonly SettingsDiagnostic[]>;
    readonly hydrationOrigin: Effect.Effect<HydrationOrigin | null>;
    readonly changes: Stream.Stream<Readonly<Settings>>;
    update(
      patch: SettingsPatch | ((current: Readonly<Settings>) => SettingsPatch),
    ): Effect.Effect<Readonly<Settings>, SettingsMutationError>;
    reset(
      keys?: readonly (keyof Settings)[],
    ): Effect.Effect<Readonly<Settings>, SettingsMutationError>;
    readonly flush: Effect.Effect<void, SettingsPersistenceError>;
    readonly release: Effect.Effect<void>;
  }
>()("zotlit/settings/PluginSettings") {}

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    PluginSettings: PluginSettings;
  }
}

export function layerPluginSettings(
  plugin: Pick<Plugin, "loadData" | "saveData"> & Partial<Pick<Plugin, "app">>,
  options: PluginSettingsOptions,
): Layer.Layer<PluginSettings> {
  return layerPluginSettingsOf({
    ...options,
    handoff: options.handoff ?? plugin.app,
  }).pipe(Layer.provide(layerPluginData(plugin)));
}

export function layerPluginSettingsOf(
  options: PluginSettingsOptions,
): Layer.Layer<PluginSettings, never, PluginData> {
  return Layer.effect(PluginSettings, makePluginSettings(options));
}

const makePluginSettings = Effect.fn("PluginSettings.make")(function* (
  options: PluginSettingsOptions,
) {
  const data = yield* PluginData;
  const { schema, defaults } = options.definition;
  const isSettingsKey = settingsKeyGuard(options.definition);
  const {
    migrateLegacy,
    migrateV1,
    migrateV2,
    migrateV3,
    migrateV4,
    migrateV5,
    migrateV6,
    migrateV7,
    migrateV8,
    migrateV9,
    migrateV10,
  } = { ...noMigrations, ...options };
  const handoff: Handoff | undefined = options.handoff;
  const state = yield* Effect.acquireRelease(
    SubscriptionRef.make<Readonly<Settings>>(defaults),
    (state) => PubSub.shutdown(state.pubsub),
  );
  let overrides: Partial<Settings> = {};
  let broken: BrokenOverrides = new Map();
  let hydrationOrigin: HydrationOrigin | null = null;
  let loadFailure: Cause.Cause<unknown> | undefined;
  let released = false;
  let closed = false;
  let dirty = false;
  let pendingWrite: Fiber.Fiber<void, SettingsPersistenceError> | undefined;
  let timer: Fiber.Fiber<void> | undefined;
  const writes = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );
  const snapshot = (): Settings => ({ ...defaults, ...overrides });
  const current = Effect.sync(snapshot);

  const performSave = Effect.fn("PluginSettings.save")(function* () {
    dirty = false;
    if (loadFailure)
      return yield* persistenceFailure(Cause.squash(loadFailure));
    const payload = {
      [VERSION_KEY]: CURRENT_VERSION,
      ...Object.fromEntries(broken),
      ...overrides,
    };
    const earlier = pendingWrite;
    const write = Effect.gen(function* () {
      if (earlier) yield* Fiber.await(earlier);
      yield* data
        .save(payload)
        .pipe(Effect.mapError((error) => persistenceFailure(error.cause)));
    }).pipe(
      Effect.uninterruptible,
      Effect.tapCause((cause) =>
        reportFailure("background save failed", cause),
      ),
      withLogCategory("settings"),
    );
    const fiber = yield* Effect.forkIn(write, writes, {
      startImmediately: true,
    });
    pendingWrite = fiber;
    fiber.addObserver(() => {
      if (pendingWrite === fiber) pendingWrite = undefined;
    });
    return fiber;
  });

  const flush = Effect.gen(function* () {
    while (dirty || pendingWrite) {
      if (timer) {
        timer.interruptUnsafe();
        timer = undefined;
      }
      const pending = dirty ? yield* performSave() : pendingWrite;
      if (pending) yield* Fiber.join(pending);
    }
  }).pipe(Effect.uninterruptible, Effect.withSpan("PluginSettings.flush"));

  const handOff = Effect.fn("PluginSettings.handOff")(function* () {
    const write = yield* Effect.forkIn(
      flush.pipe(
        Effect.catchCause((cause) =>
          reportFailure("settings save on unload failed", cause),
        ),
      ),
      writes,
      { startImmediately: true },
    );
    if (handoff)
      handoff[LAST_WRITE] = new Promise<void>((resolve) =>
        write.addObserver(() => resolve()),
      );
  });

  const commitMutation = Effect.fn("PluginSettings.commitMutation")(function* (
    nextOverrides: Partial<Settings>,
    nextBroken: BrokenOverrides,
    op: "update" | "reset",
  ) {
    const candidate: Settings = { ...defaults, ...nextOverrides };
    const result = v.safeParse(schema, candidate);
    if (!result.success)
      return yield* new SettingsMutationError({
        message: `SettingsService.${op}(): invalid settings — ${v.summarize(result.issues)}`,
        cause: result.issues,
      });
    overrides = nextOverrides;
    broken = nextBroken;
    yield* SubscriptionRef.set(state, candidate);
    dirty = true;
    if (timer) timer.interruptUnsafe();
    timer = yield* Effect.forkIn(
      Effect.sleep(SAVE_DEBOUNCE_MS).pipe(
        Effect.andThen(flush),
        Effect.ignoreCause,
      ),
      writes,
    );
    if (released) yield* handOff();
    return snapshot();
  });

  const update = Effect.fn("PluginSettings.update")(function* (
    patchOrUpdater:
      | SettingsPatch
      | ((current: Readonly<Settings>) => SettingsPatch),
  ) {
    if (closed) return snapshot();
    const patch = yield* Effect.try({
      try: () => {
        const patch =
          typeof patchOrUpdater === "function"
            ? patchOrUpdater(snapshot())
            : patchOrUpdater;
        for (const key of Object.keys(patch))
          assertWritableKey(key, "update", isSettingsKey);
        return patch;
      },
      catch: mutationFailure,
    });
    const nextOverrides = { ...overrides };
    const nextBroken = new Map(broken);
    for (const key of Object.keys(patch)) {
      const value = (patch as Record<string, unknown>)[key];
      if (value === RESET_SETTING) delete nextOverrides[key as keyof Settings];
      else (nextOverrides as Record<string, unknown>)[key] = value;
      nextBroken.delete(key as SettingsKey);
    }
    return yield* commitMutation(nextOverrides, nextBroken, "update");
  });

  const reset = Effect.fn("PluginSettings.reset")(function* (
    keys?: readonly (keyof Settings)[],
  ) {
    if (closed) return snapshot();
    yield* Effect.try({
      try: () => {
        for (const key of keys ?? [])
          assertWritableKey(key, "reset", isSettingsKey);
      },
      catch: mutationFailure,
    });
    const nextOverrides = { ...overrides };
    const nextBroken = new Map(broken);
    for (const key of keys ?? (Object.keys(nextOverrides) as SettingsKey[])) {
      delete nextOverrides[key];
      nextBroken.delete(key);
    }
    if (keys === undefined) nextBroken.clear();
    return yield* commitMutation(nextOverrides, nextBroken, "reset");
  });

  const hydrateFrom = Effect.fn("PluginSettings.hydrateFrom")(function* (
    raw: unknown,
  ) {
    const classification = classifyDiskData(raw);
    hydrationOrigin = hydrationOriginOf(classification.kind);
    switch (classification.kind) {
      case "missing": {
        overrides = {};
        return;
      }
      case "v11": {
        yield* loadV11(classification.raw);
        return;
      }
      case "v10": {
        yield* loadV10Migration(classification.raw);
        return;
      }
      case "v9": {
        yield* loadV9Migration(classification.raw);
        return;
      }
      case "v8": {
        yield* loadV8Migration(classification.raw);
        return;
      }
      case "v7": {
        yield* loadV7Migration(classification.raw);
        return;
      }
      case "v6": {
        yield* loadV6Migration(classification.raw);
        return;
      }
      case "v5": {
        yield* loadV5Migration(classification.raw);
        return;
      }
      case "v4": {
        yield* loadV4Migration(classification.raw);
        return;
      }
      case "v3": {
        yield* loadV3Migration(classification.raw);
        return;
      }
      case "v2": {
        yield* loadV2Migration(classification.raw);
        return;
      }
      case "v1": {
        yield* loadV1Migration(classification.raw);
        return;
      }
      case "legacy": {
        yield* loadLegacy(classification.raw);
        return;
      }
      case "future": {
        yield* Effect.logWarning(
          `data version ${classification.version} is newer than supported (${CURRENT_VERSION}); falling back to defaults`,
        );
        overrides = {};
        return;
      }
      case "malformed": {
        yield* Effect.logWarning(
          `malformed data on disk (${classification.reason}); falling back to defaults`,
        );
        overrides = {};
        return;
      }
    }
  });

  const loadV11 = Effect.fn("PluginSettings.loadV11")(function* (
    raw: Record<string, unknown>,
  ) {
    const validated = yield* validateOverrides(raw, "v11 data");
    overrides = validated?.cleaned ?? {};
    broken = validated?.broken ?? new Map();
    if (broken.size > 0) {
      yield* Effect.logWarning(
        `invalid values in v11 data (${[...broken.keys()].join(", ")}); using their defaults until each key is updated or reset`,
      );
    }
  });

  const loadV10Migration = Effect.fn("PluginSettings.loadV10Migration")(
    function* (raw: Record<string, unknown>) {
      const migrated = yield* runMigrationHook(
        migrateV10,
        raw,
        "v10 migration",
      );
      if (migrated === null) {
        overrides = {};
        yield* writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
        return;
      }

      const validated = yield* validateOverrides(
        migrated,
        "v10 migration result",
      );
      overrides = validated?.cleaned ?? {};
      yield* writeBestEffort({
        [VERSION_KEY]: CURRENT_VERSION,
        ...validated?.cleaned,
      });
    },
  );

  const loadV9Migration = Effect.fn("PluginSettings.loadV9Migration")(
    function* (raw: Record<string, unknown>) {
      const migrated = yield* runMigrationHook(migrateV9, raw, "v9 migration");
      if (migrated === null) {
        overrides = {};
        yield* writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
        return;
      }

      yield* loadV10Migration(migrated);
    },
  );

  const loadV8Migration = Effect.fn("PluginSettings.loadV8Migration")(
    function* (raw: Record<string, unknown>) {
      const migrated = yield* runMigrationHook(migrateV8, raw, "v8 migration");
      if (migrated === null) {
        overrides = {};
        yield* writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
        return;
      }

      yield* loadV9Migration(migrated);
    },
  );

  const loadV7Migration = Effect.fn("PluginSettings.loadV7Migration")(
    function* (raw: Record<string, unknown>) {
      const migrated = yield* runMigrationHook(migrateV7, raw, "v7 migration");
      if (migrated === null) {
        overrides = {};
        yield* writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
        return;
      }

      yield* loadV8Migration(migrated);
    },
  );

  const loadV6Migration = Effect.fn("PluginSettings.loadV6Migration")(
    function* (raw: Record<string, unknown>) {
      const migrated = yield* runMigrationHook(migrateV6, raw, "v6 migration");
      if (migrated === null) {
        overrides = {};
        yield* writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
        return;
      }

      yield* loadV7Migration(migrated);
    },
  );

  const loadV5Migration = Effect.fn("PluginSettings.loadV5Migration")(
    function* (raw: Record<string, unknown>) {
      const migrated = yield* runMigrationHook(migrateV5, raw, "v5 migration");
      if (migrated === null) {
        overrides = {};
        yield* writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
        return;
      }

      yield* loadV6Migration(migrated);
    },
  );

  const loadV4Migration = Effect.fn("PluginSettings.loadV4Migration")(
    function* (raw: Record<string, unknown>) {
      const migrated = yield* runMigrationHook(migrateV4, raw, "v4 migration");
      if (migrated === null) {
        overrides = {};
        yield* writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
        return;
      }

      yield* loadV5Migration(migrated);
    },
  );

  const loadV3Migration = Effect.fn("PluginSettings.loadV3Migration")(
    function* (raw: Record<string, unknown>) {
      const migrated = yield* runMigrationHook(migrateV3, raw, "v3 migration");
      if (migrated === null) {
        overrides = {};
        yield* writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
        return;
      }

      yield* loadV4Migration(migrated);
    },
  );

  const loadV2Migration = Effect.fn("PluginSettings.loadV2Migration")(
    function* (raw: Record<string, unknown>) {
      const migrated = yield* runMigrationHook(migrateV2, raw, "v2 migration");
      if (migrated === null) {
        overrides = {};
        yield* writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
        return;
      }

      yield* loadV3Migration(migrated);
    },
  );

  const loadV1Migration = Effect.fn("PluginSettings.loadV1Migration")(
    function* (raw: Record<string, unknown>) {
      const migrated = yield* runMigrationHook(migrateV1, raw, "v1 migration");
      if (migrated === null) {
        overrides = {};
        yield* writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
        return;
      }

      yield* loadV2Migration(migrated);
    },
  );

  const loadLegacy = Effect.fn("PluginSettings.loadLegacy")(function* (
    raw: Record<string, unknown>,
  ) {
    const legacyMigrated = yield* runMigrationHook(
      migrateLegacy,
      raw,
      "legacy migration",
    );
    if (legacyMigrated === null) {
      overrides = {};
      yield* writeBestEffort({ [VERSION_KEY]: CURRENT_VERSION });
      return;
    }

    yield* loadV1Migration(legacyMigrated);
  });

  const validateOverrides = Effect.fn("PluginSettings.validateOverrides")(
    function* (
      raw: Record<string, unknown>,
      context: string,
    ): Effect.fn.Return<{
      cleaned: Partial<Settings>;
      broken: BrokenOverrides;
    } | null> {
      const { cleaned, broken } = cleanKnownOverrides(raw, options.definition);
      const result = v.safeParse(schema, { ...defaults, ...cleaned });
      if (!result.success) {
        yield* Effect.logWarning(
          `${context} failed full-schema validation (${v.summarize(result.issues)}); falling back to defaults`,
        );
        return null;
      }
      return { cleaned, broken };
    },
  );

  const writeBestEffort = Effect.fn("PluginSettings.writeBestEffort")(
    function* (payload: Record<string, unknown>) {
      yield* data.save(payload).pipe(
        Effect.uninterruptible,
        Effect.catchCause((cause) =>
          reportFailure("settings migration write failed", cause),
        ),
      );
    },
  );

  const load = Effect.gen(function* () {
    const last = handoff?.[LAST_WRITE];
    if (last) yield* Effect.promise(() => last);
    const raw = yield* data.load.pipe(Effect.mapError((error) => error.cause));
    yield* hydrateFrom(raw);
  }).pipe(
    Effect.catchCause((cause) => {
      loadFailure = cause;
      return reportFailure(
        "Could not read settings; using defaults without saving",
        cause,
      );
    }),
    Effect.andThen(
      Effect.gen(function* () {
        if (closed) return;
        yield* SubscriptionRef.set(state, snapshot());
      }),
    ),
    withLogCategory("settings"),
  );
  yield* load;
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
    }).pipe(
      Effect.andThen(flush),
      Effect.catchCause((cause) =>
        reportFailure("settings save on close failed", cause),
      ),
    ),
  );

  return PluginSettings.of({
    current,
    loaded: current,
    changes: SubscriptionRef.changes(state).pipe(
      Stream.map((value) => ({ ...value })),
    ),
    diagnostics: Effect.sync(() =>
      [...broken].map(([key, value]) => ({
        key,
        value: structuredClone(value),
      })),
    ),
    hydrationOrigin: Effect.sync(() => hydrationOrigin),
    update,
    reset,
    flush,
    release: Effect.gen(function* () {
      if (closed) return;
      released = true;
      yield* handOff();
    }).pipe(Effect.withSpan("PluginSettings.release")),
  });
}, withLogCategory("settings"));

const reportFailure = (message: string, error: unknown) =>
  Effect.logError(message).pipe(
    Effect.annotateLogs({ error }),
    withLogCategory("settings"),
  );

function cleanKnownOverrides(
  raw: Record<string, unknown>,
  definition: SettingsDefinition,
): {
  cleaned: Partial<Settings>;
  broken: BrokenOverrides;
} {
  const isSettingsKey = settingsKeyGuard(definition);
  const cleaned: Partial<Settings> = {};
  const broken = new Map<SettingsKey, unknown>();
  for (const key of Object.keys(raw)) {
    if (!isSettingsKey(key)) continue;
    const entry = definition.schema.entries[key];
    const result = v.safeParse(entry, raw[key]);
    if (result.success) {
      (cleaned as Record<string, unknown>)[key] = result.output;
    } else {
      broken.set(key, raw[key]);
    }
  }
  return { cleaned, broken };
}

const runMigrationHook = Effect.fn("PluginSettings.migrate")(function* (
  hook: (raw: unknown) => unknown,
  raw: unknown,
  stage: string,
): Effect.fn.Return<Record<string, unknown> | null> {
  const run = yield* Effect.result(Effect.try(() => hook(raw)));
  if (Result.isFailure(run)) {
    yield* Effect.logWarning("Migration threw; falling back to defaults").pipe(
      Effect.annotateLogs({ error: run.failure.cause, stage }),
    );
    return null;
  }
  const migrated = run.success;
  if (!isPlainObject(migrated)) {
    yield* Effect.logWarning(
      "Migration returned a non-plain value; falling back to defaults",
    ).pipe(Effect.annotateLogs({ error: migrated, stage }));
    return null;
  }
  return migrated;
});

function settingsKeyGuard(
  definition: SettingsDefinition,
): (key: string) => key is SettingsKey {
  const keys: ReadonlySet<string> = new Set(
    Object.keys(definition.schema.entries),
  );
  return (key): key is SettingsKey => keys.has(key);
}

function assertWritableKey(
  key: string,
  op: string,
  isSettingsKey: (key: string) => key is SettingsKey,
): void {
  if (key === VERSION_KEY) {
    throw new Error(
      `SettingsService.${op}(): '${VERSION_KEY}' is reserved and cannot be mutated`,
    );
  }
  if (!isSettingsKey(key)) {
    throw new Error(`SettingsService.${op}(): unknown settings key '${key}'`);
  }
}
