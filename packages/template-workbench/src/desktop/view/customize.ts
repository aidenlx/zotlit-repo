import type { WorkbenchOpened } from "#desktop/editor/actions.ts";
import type { WorkbenchOpenError } from "#desktop/view/open.ts";
import { Context, Effect, Layer } from "effect";
import type { CachedMetadata, TFile } from "obsidian";

import { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import type { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import { MetadataCache } from "@zotlit/obsidian-kit/obsidian-metadata-cache.ts";
import { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { DEFAULT_PROFILE } from "@zotlit/obsidian-kit/profile-stamp.ts";
import type { ProfileSelector } from "@zotlit/obsidian-kit/profile-stamp.ts";
import { itemKeyFromFrontmatter } from "@zotlit/plugin-services/obsidian/note-index/service.ts";

import { explainWorkbenchOpen } from "#desktop/editor/actions.ts";

export interface CustomizeItem {
  readonly key: string;
  readonly title: string | null;
}

export interface CustomizeRequest {
  readonly profileId: ProfileSelector;
  readonly originatingNote?: TFile;
  readonly item?: CustomizeItem | null;
}

export type ProfileTarget = TFile | DefaultProfileTarget;

export interface DefaultProfileTarget {
  readonly defaultDocumentPath: string;
}

export interface CustomizePorts {
  readonly openView: (
    request: CustomizeRequest,
    target: ProfileTarget,
  ) => Effect.Effect<
    WorkbenchOpened | void,
    WorkbenchOpenError,
    Workspace | Vault | Profile
  >;
}

export type CustomizeServices =
  | Profile
  | Notifier
  | Workspace
  | MetadataCache
  | Vault;

export class Customize extends Context.Service<
  Customize,
  {
    open(
      request: CustomizeRequest,
    ): Effect.Effect<void, Effect.Error<ReturnType<typeof customize>>>;
  }
>()("zotlit/template-workbench/Customize") {}

export const layerCustomize = (ports: CustomizePorts) =>
  Layer.effect(
    Customize,
    Effect.gen(function* () {
      const context = yield* Effect.context<CustomizeServices>();
      return Customize.of({
        open: Effect.fn("Customize.open")((request: CustomizeRequest) =>
          customize(request, ports).pipe(Effect.provideContext(context)),
        ),
      });
    }),
  );

export const customize = Effect.fn("TemplateWorkbench.customize")(function* (
  request: CustomizeRequest,
  ports: CustomizePorts,
) {
  const item =
    request.item === undefined ? yield* activeNoteItem : request.item;
  const target = yield* profileTarget(request.profileId);
  if (target)
    yield* explainWorkbenchOpen(
      yield* ports.openView({ ...request, item }, target),
    );
});

const profileTarget = Effect.fn("TemplateWorkbench.profileTarget")(function* (
  profileId: ProfileSelector,
) {
  const profile = yield* Profile;
  if (profileId === DEFAULT_PROFILE) {
    const target: ProfileTarget = {
      defaultDocumentPath: yield* profile.defaultDocumentPath,
    };
    return target;
  }
  const entry = (yield* profile.profiles).find(({ id }) => id === profileId);
  return entry ? yield* (yield* Vault).getFileByPath(entry.path) : null;
});

const activeNoteItem = Effect.gen(function* () {
  const file = yield* (yield* Workspace).getActiveFile;
  if (!file) return null;
  return noteItem(file, yield* (yield* MetadataCache).fileCache(file));
});

export function noteItem(
  file: TFile,
  cache: CachedMetadata | null,
): CustomizeItem | null {
  const key = itemKeyFromFrontmatter(cache);
  return key === null ? null : { key, title: file.basename };
}
