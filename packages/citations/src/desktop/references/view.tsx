import type { App, WorkspaceLeaf } from "obsidian";
import { ItemView } from "obsidian";
import { createRoot } from "react-dom/client";

import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import { showInLibraryCommand } from "@zotlit/obsidian-kit/show-in-library.ts";
import { ViewRegistryProvider } from "@zotlit/obsidian-kit/view-atoms.ts";
import type { ViewRegistryHandle } from "@zotlit/obsidian-kit/view-atoms.ts";
import { writeClipboardRichText } from "@zotlit/plugin-kernel/clipboard.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import {
  copyBibliographyMessage,
  createReferenceActions,
  ReferenceActionsContext,
} from "./actions.ts";
import {
  advanceOccurrence,
  holdReferencesModel,
  makeReferencesModel,
  ReferencesModelContext,
} from "./model.ts";
import { References } from "./References.tsx";

import {
  engineHintDismissedAtom,
  openIndexedKeyCommand,
  openReferenceLinkCommand,
  revealReferenceOccurrenceCommand,
  referencesSelectionAtom,
} from "#obsidian/references/atoms.ts";

export const REFERENCES_VIEW_TYPE = "zotlit-references";

export interface ReferencesViewDeps {
  registry: ViewRegistryHandle;
  app: App;
  openSettings: () => void;
  openStyleSettings: () => void;
}

export class ReferencesView extends ItemView {
  readonly model = makeReferencesModel();
  readonly #deps;
  #release: (() => void) | null;
  #cleanup: DisposableStack | null = null;

  constructor(leaf: WorkspaceLeaf, deps: ReferencesViewDeps) {
    super(leaf);
    this.contentEl.addClass("zt-root");
    this.contentEl.addClass("zt-references-view");
    this.#deps = deps;
    this.#release = holdReferencesModel(deps.registry, this.model);
  }

  override getViewType(): string {
    return REFERENCES_VIEW_TYPE;
  }
  override getDisplayText(): string {
    return m.references_view_name();
  }
  override getIcon(): string {
    return "quote";
  }

  protected override async onOpen(): Promise<void> {
    using cleanup = new DisposableStack();
    const { registry, app } = this.#deps;
    this.#release ??= holdReferencesModel(registry, this.model);
    cleanup.defer(registry.mount(openIndexedKeyCommand));
    cleanup.defer(registry.mount(showInLibraryCommand));
    cleanup.defer(registry.mount(openReferenceLinkCommand));
    cleanup.defer(registry.mount(revealReferenceOccurrenceCommand));
    const actions = createReferenceActions({
      app,
      getSourcePath: () => registry.get(referencesSelectionAtom).path,
      openIndexedKey: (key) => registry.set(openIndexedKeyCommand, key),
      showInLibrary: (key) => registry.set(showInLibraryCommand, key),
      openLinkText: (linkpath, sourcePath) =>
        registry.set(openReferenceLinkCommand, { linkpath, sourcePath }),
      nextOccurrence: (id, count) => {
        registry.update(this.model.cursors, advanceOccurrence(id, count));
        return registry.get(this.model.cursors)[id]!;
      },
      revealOccurrence: (sourcePath, occurrence) =>
        registry.set(revealReferenceOccurrenceCommand, {
          sourcePath,
          occurrence,
        }),
      onOpenEngineSettings: this.#deps.openSettings,
      onChangeStyle: this.#deps.openStyleSettings,
      onDismissEngineHint: () => registry.set(engineHintDismissedAtom, true),
      getCopySnapshot: () => registry.get(this.model.snapshot),
      writeClipboard: writeClipboardRichText,
      reportCopy: (outcome) =>
        void new BaseNotice(copyBibliographyMessage(outcome)),
    });
    cleanup.defer(
      registry.subscribe(this.model.state, () => this.leaf.updateHeader()),
    );
    const root = cleanup.adopt(createRoot(this.contentEl), (root) =>
      root.unmount(),
    );
    root.render(
      <ViewRegistryProvider registry={registry}>
        <ReferencesModelContext value={this.model}>
          <ReferenceActionsContext value={actions}>
            <References />
          </ReferenceActionsContext>
        </ReferencesModelContext>
      </ViewRegistryProvider>,
    );
    this.#cleanup = cleanup.move();
  }

  protected override async onClose(): Promise<void> {
    this.#cleanup?.dispose();
    this.#cleanup = null;
    this.#release?.();
    this.#release = null;
  }
}
