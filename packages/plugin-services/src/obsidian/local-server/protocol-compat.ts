import { Effect } from "effect";

import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { checkProtocolVersion, PROTOCOL_VERSION } from "@zotlit/protocol";
import type { ProtocolVersionCheck } from "@zotlit/protocol";

const noticedVersions = new Set<string>();

export function rejectIncompatibleProtocol(
  received: unknown,
  category: string,
  context: Record<string, unknown>,
): boolean {
  const check = checkProtocolVersion(received);
  if (check.ok) return false;

  Effect.runSyncWith(logServices)(
    Effect.logWarning("Rejected incompatible ZotLit protocol message").pipe(
      Effect.annotateLogs({
        ...context,
        expectedProtocolVersion: PROTOCOL_VERSION,
        receivedProtocolVersion: check.received,
        reason: check.reason,
      }),
      withLogCategory(category),
    ),
  );
  showProtocolNotice(check);
  return true;
}

function showProtocolNotice(
  check: Exclude<ProtocolVersionCheck, { ok: true }>,
) {
  const key = check.received === null ? check.reason : String(check.received);
  if (noticedVersions.has(key)) return;
  noticedVersions.add(key);

  new BaseNotice(protocolNoticeMessage(check));
}

function protocolNoticeMessage(
  check: Exclude<ProtocolVersionCheck, { ok: true }>,
): string {
  if (check.reason === "newer") return m.notice_protocol_update_obsidian();
  return m.notice_protocol_update_zotero();
}
