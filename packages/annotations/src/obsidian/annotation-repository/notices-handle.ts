import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";

import type { CapabilityNotices } from "./notices.ts";

export interface CapabilityNoticesHandle {
  allowEditing(): Promise<void>;
  showEditingCapability(): Promise<void>;
  reportBlockedGesture(attachmentKey: string): void;
}

export function bindCapabilityNotices(
  bridge: Pick<EffectBridge, "runPromise" | "runSync">,
  notices: CapabilityNotices["Service"],
): CapabilityNoticesHandle {
  return {
    allowEditing: () => bridge.runPromise(notices.allowEditing),
    showEditingCapability: () =>
      bridge.runPromise(notices.showEditingCapability),
    reportBlockedGesture: (attachmentKey) =>
      bridge.runSync(notices.reportBlockedGesture(attachmentKey)),
  };
}
