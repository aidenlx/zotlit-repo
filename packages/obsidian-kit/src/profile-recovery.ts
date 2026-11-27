import { Effect } from "effect";
import type { App, EventRef } from "obsidian";

import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { NoticeMessage } from "./notice.ts";
import type { WorkspaceEventHost } from "./obsidian-workspace.ts";
import type { UnknownProfileDiagnostic } from "./profile-stamp.ts";

export function requestProfileSwitch(
  host: WorkspaceEventHost,
  path: string,
): void {
  Effect.runSyncWith(logServices)(
    Effect.logDebug("Requested Profile recovery for {path}").pipe(
      Effect.annotateLogs({ path }),
      withLogCategory("profile-recovery"),
    ),
  );
  host.workspace.trigger("zotlit:switch-profile", { path });
}

export function profileRecoveryNotice(
  app: App,
  diagnostic: UnknownProfileDiagnostic,
  options: { path?: string; imported?: boolean } = {},
): NoticeMessage {
  const path = options.path ?? diagnostic.path;
  const message =
    options.imported && path
      ? m.notice_imported_note_profile_unknown({
          stamp: diagnostic.stamp,
          target: path,
        })
      : m.notice_literature_note_profile_unknown({ stamp: diagnostic.stamp });
  if (!path) return message;
  return {
    title: message,
    actions: [
      {
        label: m.profile_switch_recovery(),
        run: () => {
          requestProfileSwitch(app, path);
        },
      },
    ],
  };
}

export function renderProfileRecovery(
  container: HTMLElement,
  host: WorkspaceEventHost,
  options: { path?: string },
): void {
  container.querySelector("[data-profile-recovery]")?.remove();
  if (!options.path) return;
  const path = options.path;
  const button = container.ownerDocument.win.createEl("button");
  button.type = "button";
  button.dataset["profileRecovery"] = path;
  button.textContent = m.profile_switch_recovery();
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    requestProfileSwitch(host, path);
  });
  container.appendChild(button);
}

declare module "obsidian" {
  interface Workspace {
    on(
      name: "zotlit:switch-profile",
      callback: (request: { path: string }) => void,
      ctx?: unknown,
    ): EventRef;
  }
}
