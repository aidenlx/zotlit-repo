import { dirname } from "node:path";

import { requireElectron } from "@zotlit/obsidian-desktop/require.ts";
import { noticeList } from "@zotlit/obsidian-kit/notice.ts";
import type { NoticeContent } from "@zotlit/obsidian-kit/notice.ts";
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

export function openBackupFolder(backups: readonly string[]): Promise<void> {
  const folder = dirname(backups[0]!);
  const done = requireElectron()
    .shell.openPath(folder)
    .then((refused) => {
      if (refused) throw new Error(refused);
    });
  void toast.promise(done, {
    error: m.notice_pandoc_integration_backup_folder_open_failed(),
  });
  return done;
}

export function renderPandocIntegrationBackupNotice(
  backups: readonly string[],
): NoticeContent {
  return {
    title: m.notice_pandoc_integration_restore_failed(),
    lines: noticeList(m.notice_pandoc_integration_backups_kept(), backups),
    actions: [
      {
        label: m.notice_pandoc_integration_copy_backup_path(),
        run: () => void copyBackupFolderPath(backups),
      },
      {
        label: m.notice_pandoc_integration_open_backup_folder(),
        run: () => void openBackupFolder(backups),
      },
    ],
  };
}
