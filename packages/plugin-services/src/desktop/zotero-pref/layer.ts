import type {
  ZoteroPrefSnapshot,
  ZoteroProfileInfo,
} from "#core/zotero-pref/service.ts";
import {
  Cause,
  Context,
  Effect,
  FileSystem,
  Layer,
  PubSub,
  Schema,
  SubscriptionRef,
} from "effect";
import type { PlatformError } from "effect";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { ObsidianApp } from "@zotlit/obsidian-kit/obsidian-app.ts";
import {
  COMPANION_ADDON_ID,
  ZOTERO_DB_FILENAME,
} from "@zotlit/plugin-kernel/constants.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { startupBarrier } from "@zotlit/plugin-kernel/effect-startup.ts";
import { acceptedSourceIds, sourceIdFromUris } from "@zotlit/protocol";

import {
  EXTENSIONS_FILENAME,
  isAddonActive,
  parsePrefsJs,
  parseZoteroProfiles,
  PREF_BRANCH,
  PREFS_FILENAME,
  PROFILES_INI_FILENAME,
  resolveZoteroHttpPort,
  resolveProfileDir,
  selectDefaultProfile,
  ZOTERO_HTTP_PORT_PREF,
} from "./prefs-file.ts";
import { zoteroProfilesRoot } from "./profile-root.ts";

import { ZoteroPref } from "#core/zotero-pref/service.ts";
import {
  loadZoteroPathOverrides,
  saveZoteroPathOverrides,
} from "#obsidian/zotero-pref/device-paths.ts";

export class ZoteroPrefFiles extends Context.Service<
  ZoteroPrefFiles,
  {
    read(path: string): Effect.Effect<string, PlatformError.PlatformError>;
    readonly profilesRoot: Effect.Effect<string, PlatformError.PlatformError>;
  }
>()("zotlit/zotero-pref/ZoteroPrefFiles") {}

export const layerZoteroPrefFiles = Layer.effect(
  ZoteroPrefFiles,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return ZoteroPrefFiles.of({
      profilesRoot: zoteroProfilesRoot.pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
      ),
      read: Effect.fn("ZoteroPrefFiles.read")(function* (path: string) {
        return yield* fs.readFileString(path);
      }),
    });
  }),
);

class NoDefaultZoteroProfile extends Schema.TaggedError<
  NoDefaultZoteroProfile,
  { readonly brand: unique symbol }
>()("NoDefaultZoteroProfile", { message: Schema.String }) {}

