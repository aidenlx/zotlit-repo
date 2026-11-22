import type { SetupActions } from "#desktop/welcome/setup-actions.ts";
import { Component } from "obsidian";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import { Button } from "@zotlit/obsidian-kit/components/obsidian/button.tsx";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { PaneState } from "@zotlit/obsidian-kit/components/pane-state.tsx";
import type { ViewRegistryHandle } from "@zotlit/obsidian-kit/view-atoms.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { useUniqueId } from "@zotlit/ui";
import { zoteroStateAtom } from "@zotlit/zotero-reads/client/atoms.ts";
import type { ZoteroReadsState } from "@zotlit/zotero-reads/client/service.ts";

import { refreshFailed, unavailable } from "#desktop/welcome/connection.ts";

export interface ZoteroNotFoundDeps {
  registry: ViewRegistryHandle;
  setupActions: Pick<SetupActions, "locateZotero" | "openSettings">;
}

export interface ZoteroNotFoundSlots {
  shell: HTMLElement;
  tree: HTMLElement;
  list: HTMLElement;
  note: HTMLElement;
}

export class ZoteroNotFound extends Component {
  readonly #deps: ZoteroNotFoundDeps;
  readonly #slots: ZoteroNotFoundSlots;
  readonly #found: () => void;
  #roots: Root[] = [];
  #note: Root | null = null;

  constructor(
    deps: ZoteroNotFoundDeps,
    slots: ZoteroNotFoundSlots,
    found: () => void,
  ) {
    super();
    this.#deps = deps;
    this.#slots = slots;
    this.#found = found;
  }

  override onload(): void {
    const { registry, setupActions } = this.#deps;
    const { shell, tree, list, note } = this.#slots;
    this.#note = this.#mount(note, null);
    const update = (reads: ZoteroReadsState) => {
      const missing = unavailable({ reads });
      const was = shell.hasAttribute("data-zotero-missing");
      shell.toggleAttribute("data-zotero-missing", missing);
      this.#note?.render(
        refreshFailed({ reads }) ? (
          <RefreshFailedNote actions={setupActions} />
        ) : null,
      );
      if (was && !missing) this.#found();
    };
    this.register(
      registry.subscribe(zoteroStateAtom, update, { immediate: true }),
    );
    this.#mount(tree, <TreeNotFound />);
    this.#mount(list, <ListNotFound actions={setupActions} />);
  }

  #mount(el: HTMLElement, content: ReactNode): Root {
    const root = createRoot(el);
    root.render(content);
    this.#roots.push(root);
    return root;
  }

  override onunload(): void {
    for (const root of this.#roots) root.unmount();
    this.#roots = [];
    this.#note = null;
  }
}

type Actions = ZoteroNotFoundDeps["setupActions"];

function TreeNotFound() {
  return (
    <div
      data-library-not-found="tree"
      className="zt:flex zt:items-center zt:gap-(--size-2-3) zt:p-(--size-4-2) zt:px-(--size-4-4) zt:text-(length:--nav-item-size) zt:text-warning"
    >
      <Icon name="triangle-alert" size="s" />
      {m.library_view_not_found()}
    </div>
  );
}

function RefreshFailedNote({ actions }: { actions: Actions }) {
  return (
    <div
      role="status"
      data-library-refresh-failed=""
      className="zt:mx-(--zt-query-toolbar-inset-start) zt:mt-(--size-4-2) zt:flex zt:flex-wrap zt:items-center zt:gap-(--size-4-2) zt:rounded-(--radius-m) zt:border-(length:--border-width) zt:border-(--background-modifier-border) zt:px-(--size-4-3) zt:py-(--size-4-2) zt:text-(length:--font-ui-small) zt:text-muted-foreground"
    >
      <Icon name="triangle-alert" size="s" className="zt:text-warning" />
      <span className="zt:min-w-0 zt:flex-1">
        {m.library_view_refresh_failed()}
      </span>
      <Button icon="folder-search" onClick={actions.locateZotero}>
        {m.library_view_locate()}
      </Button>
    </div>
  );
}

function ListNotFound({ actions }: { actions: Actions }) {
  const titleId = useUniqueId();
  return (
    <PaneState>
      <section
        aria-labelledby={titleId}
        data-library-not-found="list"
        className="zt:w-full zt:max-w-120 zt:px-(--size-4-6) zt:py-(--size-4-12) zt:text-center"
      >
        <div
          id={titleId}
          role="heading"
          aria-level={2}
          className="zt:text-(length:--font-ui-medium) zt:font-(--font-semibold)"
        >
          {m.library_view_not_found()}
        </div>
        <p className="zt:mt-(--size-4-2) zt:text-sm zt:text-balance zt:text-muted-foreground">
          {m.library_view_not_found_body()}
        </p>
        <div className="zt:mt-(--size-4-4) zt:flex zt:flex-wrap zt:justify-center zt:gap-(--size-4-2)">
          <Button
            variant="cta"
            icon="folder-search"
            onClick={actions.locateZotero}
          >
            {m.library_view_locate()}
          </Button>
          <Button icon="settings" onClick={actions.openSettings}>
            {m.welcome_action_open_settings()}
          </Button>
        </div>
      </section>
    </PaneState>
  );
}
