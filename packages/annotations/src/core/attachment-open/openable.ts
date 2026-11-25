import type { Attachment } from "@zotlit/db";
import type { ZoteroPrefSnapshot } from "@zotlit/plugin-services/core/zotero-pref/service.ts";
import type { OperatingSystem } from "@zotlit/shared/platform";

import type { ObsidianOpenableAttachment } from "./resolve.ts";
import { toObsidianOpenableAttachments } from "./resolve.ts";

export function toObsidianOpenable(
  attachments: readonly Attachment[],
  {
    vaultBasePath,
    zoteroPref,
    platform,
  }: {
    vaultBasePath: string;
    zoteroPref: Pick<ZoteroPrefSnapshot, "dataDir" | "baseAttachmentPath">;
    platform: OperatingSystem;
  },
): ObsidianOpenableAttachment[] {
  return toObsidianOpenableAttachments(attachments, {
    pathContext: {
      dataDir: zoteroPref.dataDir,
      baseAttachmentPath: zoteroPref.baseAttachmentPath,
    },
    vaultBasePath,
    platform,
  });
}
