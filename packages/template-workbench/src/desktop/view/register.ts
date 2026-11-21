import "./style.css";
import type { WorkbenchActionDeps } from "#desktop/editor/actions.ts";
import type { DefaultProfileTarget } from "#desktop/view/customize.ts";
import { MarkdownView, Platform } from "obsidian";
import type { App, Plugin, TFile, WorkspaceLeaf } from "obsidian";

import {
  profileStateAtom,
  fileProfileValueAtom,
} from "@zotlit/notes/obsidian/profile/atoms.ts";
import { templateFolderAtom } from "@zotlit/notes/obsidian/template/atoms.ts";
import { profileRecoveryNotice } from "@zotlit/obsidian-kit/profile-recovery.ts";
import { unknownProfileDiagnostic } from "@zotlit/obsidian-kit/profile-stamp.ts";
import { MENU_SECTION } from "@zotlit/plugin-kernel/menu-section.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import type { FileMenuSegment } from "@zotlit/plugin-services/obsidian/file-menu.ts";
import { itemKeyFromFrontmatter } from "@zotlit/plugin-services/obsidian/note-index/parse.ts";

import type { WorkbenchOpen } from "./open.ts";
import { openTemplateWorkbench } from "./open.ts";
import type { WorkbenchOpenOptions } from "./open.ts";
import {
  TEMPLATE_WORKBENCH_VIEW_TYPE,
  TemplateWorkbenchView,
} from "./view.tsx";
import type { TemplateWorkbenchDeps } from "./view.tsx";

import {
  explainNoOpen,
  startTemplateWorkbenchAction,
} from "#desktop/editor/actions.ts";
import { templateDocumentKind } from "#obsidian/view/document-kind.ts";
import { noteEmbedPlaceholders } from "#obsidian/view/embed-placeholder.ts";

type RegistrationDeps = TemplateWorkbenchDeps &
  WorkbenchActionDeps & {
    /** The Default Profile, which a note on the Default Profile opens. */
    defaultProfile: DefaultProfileTarget;
  };

/**
 * What the Workbench's commands, header action, and file-menu entries ask of a
 * file: which kind of Template Document it is, which Profile a note opens, the
 * and the one open "Open template workbench" runs for it.
 */
function workbenchTargets(app: App, deps: RegistrationDeps) {
  const state = () => deps.registry.get(profileStateAtom);
  /** A plain document — the Citation Template or a Shared Partial — which the
   *  view opens without any Profile flow. */
  const isPlainDocument = (file: TFile | null): file is TFile =>
    file !== null &&
    templateDocumentKind(file, deps.registry.get(templateFolderAtom)) !==
      "profile";
  const isProfile = (file: TFile | null): file is TFile =>
    file !== null &&
    file.extension === "md" &&
    (file.path === state()?.defaultDocumentPath ||
      (state()?.profiles ?? []).some((profile) => profile.path === file.path) ||
      file.basename.startsWith("zotlit-profile."));
  /** The Profile a Literature Note carries, or the stamp the vault holds no Profile for. */
  const noteProfile = (file: TFile | null) => {
    if (!file || !itemKeyFromFrontmatter(app.metadataCache.getFileCache(file)))
      return null;
    const resolved = deps.registry.get(fileProfileValueAtom(file.path));
    if (!resolved) return null;
    if (!resolved.ok)
      return {
        kind: "unknown" as const,
        diagnostic: unknownProfileDiagnostic(resolved.stamped.stamp, {
          path: file.path,
        }),
      };
    if (resolved.profile.selector === "default")
      return { kind: "open" as const, target: deps.defaultProfile };
    const profile = (state()?.profiles ?? []).find(
      (entry) => entry.id === resolved.profile.selector,
    );
    const target = profile ? app.vault.getFileByPath(profile.path) : null;
    return target ? { kind: "open" as const, target } : null;
  };
  /**
   * "Open template workbench" for `file`: a Template Document opens itself,
   * starting from `leaf` when that is the document's own Markdown leaf; a
   * Literature Note opens its Profile with the note's Item, and the note as
   * the one to update. A note on the built-in Default writes its document
   * first, so the reader edits at once. `null` when `file` is neither.
   */
  const workbenchOpen = (
    file: TFile | null,
    leaf?: WorkspaceLeaf,
  ): WorkbenchOpen | null => {
    if (isPlainDocument(file) || isProfile(file)) {
      const options: WorkbenchOpenOptions = leaf
        ? { from: { leaf, place: "replace" } }
        : {};
      return openTemplateWorkbench(file, options);
    }
    const note = noteProfile(file);
    if (!note || !file) return null;
    if (note.kind === "unknown")
      return explainNoOpen(profileRecoveryNotice(app, note.diagnostic));
    const itemIndexedKey = itemKeyFromFrontmatter(
      app.metadataCache.getFileCache(file),
    );
    return openTemplateWorkbench(note.target, {
      ...(itemIndexedKey ? { itemIndexedKey } : {}),
      originatingNote: file,
      customize: true,
    });
  };
  return { isPlainDocument, isProfile, workbenchOpen };
}

