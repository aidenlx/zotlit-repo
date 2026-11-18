// The Profiles a Citation Presentation reads, as a test double: Profiles by ID
// and label, each with the Citation and References Style it binds; a Profile
// that binds none inherits the vault's style. The notes feature owns the real
// registry; its tests cover the inheritance in full.
import type { MetadataCache } from "obsidian";

import { readProfileStamp } from "@zotlit/obsidian-kit/profile-stamp.ts";
import type {
  ProfileId,
  ProfileSelector,
} from "@zotlit/obsidian-kit/profile-stamp.ts";
import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";

import type {
  ProfileStyleReader,
  StyleProfile,
} from "#obsidian/pandoc/profile-styles.ts";

export interface ProfileFixture {
  readonly id: ProfileId;
  readonly label: string;
  readonly bindings?: { readonly "citation.references-style"?: string | null };
}

export type ProfileFixtureSettings = Readonly<Settings> & {
  readonly profiles?: readonly ProfileFixture[];
  /** The vault's style, which the default Profile binds; none by default. */
  readonly vaultStyle?: string | null;
};

/** A reader over `settings`, which a test may hand over as a getter. */
export function profileReader(
  settings?: ProfileFixtureSettings | (() => ProfileFixtureSettings),
  metadataCache: Pick<MetadataCache, "getFileCache"> = {
    getFileCache: () => null,
  },
): ProfileStyleReader {
  const current = () =>
    typeof settings === "function" ? settings() : settings;
  return {
    loaded: true,
    profileOf(file) {
      const stamp = file && readProfileStamp(metadataCache, file);
      const profile =
        stamp === undefined
          ? resolveProfile(current(), "default")
          : stamp.id && resolveProfile(current(), stamp.id);
      return profile ? { ok: true, profile } : { ok: false, stamped: stamp! };
    },
  };
}

function resolveProfile(
  settings: ProfileFixtureSettings | undefined,
  selector: ProfileSelector,
): StyleProfile | undefined {
  const vaultStyle = settings?.vaultStyle ?? null;
  if (selector === "default")
    return {
      selector,
      label: undefined,
      bindings: { "citation.references-style": vaultStyle },
    };
  const entry = settings?.profiles?.find(({ id }) => id === selector);
  if (!entry) return undefined;
  const style = entry.bindings?.["citation.references-style"];
  return {
    selector,
    label: entry.label,
    bindings: {
      "citation.references-style": style === undefined ? vaultStyle : style,
    },
  };
}
