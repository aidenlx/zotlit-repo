import { dirname } from "node:path";

import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import * as toast from "@zotlit/obsidian-kit/toast.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

export function copyBackupFolderPath(
  backups: readonly string[],
): Promise<void> {
  const folder = dirname(backups[0]!);
  const done = navigator.clipboard.writeText(folder);
  void toast.promise(done, {
    success: m.notice_pandoc_integration_backup_path_copied(),
    error: m.notice_pandoc_integration_backup_path_copy_failed(),
  });
  return done;
}

export function renderPandocIntegrationBackupNotice(
  backups: readonly string[],
): DocumentFragment {
  return BaseNotice.render((renderer) => {
    renderer
      .setTitle(m.notice_pandoc_integration_restore_failed())
      .addList(m.notice_pandoc_integration_backups_kept(), backups)
      .addAction((button) => {
        button
          .setButtonText(m.notice_pandoc_integration_copy_backup_path())
          .onClick(() => void copyBackupFolderPath(backups));
      });
  });
}
