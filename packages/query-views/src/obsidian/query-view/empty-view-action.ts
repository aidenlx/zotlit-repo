import { Effect } from "effect";
import { around } from "monkey-around";
import type { App, EmptyView, PlatformInternals } from "obsidian";
import { Platform, setIcon, setTooltip } from "obsidian";

import { disposable } from "@zotlit/obsidian-kit/disposables.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

const ACTION_CLASS = "zt-empty-state-new-query";

function isEmptyView(view: unknown): view is EmptyView {
  return (
    view instanceof Object &&
    (view as Partial<EmptyView>).getViewType?.() === "empty" &&
    ((view as Partial<EmptyView>).actionListEl?.instanceOf(HTMLElement) ??
      false) &&
    typeof (view as Partial<EmptyView>).onOpen === "function"
  );
}

function anyEmptyView(app: App): EmptyView | null {
  let found: EmptyView | null = null;
  app.workspace.iterateAllLeaves((leaf) => {
    if (!found && isEmptyView(leaf._empty)) found = leaf._empty;
  });
  return found;
}

export interface EmptyViewAction {
  commandId: string;
  run: (event: MouseEvent | KeyboardEvent) => void;
}

function actionOf(view: EmptyView): HTMLElement | null {
  return view.actionListEl.querySelector(`.${ACTION_CLASS}`);
}

function afterNewPills(app: App, list: HTMLElement): Element | null {
  const newPills =
    1 +
    Number(Boolean(app.internalPlugins.getEnabledPluginById("bases"))) +
    Number(Boolean(app.internalPlugins.getEnabledPluginById("canvas")));
  return list.children.item(newPills);
}

function addAction(
  app: App,
  view: EmptyView,
  { commandId, run }: EmptyViewAction,
): void {
  if (actionOf(view)) return;
  const list = view.actionListEl;
  const label = m.empty_state_new_query();
  const before = afterNewPills(app, list);
  const button = list.createDiv({
    cls: [
      "text-icon-button",
      "tappable",
      "mod-pill",
      "empty-state-action",
      ACTION_CLASS,
    ],
    attr: { tabIndex: 0, role: "button" },
  });
  list.insertBefore(button, before);
  setIcon(button.createSpan("text-button-icon"), "list-filter");
  button.createSpan({ cls: "text-button-label", text: label });
  setTooltip(button, label);
  if ((Platform as typeof Platform & PlatformInternals).hasPhysicalKeyboard) {
    const hotkey = app.hotkeyManager.printHotkeyForCommand(commandId);
    if (hotkey)
      button.createSpan({ cls: "empty-state-hotkey", text: ` ${hotkey}` });
  }
  button.addEventListener("click", (event) => {
    event.preventDefault();
    run(event);
  });
  button.addEventListener("keydown", (event) => {
    if (event.isComposing || event.defaultPrevented) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    run(event);
  });
}

function eachOpenEmptyView(app: App, callback: (view: EmptyView) => void) {
  app.workspace.iterateAllLeaves((leaf) => {
    if (isEmptyView(leaf.view)) callback(leaf.view);
  });
}

export function installEmptyViewAction(
  app: App,
  action: EmptyViewAction,
): Disposable {
  const anyInstance = anyEmptyView(app);
  if (!anyInstance) {
    Effect.runSyncWith(logServices)(
      Effect.logWarning(
        "No leaf holds an empty view; New Zotero query table is left off the empty tab",
      ).pipe(withLogCategory("views", "query-view", "empty-view")),
    );
    return new DisposableStack();
  }
  const add = (view: EmptyView) => addAction(app, view, action);
  const uninstall = around(Object.getPrototypeOf(anyInstance) as EmptyView, {
    onOpen: (native) =>
      async function (this: EmptyView) {
        await native.call(this);
        add(this);
      },
  });
  eachOpenEmptyView(app, add);
  return disposable(() => {
    uninstall();
    eachOpenEmptyView(app, (view) => actionOf(view)?.remove());
  });
}
