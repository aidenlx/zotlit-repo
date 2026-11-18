// The setting tab's seam to Effect: one service that runs the tab's Effects on
// the tab layer's own context and Scope.
//
// Obsidian drives a declarative tab synchronously: `getSettingDefinitions()`,
// `getControlValue`/`setControlValue`, and the `visible`/`disabled` predicates
// return before Obsidian paints. Those run with `sync`, so a builder reads a
// service through the Context (`yield* ZoteroReads`) instead of an injected
// adapter. An event handler starts a fiber with `run`; a row with live state
// starts one with `mount` and returns its interrupt as the row's cleanup.
// Every fiber lives in the tab layer's Scope, so closing the layer ends them.
import { Cause, Context, Effect, Fiber, Scope, Stream } from "effect";
import type { FileSystem } from "effect";

import type { ExcerptDisplays } from "@zotlit/annotations/desktop/excerpt-image/display.ts";
import type { CapabilityNotices } from "@zotlit/annotations/obsidian/annotation-repository/notices.ts";
import type { AnnotationRepository } from "@zotlit/annotations/obsidian/annotation-repository/service.ts";
import type { ExcerptImageService } from "@zotlit/annotations/obsidian/excerpt-image/service.ts";
import type { CitationIndex } from "@zotlit/citations/obsidian/citation-index/service.ts";
import type { PandocEngine } from "@zotlit/citations/obsidian/pandoc/service.ts";
import type { NoteFeature } from "@zotlit/notes/desktop/note-feature/service.ts";
import type { Profile } from "@zotlit/notes/obsidian/profile/service.ts";
import type { Template } from "@zotlit/notes/obsidian/template/service.ts";
import type { TemplateWorkbenchLauncher } from "@zotlit/notes/obsidian/template/workbench-launcher.ts";
import { Notifier } from "@zotlit/obsidian-kit/notifier.ts";
import type { FileManager } from "@zotlit/obsidian-kit/obsidian-file-manager.ts";
import type { Vault } from "@zotlit/obsidian-kit/obsidian-vault.ts";
import type { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import type { PluginHost } from "@zotlit/obsidian-kit/plugin-host.ts";
import { formatErrorMessage } from "@zotlit/obsidian-kit/toast.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log-category.ts";
import type { LocalServer } from "@zotlit/plugin-services/core/local-server/service.ts";
import type { ZoteroPref } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { AttachmentImport } from "@zotlit/plugin-services/desktop/attachment-import/service.ts";
import type { ChineseSegmenter } from "@zotlit/plugin-services/obsidian/chinese-segmenter/service.ts";
import type { LanguagePack } from "@zotlit/plugin-services/obsidian/language-pack/service.ts";
import type { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import type { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import type { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";
import type { ZoteroLocalApi } from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";
import type { Customize } from "@zotlit/template-workbench/desktop/local-bridge/customize.ts";
import type { LocalBridge } from "@zotlit/template-workbench/desktop/local-bridge/service.ts";
import type { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";

import type { Release } from "@/services/release/service.ts";

/** Every service a tab Effect may read: the tab layer's whole context. */
export type SettingTabEnv =
  | SettingTab
  | Notifier
  | PluginSettings
  | Profile
  | Template
  | ZoteroPref
  | ZoteroReads
  | LibraryScope
  | LocalServer
  | Release
  | AnnotationRepository
  | CapabilityNotices
  | ZoteroLocalApi
  | CitationIndex
  | PandocEngine
  | ChineseSegmenter
  | AttachmentImport
  | LocalBridge
  | Customize
  | TemplateWorkbenchLauncher
  | LanguagePack
  | ExcerptImageService
  | ExcerptDisplays
  | NoteFeature
  | NoteIndex
  | Vault
  | Workspace
  | FileManager
  | FileSystem.FileSystem
  | PluginHost;

export interface SettingTabShape {
  /**
   * Run a synchronous Effect now, for a callback Obsidian reads a value from:
   * a definition build, a control read, a predicate. Throws what the Effect
   * fails with, as a synchronous Obsidian callback would.
   */
  sync<A, E>(effect: Effect.Effect<A, E, SettingTabEnv>): A;
  /**
   * Start a handler's Effect: a button, an action, a control write. A failure
   * is logged under `label` and shown as a notice; an interrupt (the tab
   * closing) is silent. An Effect that reports its own outcome
   * (`reportOutcome`, `withProgress`) takes no `label`: what still reaches the
   * runner is only logged. The Promise settles when the Effect ends and never
   * rejects, so a caller that awaits it (Obsidian awaits `setControlValue`
   * before it refreshes the DOM state) sees the work done, and one that drops
   * it leaks no rejection.
   */
  run<A, E>(
    effect: Effect.Effect<A, E, SettingTabEnv>,
    label?: string,
  ): Promise<void>;
  /**
   * Start a row's live Effect in a Scope of its own, for `render` to return
   * the result as its cleanup. The cleanup interrupts the fiber, which closes
   * that Scope.
   */
  mount<E>(
    effect: Effect.Effect<unknown, E, SettingTabEnv | Scope.Scope>,
  ): () => void;
  /**
   * Rebuild the definitions: rows were added, removed, or renamed. Obsidian
   * re-renders every `render` row on a rebuild, so a row never asks for one
   * from inside its own `render`.
   */
  readonly update: Effect.Effect<void>;
}

export class SettingTab extends Context.Service<SettingTab, SettingTabShape>()(
  "zotlit/setting-tab/SettingTab",
) {}

/**
 * The tab service over the current context, itself included, with every fiber
 * forked into the current Scope. `update` is late-bound: the tab instance is
 * built from this service, so it does not exist yet.
 */
export const makeSettingTab = Effect.fn("makeSettingTab")(function* (
  update: () => void,
) {
  const base = yield* Effect.context<
    Exclude<SettingTabEnv, SettingTab> | Scope.Scope
  >();
  const notifier = Context.get(base, Notifier);
  const onFiberStart = Fiber.runIn(Context.get(base, Scope.Scope));
  const service: SettingTabShape = {
    sync: (effect) => runSync(effect),
    run: async (effect, label) => {
      await runPromiseExit(
        effect.pipe(
          recover(
            (cause) =>
              label === undefined
                ? Effect.logWarning("A setting action failed", cause)
                : Effect.logWarning(label, cause).pipe(
                    Effect.andThen(
                      notifier.show(
                        `${label}: ${formatErrorMessage(Cause.squash(cause))}`,
                      ),
                    ),
                  ),
            Effect.void,
          ),
          withLogCategory("setting-tab"),
        ),
        { onFiberStart },
      );
    },
    mount: (effect) => {
      const fiber = runFork(
        Effect.scoped(effect).pipe(
          recover(
            (cause) =>
              Effect.logWarning("A setting row stopped updating", cause),
            Effect.void,
          ),
          withLogCategory("setting-tab"),
        ),
        { onFiberStart },
      );
      return () => fiber.interruptUnsafe();
    },
    update: Effect.sync(update),
  };
  const context = Context.add(base, SettingTab, service);
  const runSync = Effect.runSyncWith(context);
  const runFork = Effect.runForkWith(context);
  const runPromiseExit = Effect.runPromiseExitWith(context);
  return service;
});

/**
 * Paint each element of `stream` until the row's Scope closes: the live-row
 * body of `mount`. `paint` runs on the renderer and may touch the row's DOM.
 */
export const paintEach = <A, E, R>(
  stream: Stream.Stream<A, E, R>,
  paint: (value: A) => void,
) => Stream.runForEach(stream, (value) => Effect.sync(() => paint(value)));
