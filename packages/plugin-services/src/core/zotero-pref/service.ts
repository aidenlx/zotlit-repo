// The Zotero preferences every host reads: the resolved paths and the
// Zotero pref values. A desktop host builds it from prefs.js (`layerZoteroPref`).
import { Context, Stream } from "effect";
import type { Effect, PlatformError } from "effect";

/** JSON primitives a `user_pref(...)` value can take. */
export type PrefValue = string | number | boolean;

/** A profile resolved to its absolute directory, for the settings picker. */
export interface ZoteroProfileInfo {
  name: string | null;
  dir: string;
  isDefault: boolean;
}

export interface ZoteroPrefSnapshot {
  readonly state: "loading" | "ready" | "degraded";
  readonly prefs: ReadonlyMap<string, PrefValue>;
  readonly resolvedProfileDir: string | null;
  /** The chosen profile directory; null selects the default in profiles.ini. */
  readonly profileDirOverride: string | null;
  /** The chosen data directory; null uses the profile preferences. */
  readonly dataDirOverride: string | null;
  readonly dataDir: string;
  readonly databasePath: string;
  /** Companion-compatible profile/data-directory hash; null until resolved. */
  readonly sourceId: string | null;
  readonly baseAttachmentPath: string | null;
  readonly httpPort: number | null;
}

export class ZoteroPref extends Context.Service<
  ZoteroPref,
  {
    readonly current: Effect.Effect<ZoteroPrefSnapshot>;
    readonly changes: Stream.Stream<ZoteroPrefSnapshot>;
    /** Read a bare preference name under the extensions.zotero. branch. */
    get(name: string): Effect.Effect<PrefValue | undefined>;
    setProfileDir(dir: string | null): Effect.Effect<void>;
    setDataDir(dir: string | null): Effect.Effect<void>;
    /** Read the add-on list fresh, so a new Companion install is visible. */
    readonly companionInstalled: Effect.Effect<boolean>;
    readonly listProfiles: Effect.Effect<ZoteroProfileInfo[]>;
    readonly profilesRoot: Effect.Effect<string, PlatformError.PlatformError>;
  }
>()("zotlit/zotero-pref/ZoteroPref") {}

/** Fires when the resolved paths may have moved: the prefs or the data directory override changed. */
export function resolvedChanged(
  pref: Pick<ZoteroPref["Service"], "changes">,
): Stream.Stream<void> {
  return pref.changes.pipe(
    Stream.changesWith(
      (a, b) => a.prefs === b.prefs && a.dataDirOverride === b.dataDirOverride,
    ),
    Stream.drop(1),
    Stream.map(() => undefined),
  );
}
