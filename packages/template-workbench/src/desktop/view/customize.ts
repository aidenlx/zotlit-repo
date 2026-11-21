import type { WorkbenchOpened } from "#desktop/editor/actions.ts";
import type { WorkbenchOpenError } from "#desktop/view/open.ts";
// The Customize flow every entry action shares: which Profile and paper an
// open carries, and the open of that Profile in the Template Workbench View.
//
// The open itself is a port (`openView`), so the decision this module makes
// is testable apart from the view it opens.
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

/** The paper Customize shows: its Item key, and its name when known. */
export interface CustomizeItem {
  readonly key: string;
  readonly title: string | null;
}

/** What an entry action asks Customize to open. */
export interface CustomizeRequest {
  readonly profileId: ProfileSelector;
  /** The note explicitly launching this session; preview selection is independent. */
  readonly originatingNote?: TFile;
  /**
   * The paper to show. Leave it out and the flow takes the active Literature
   * Note's paper, or a Sample Item when no Literature Note is active.
   */
  readonly item?: CustomizeItem | null;
}

/**
 * The document the Template Workbench View opens: a Profile's own file, or
 * the Default Profile, whose document may not exist yet. The view reads the
 * Default Profile's text from the `Profile` service when the document is
 * missing.
 */
export type ProfileTarget = TFile | DefaultProfileTarget;

/** The Default Profile's document path. */
export interface DefaultProfileTarget {
  readonly defaultDocumentPath: string;
}

/** What the flow reaches outside the services: the open of the view. */
export interface CustomizePorts {
  /**
   * Open `target` in the Template Workbench View, answering what the open
   * asks the reader to know.
   */
  readonly openView: (
    request: CustomizeRequest,
    target: ProfileTarget,
  ) => Effect.Effect<
    WorkbenchOpened | void,
    WorkbenchOpenError,
    Workspace | Vault | Profile
  >;
}

/** The services the flow reads. */
export type CustomizeServices =
  | Profile
  | Notifier
  | Workspace
  | MetadataCache
  | Vault;

/** The one Customize flow every entry action shares, the setting tab included. */
export class Customize extends Context.Service<
  Customize,
  {
    /** @see customize */
    open(
      request: CustomizeRequest,
    ): Effect.Effect<void, Effect.Error<ReturnType<typeof customize>>>;
  }
>()("zotlit/template-workbench/Customize") {}

/** The Customize flow over `ports` and the services of the graph. */
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

/** Open the Profile `request` names in the Template Workbench View. */
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

/**
 * What the view opens for `profileId`: the Default Profile, or the file of a
 * Profile the registry holds; `null` for a Profile it does not hold or whose
 * file is gone.
 */
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

/** The paper the active Literature Note is about, or `null` for a Sample Item. */
const activeNoteItem = Effect.gen(function* () {
  const file = yield* (yield* Workspace).getActiveFile;
  if (!file) return null;
  return noteItem(file, yield* (yield* MetadataCache).fileCache(file));
});

/** The paper a Literature Note is about, from its cache; `null` for any other note. */
export function noteItem(
  file: TFile,
  cache: CachedMetadata | null,
): CustomizeItem | null {
  const key = itemKeyFromFrontmatter(cache);
  return key === null ? null : { key, title: file.basename };
}
