import type { Attachment } from "@zotlit/db";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";

import type { ObsidianOpenableAttachment } from "./resolve.ts";
import { toObsidianOpenableAttachments } from "./resolve.ts";

export function toObsidianOpenable(
  attachments: readonly Attachment[],
  {
    vaultBasePath,
    zoteroPref,
  }: {
    vaultBasePath: string;
    zoteroPref: Pick<ZoteroPrefSnapshot, "dataDir" | "baseAttachmentPath">;
  },
): ObsidianOpenableAttachment[] {
  return toObsidianOpenableAttachments(attachments, {
    pathContext: {
      dataDir: zoteroPref.dataDir,
      baseAttachmentPath: zoteroPref.baseAttachmentPath,
    },
    vaultBasePath,
    platform: process.platform,
  });
}