export const layerZoteroPref = Layer.effect(
  ZoteroPref,
  Effect.gen(function* () {
    const app = yield* ObsidianApp;
    const files = yield* ZoteroPrefFiles;
    const scope = yield* Effect.scope;
    const overrides = loadZoteroPathOverrides(app);
    const state = yield* SubscriptionRef.make(
      snapshot({
        profileDirOverride: overrides.profileDir,
        dataDirOverride: overrides.dataDir,
        state: "loading",
        prefs: new Map(),
        resolvedProfileDir: null,
      }),
    );
    const current = SubscriptionRef.get(state);
    let generation = 0;
    let closed = false;

    const readProfiles = Effect.fn("ZoteroPref.readProfiles")(function* () {
      const root = yield* files.profilesRoot;
      const profiles = parseZoteroProfiles(
        yield* files.read(join(root, PROFILES_INI_FILENAME)),
      );
      return { root, profiles };
    });

    const reload = Effect.fn("ZoteroPref.reload")(function* (
      overrideDir: string | null,
    ) {
      const gen = ++generation;
      let profileDir = overrideDir;
      const loaded = yield* Effect.gen(function* () {
        if (profileDir === null) {
          const { root, profiles } = yield* readProfiles();
          const profile = selectDefaultProfile(profiles);
          if (!profile)
            return yield* new NoDefaultZoteroProfile({
              message: `No default Zotero profile found in ${join(root, PROFILES_INI_FILENAME)}`,
            });
          profileDir = resolveProfileDir(root, profile);
        }
        return parsePrefsJs(
          yield* files.read(join(profileDir, PREFS_FILENAME)),
        );
      }).pipe(Effect.exit);
      if (closed || gen !== generation) return;
      if (loaded._tag === "Success") {
        yield* SubscriptionRef.update(state, (before) =>
          snapshot({
            ...before,
            prefs: loaded.value,
            resolvedProfileDir: profileDir,
            state: "ready",
          }),
        );
        yield* Effect.logDebug("Loaded Zotero prefs").pipe(
          Effect.annotateLogs({ profileDir, count: loaded.value.size }),
        );
      } else {
        if (Cause.hasInterruptsOnly(loaded.cause)) return;
        yield* SubscriptionRef.update(state, (before) =>
          snapshot({
            ...before,
            prefs: new Map(),
            resolvedProfileDir: profileDir,
            state: "degraded",
          }),
        );
        yield* Effect.logWarning("Failed to read Zotero prefs").pipe(
          Effect.annotateLogs({
            error: Cause.squash(loaded.cause),
            profileDir,
          }),
        );
      }
    }, withLogCategory("zotero-pref"));

    const setDataDir = Effect.fn("ZoteroPref.setDataDir")(
      function* (dir: string | null) {
        const before = yield* current;
        if (closed || dir === before.dataDirOverride) return;
        saveZoteroPathOverrides(app, {
          profileDir: before.profileDirOverride,
          dataDir: dir,
        });
        yield* SubscriptionRef.set(
          state,
          snapshot({ ...before, dataDirOverride: dir }),
        );
        yield* Effect.logDebug("Data dir override changed").pipe(
          Effect.annotateLogs({ dir }),
        );
      },
      Effect.uninterruptible,
      withLogCategory("zotero-pref"),
    );

    const setProfileDir = Effect.fn("ZoteroPref.setProfileDir")(
      function* (dir: string | null) {
        const before = yield* current;
        if (closed || dir === before.profileDirOverride) return;
        saveZoteroPathOverrides(app, {
          profileDir: dir,
          dataDir: before.dataDirOverride,
        });
        yield* SubscriptionRef.set(
          state,
          snapshot({ ...before, profileDirOverride: dir }),
        );
        yield* Effect.logDebug(
          "Profile dir override changed; re-reading prefs",
        ).pipe(Effect.annotateLogs({ dir }));
        yield* Effect.forkIn(Effect.interruptible(reload(dir)), scope, {
          startImmediately: true,
        });
      },
      Effect.uninterruptible,
      withLogCategory("zotero-pref"),
    );

    yield* startupBarrier(
      reload(overrides.profileDir),
      SubscriptionRef.update(state, (before) =>
        before.state === "loading"
          ? { ...before, state: "degraded" as const }
          : before,
      ).pipe(
        Effect.andThen(
          Effect.logWarning(
            "Zotero preferences are still loading; using fallback paths",
          ),
        ),
      ),
    );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closed = true;
      }).pipe(Effect.andThen(PubSub.shutdown(state.pubsub))),
    );

    return ZoteroPref.of({
      profilesRoot: files.profilesRoot,
      current,
      changes: SubscriptionRef.changes(state),
      get: Effect.fn("ZoteroPref.get")(function* (name: string) {
        return (yield* current).prefs.get(PREF_BRANCH + name);
      }),
      setDataDir,
      setProfileDir,
      companionInstalled: Effect.gen(function* () {
        const { resolvedProfileDir: profileDir } = yield* current;
        if (!profileDir) return false;
        return yield* files.read(join(profileDir, EXTENSIONS_FILENAME)).pipe(
          Effect.map((content) => isAddonActive(content, COMPANION_ADDON_ID)),
          Effect.catchCause((error) =>
            Effect.logDebug("Cannot read the Zotero add-on list").pipe(
              Effect.annotateLogs({ error, profileDir }),
              Effect.as(false),
            ),
          ),
        );
      }).pipe(
        withLogCategory("zotero-pref"),
        Effect.withSpan("ZoteroPref.companionInstalled"),
      ),
      listProfiles: readProfiles().pipe(
        Effect.map(({ root, profiles }) =>
          profiles.map((p) => ({
            name: p.name,
            dir: resolveProfileDir(root, p),
            isDefault: p.isDefault,
          })),
        ),
        recover(
          (error) =>
            Effect.logWarning("Failed to list Zotero profiles").pipe(
              Effect.annotateLogs({ error }),
            ),
          Effect.succeed<ZoteroProfileInfo[]>([]),
        ),
        withLogCategory("zotero-pref"),
        Effect.withSpan("ZoteroPref.listProfiles"),
      ),
    });
  }).pipe(withLogCategory("zotero-pref")),
);

function snapshot(
  input: Pick<
    ZoteroPrefSnapshot,
    | "state"
    | "prefs"
    | "resolvedProfileDir"
    | "profileDirOverride"
    | "dataDirOverride"
  >,
): ZoteroPrefSnapshot {
  const get = (name: string) => input.prefs.get(PREF_BRANCH + name);
  const prefDir = get("dataDir");
  const dataDir =
    input.dataDirOverride ||
    (get("useDataDir") === true && typeof prefDir === "string" && prefDir
      ? prefDir
      : join(homedir(), "Zotero"));
  const base = get("baseAttachmentPath");
  return {
    ...input,
    dataDir,
    databasePath: join(dataDir, ZOTERO_DB_FILENAME),
    sourceId: input.resolvedProfileDir
      ? sourceIdFromUris(
          pathToFileURL(input.resolvedProfileDir).href,
          pathToFileURL(dataDir).href,
        )
      : null,
    acceptedSourceIds: input.resolvedProfileDir
      ? acceptedSourceIds(
          input.resolvedProfileDir,
          dataDir,
          (path) => pathToFileURL(path).href,
        )
      : [],
    baseAttachmentPath: typeof base === "string" ? base : null,
    httpPort: resolveZoteroHttpPort(get(ZOTERO_HTTP_PORT_PREF)),
  };
}
