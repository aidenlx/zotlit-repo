import type { NotFoundSignal } from "#core/welcome/not-found-notice.ts";
import { Effect } from "effect";
import type { App, Plugin } from "obsidian";

import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import { viewRuntime } from "@zotlit/obsidian-kit/view-atoms.ts";
import type { ViewRegistryHandle } from "@zotlit/obsidian-kit/view-atoms.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { zoteroStateAtom } from "@zotlit/zotero-reads/client/atoms.ts";

import { openLibraryView } from "./register.ts";
import { LIBRARY_VIEW_TYPE } from "./view.ts";

import { notFoundNoticeChange } from "#core/welcome/not-found-notice.ts";
import {
  dismissWelcomeCommand,
  keepWelcomeCommand,
  openReleaseNoteCommand,
} from "#desktop/welcome/atoms.ts";
import { connectionLifecycleAtom } from "#desktop/welcome/connection.ts";
import { holdSetupCommands } from "#desktop/welcome/setup-actions.ts";

export interface WelcomeRegistrationDeps {
  registry: ViewRegistryHandle;
}

const openWelcomeCommand = viewRuntime.fn((app: App) =>
  Effect.promise(() => openWelcomeView(app)),
);

export function registerWelcomeView(
  plugin: Pick<Plugin, "addCommand" | "app" | "register">,
  deps: WelcomeRegistrationDeps,
): void {
  const { registry } = deps;
  plugin.register(registry.mount(connectionLifecycleAtom));
  for (const command of [
    keepWelcomeCommand,
    dismissWelcomeCommand,
    openReleaseNoteCommand,
    openWelcomeCommand,
  ])
    plugin.register(registry.mount(command));
  plugin.register(holdSetupCommands(registry));

  plugin.addCommand({
    id: "open-welcome-view",
    name: m.command_open_welcome_name(),
    callback: () => registry.set(openWelcomeCommand, plugin.app),
  });

  let notice: BaseNotice | null = null;
  const hide = () => {
    notice?.hide();
    notice = null;
  };
  const apply = (signal: NotFoundSignal) => {
    const change = notFoundNoticeChange(signal, {
      shown: notice?.noticeEl.isConnected ?? false,
      libraryOpen:
        plugin.app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE).length > 0,
    });
    if (change === "hide") hide();
    if (change === "show")
      notice = notFoundNotice(() => {
        hide();
        void openLibraryView(plugin.app);
      });
  };
  watchNotFound(plugin, deps, apply);
}

export function watchNotFound(
  plugin: Pick<Plugin, "app" | "register">,
  { registry }: WelcomeRegistrationDeps,
  apply: (signal: NotFoundSignal) => void,
): void {
  let missing = false;
  plugin.register(
    registry.subscribe(
      zoteroStateAtom,
      (state) => {
        if (state.dbFileMissing === missing) return;
        missing = state.dbFileMissing;
        apply(missing ? "db-file-missing" : "changed");
      },
      { immediate: true },
    ),
  );
  const layout = plugin.app.workspace.on("layout-change", () =>
    apply("layout-change"),
  );
  plugin.register(() => plugin.app.workspace.offref(layout));
}

function notFoundNotice(locate: () => void): BaseNotice {
  return new BaseNotice(
    BaseNotice.render((renderer) => {
      renderer.setTitle(m.notice_db_not_found_on_device());
      renderer.addAction((button) => {
        button.setButtonText(m.notice_db_not_found_action()).onClick(locate);
      });
    }),
    0,
  );
}

export async function openWelcomeView(app: App): Promise<void> {
  const view = await openLibraryView(app);
  view?.welcome.request();
}
