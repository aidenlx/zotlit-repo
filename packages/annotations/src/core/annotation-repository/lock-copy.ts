import * as m from "@zotlit/plugin-messages/messages.ts";

import type { LockReason } from "./lock.ts";

export function lockReasonText(reason: LockReason): string {
  switch (reason) {
    case "external":
      return m.annot_view_lock_external();
    case "another-user":
      return m.annot_view_lock_another_user();
  }
}