/** Register the Template Workbench view, its commands, and its header actions. */
export function registerTemplateWorkbenchView(
  plugin: Plugin,
  deps: RegistrationDeps,
): void {
  if (!Platform.isDesktopApp) return;
  const { isPlainDocument, isProfile, workbenchOpen } = workbenchTargets(
    plugin.app,
    deps,
  );
  plugin.registerView(
    TEMPLATE_WORKBENCH_VIEW_TYPE,
    (leaf) =>
      new TemplateWorkbenchView(leaf, {
        ...deps,
        pluginVersion: plugin.manifest.version,
      }),
  );
  // A note embed in the Preview draws a placeholder for the embedded note.
  plugin.registerMarkdownPostProcessor(noteEmbedPlaceholders(plugin.app));
  plugin.addCommand({
    id: "open-template-workbench",
    name: m.template_workbench_open_layout(),
    checkCallback(checking) {
      const { workspace } = plugin.app;
      // The built-in Default draft has no file; its view opens it all the same.
      const editor = workspace.getActiveViewOfType(TemplateWorkbenchView);
      const active = workspace.getActiveFile();
      const open =
        editor && !editor.file && editor.isDefaultDraft
          ? openTemplateWorkbench(deps.defaultProfile)
          : workbenchOpen(active, activeLeafFor(plugin.app, active));
      if (!open) return false;
      if (!checking) startTemplateWorkbenchAction(deps, "open-workbench", open);
      return true;
    },
  });
  // A note operation that refused offers this route back: the Workbench opens
  // on the document whose call refused, so the repair is one click away. The
  // Default Profile stands in when the refusal named no document — a legacy
  // slot render, or a draft compiled from source rather than from a file.
  plugin.registerEvent(
    plugin.app.workspace.on("zotlit:open-template-workbench", (request) => {
      const { document, problem } = request;
      const file = document ? plugin.app.vault.getFileByPath(document) : null;
      startTemplateWorkbenchAction(
        deps,
        "open-workbench",
        openTemplateWorkbench(
          file ?? deps.defaultProfile,
          problem ? { problem } : {},
        ),
      );
    }),
  );
  const actions = new Map<MarkdownView, HTMLElement>();
  function refreshActions() {
    const open = new Set(
      plugin.app.workspace
        .getLeavesOfType("markdown")
        .map((leaf) => leaf.view)
        .filter(
          (view): view is MarkdownView =>
            view instanceof MarkdownView &&
            (isProfile(view.file) || isPlainDocument(view.file)),
        ),
    );
    for (const [view, action] of actions)
      if (!open.has(view)) {
        action.remove();
        actions.delete(view);
      }
    for (const view of open)
      if (!actions.has(view))
        actions.set(
          view,
          view.addAction(
            "file-pen-line",
            m.template_workbench_open_layout(),
            () => {
              const opening = workbenchOpen(view.file, view.leaf);
              if (opening)
                startTemplateWorkbenchAction(deps, "open-workbench", opening);
            },
          ),
        );
  }
  plugin.registerEvent(
    plugin.app.workspace.on("layout-change", refreshActions),
  );
  plugin.registerEvent(plugin.app.workspace.on("file-open", refreshActions));
  plugin.register(() => {
    for (const action of actions.values()) action.remove();
    actions.clear();
  });
  plugin.app.workspace.onLayoutReady(refreshActions);
}

/** The Workbench's entries on Obsidian's file menu; none off the desktop app. */
export function templateWorkbenchFileMenu(
  app: App,
  deps: RegistrationDeps,
): FileMenuSegment {
  if (!Platform.isDesktopApp) return () => {};
  const { workbenchOpen } = workbenchTargets(app, deps);
  return (menu, { file, leaf: menuLeaf }) => {
    // The Workbench view's own pane menu raises this event too. Inside the
    // view these entries repeat the routes it already offers, so the file
    // menu keeps them for the surfaces that stand outside the Workbench.
    if (menuLeaf?.view instanceof TemplateWorkbenchView) return;
    const open = workbenchOpen(file, activeLeafFor(app, file));
    if (open)
      menu.addItem((item) =>
        item
          .setSection(MENU_SECTION.open)
          .setTitle(m.template_workbench_open_layout())
          .setIcon("file-pen-line")
          .onClick(() =>
            startTemplateWorkbenchAction(deps, "open-workbench", open),
          ),
      );
  };
}

function activeLeafFor(
  app: App,
  file: TFile | null,
): WorkspaceLeaf | undefined {
  const leaf = app.workspace.activeLeaf;
  return leaf?.view instanceof MarkdownView && leaf.view.file === file
    ? leaf
    : undefined;
}
