import type { Attachment } from "@zotlit/db";
import type { AttachmentPathContext } from "@zotlit/db/path";
import { isPdfAttachment } from "@zotlit/plugin-services/core/attachment-resolver/pdf-attachment.ts";
import type { OperatingSystem } from "@zotlit/shared/platform";

import type { ObsidianOpenableAttachment } from "./resolve.ts";
import { toObsidianOpenableAttachments } from "./resolve.ts";

export interface OpenablePdfs {
  readonly attachments: ObsidianOpenableAttachment[];
  readonly filesUnavailable: boolean;
}

export const NO_OPENABLE_PDFS: OpenablePdfs = {
  attachments: [],
  filesUnavailable: false,
};

export function toObsidianOpenable(
  attachments: readonly Attachment[],
  {
    vaultBasePath,
    zoteroPref,
    platform,
  }: {
    vaultBasePath: string;
    zoteroPref: AttachmentPathContext;
    platform: OperatingSystem;
  },
): OpenablePdfs {
  return {
    attachments: toObsidianOpenableAttachments(attachments, {
      pathContext: {
        dataDir: zoteroPref.dataDir,
        baseAttachmentPath: zoteroPref.baseAttachmentPath,
      },
      vaultBasePath,
      platform,
    }),
    filesUnavailable:
      zoteroPref.dataDir === null &&
      attachments.some((attachment) =>
        isPdfAttachment(attachment.contentType, attachment.path ?? ""),
      ),
  };
}
