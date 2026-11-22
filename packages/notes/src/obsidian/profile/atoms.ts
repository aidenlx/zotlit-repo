import { Effect, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { viewRuntime, held } from "@zotlit/obsidian-kit/view-atoms.ts";
import { filterTag } from "@zotlit/plugin-kernel/effect-stream.ts";
import { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import { Profile } from "./service.ts";
import type { ProfileState, LiteratureNoteProfile } from "./service.ts";
import { profileSettings } from "./settings.ts";

export const profileStateAtom = held(
  Stream.unwrap(Effect.map(Profile, (service) => service.changes)),
  null as ProfileState | null,
);
const NO_PROFILES: readonly LiteratureNoteProfile[] = [];
export const profilesAtom = Atom.map(
  profileStateAtom,
  (state) => state?.profiles ?? NO_PROFILES,
);
export const defaultProfilePathAtom = Atom.map(
  profileStateAtom,
  (state) => state?.defaultDocumentPath ?? "",
);

export const fileProfileAtom = Atom.family((path: string) =>
  viewRuntime.atom((get) => {
    get(profileStateAtom);
    return Stream.unwrap(
      Effect.gen(function* () {
        const profiles = yield* Profile;
        const metadata = yield* MetadataCache;
        const vault = yield* Vault;
        const read = Stream.unwrap(
          Effect.map(vault.getFileByPath(path), (file) =>
            file ? Stream.fromEffect(profiles.profileOf(file)) : Stream.empty,
          ),
        );
        const changes = Stream.filter(
          filterTag(metadata.changes, "changed"),
          (event) => event.file.path === path,
        );
        return Stream.concat(
          read,
          Stream.flatMap(changes, () => read),
        );
      }),
    );
  }),
);

export const fileProfileValueAtom = Atom.family((path: string) =>
  Atom.map(fileProfileAtom(path), (result) =>
    AsyncResult.isSuccess(result) ? result.value : null,
  ),
);

export const profileRevisionAtom = held(
  Stream.unwrap(
    Effect.map(Profile, (profiles) =>
      profiles.changes.pipe(
        Stream.drop(1),
        Stream.scan(
          () => 0,
          (revision) => revision + 1,
        ),
      ),
    ),
  ),
  0,
);

export const defaultBindingsAtom = held(
  Stream.unwrap(
    Effect.map(PluginSettings, (service) =>
      Stream.map(
        service.changes,
        (settings) => settings["note.default-profile"].bindings,
      ),
    ),
  ),
  profileSettings.defaults["note.default-profile"].bindings,
);
