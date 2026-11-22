import { Effect } from "effect";
import { around } from "monkey-around";
import type { PaneType } from "obsidian";

import { disposable } from "@zotlit/obsidian-kit/disposables.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import type { AttachmentResolver } from "@zotlit/plugin-services/obsidian/attachment-resolver/service.ts";
import type { PluginSettings } from "@zotlit/plugin-services/obsidian/settings/service.ts";

import type { TargetOpener } from "./open-target.ts";

export const EXTERNAL_TARGET = "_external";

export function openWithSystem(url: string): void {
  window.open(url, EXTERNAL_TARGET);
}

export function paneFromTarget(target: string | undefined): PaneType | boolean {
  switch (target) {
    case "tab":
    case "split":
    case "window":
      return target;
    default:
      return false;
  }
}

export interface FileLinkCaptureDeps {
  opener: Pick<TargetOpener["Service"], "follow">;
  attachments: Pick<AttachmentResolver["Service"], "warm">;
  settings: Pick<PluginSettings["Service"], "current">;
  bridge: Pick<EffectBridge, "runSync" | "runAndForget">;
  window?: Window;
}

export function registerFileLinkCapture(deps: FileLinkCaptureDeps): Disposable {
  const host = (deps.window ?? window) as { open: Window["open"] };
  deps.bridge.runSync(deps.attachments.warm);

  return disposable(
    around(host, {
      open:
        (native) =>
        (url?: string | URL, target?: string, features?: string) => {
          if (
            target === EXTERNAL_TARGET ||
            url === undefined ||
            !deps.bridge.runSync(deps.settings.current)[
              "reader.open-file-links"
            ]
          ) {
            return native(url, target, features);
          }
          const followed = deps.bridge.runSync(
            deps.opener.follow(String(url), paneFromTarget(target)),
          );
          if (followed === null) return native(url, target, features);

          deps.bridge.runAndForget(
            Effect.logDebug("Link captured").pipe(
              Effect.annotateLogs({ url: String(url), target }),
              withLogCategory("attachment-open"),
              Effect.andThen(followed),
            ),
          );
          return null;
        },
    }),
  );
}
