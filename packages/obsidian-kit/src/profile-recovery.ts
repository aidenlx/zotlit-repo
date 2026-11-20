// UI recovery for an unavailable Profile, shared by notes and citation surfaces.
import { Effect } from "effect";
import type { App, EventRef } from "obsidian";

import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { BaseNotice } from "./notice.ts";
import type { WorkspaceEventHost } from "./obsidian-workspace.ts";
import type { UnknownProfileDiagnostic } from "./profile-stamp.ts";

/** Ask for a Profile switch on the host's workspace: the app, or the Workspace tag's trigger. */
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
): string | DocumentFragment {
  const path = options.path ?? diagnostic.path;
  const message =
    options.imported && path
      ? m.notice_imported_note_profile_unknown({
          stamp: diagnostic.stamp,
          target: path,
        })
      : m.notice_literature_note_profile_unknown({ stamp: diagnostic.stamp });
  if (!path) return message;
  return BaseNotice.render((renderer) => {
    renderer.setTitle(message).addAction((button) => {
      button.setButtonText(m.profile_switch_recovery()).onClick(() => {
        requestProfileSwitch(app, path);
      });
    });
  });
}

/** One recovery control per reading section, cleared when its failure clears. */
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
    /** A request to switch the Profile of the note at `request.path`. */
    on(
      name: "zotlit:switch-profile",
      callback: (request: { path: string }) => void,
      ctx?: unknown,
    ): EventRef;
  }
}
