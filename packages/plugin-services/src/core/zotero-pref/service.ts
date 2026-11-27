import type { Effect, PlatformError } from "effect";
import { Context, Stream } from "effect";

export type PrefValue = string | number | boolean;

export interface ZoteroProfileInfo {
  name: string | null;
  dir: string;
  isDefault: boolean;
}

export interface ZoteroPrefSnapshot {
  readonly state: "loading" | "ready" | "degraded";
  readonly prefs: ReadonlyMap<string, PrefValue>;
  readonly resolvedProfileDir: string | null;
  readonly profileDirOverride: string | null;
  readonly dataDirOverride: string | null;
  readonly dataDir: string;
  readonly databasePath: string;
  readonly sourceId: string | null;
  readonly acceptedSourceIds: readonly string[];
  readonly baseAttachmentPath: string | null;
  readonly httpPort: number | null;
}

export class ZoteroPref extends Context.Service<
  ZoteroPref,
  {
    readonly current: Effect.Effect<ZoteroPrefSnapshot>;
    readonly changes: Stream.Stream<ZoteroPrefSnapshot>;
    get(name: string): Effect.Effect<PrefValue | undefined>;
    setProfileDir(dir: string | null): Effect.Effect<void>;
    setDataDir(dir: string | null): Effect.Effect<void>;
    readonly companionInstalled: Effect.Effect<boolean>;
    readonly listProfiles: Effect.Effect<ZoteroProfileInfo[]>;
    readonly profilesRoot: Effect.Effect<string, PlatformError.PlatformError>;
  }
>()("zotlit/zotero-pref/ZoteroPref") {}

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
