import semverGte from "semver/functions/gte";

import { docsUrl } from "@zotlit/obsidian-kit/docs-url.ts";
import { BaseNotice, noticeSteps } from "@zotlit/obsidian-kit/notice.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { shellStart } from "@zotlit/plugin-shell/obsidian/plugin.ts";

import { host } from "./host.ts";
import { linkActions } from "./link-actions.ts";

export function showInstallerUpdateNotice(): BaseNotice {
  return new BaseNotice(
    {
      title: m.notice_installer_update_needed(),
      lines: [
        m.notice_installer_update_explanation(),
        ...noticeSteps([
          m.notice_installer_update_step_download(),
          m.notice_installer_update_step_close(),
          m.notice_installer_update_step_run(),
        ]),
        m.notice_installer_update_no_uninstall(),
      ],
      actions: [
        {
          label: m.notice_installer_update_learn_more(),
          run: () => {
            window.open(docsUrl("/docs/how-to/update-obsidian-installer"));
          },
        },
        {
          label: m.notice_installer_update_download(),
          run: () => {
            window.open("https://obsidian.md/download");
          },
        },
      ],
    },
    0,
  );
}

function assertElectronVersion(): void {
  const version = process.versions.electron;
  if (!version) return;
  if (semverGte(version, __MIN_ELECTRON_VERSION__)) return;

  showInstallerUpdateNotice();
  throw new Error(
    `Obsidian installer is too old (Electron v${version}, required >=v${__MIN_ELECTRON_VERSION__})`,
  );
}

export const start = shellStart(host, {
  preflight: assertElectronVersion,
  linkActions,
});
