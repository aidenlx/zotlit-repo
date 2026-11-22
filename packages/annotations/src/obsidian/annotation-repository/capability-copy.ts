import * as m from "@zotlit/plugin-messages/messages.ts";

import type { EditingCapability } from "./capability.ts";

export interface CopyInstant {
  readonly epochMilliseconds: number;
}

export type CapabilityTone = "ready" | "action" | "busy" | "warning";

export interface CapabilityCopy {
  icon: string;
  tone: CapabilityTone;
  label: string;
  detail: string | null;
  spinning: boolean;
}

export function editingCapabilityCopy(
  capability: EditingCapability,
  now: CopyInstant,
): CapabilityCopy {
  switch (capability.kind) {
    case "writable":
      return {
        icon: "pencil",
        tone: "ready",
        label: m.capability_writable(),
        detail: null,
        spinning: false,
      };
    case "authorization-required":
      return {
        icon: "pencil",
        tone: "action",
        label: m.capability_authorization_required(),
        detail: m.capability_authorization_required_detail(),
        spinning: false,
      };
    case "authorizing":
      return {
        icon: "loader",
        tone: "busy",
        label: m.capability_authorizing(),
        detail: m.capability_authorizing_detail(),
        spinning: true,
      };
    case "cooldown":
      return {
        icon: "clock",
        tone: "busy",
        label: m.capability_cooldown(),
        detail: m.capability_cooldown_detail({
          seconds: secondsUntil(capability.retryAfter, now),
        }),
        spinning: false,
      };
    case "read-only":
      return readOnlyCopy(capability.reason);
  }
}

export interface CapabilityAffordance {
  disabled: boolean;
  icon: string;
  tone: CapabilityTone;
  tooltip: string;
  label: string;
  spinning: boolean;
  countdown: number | null;
}

export function editingCapabilityAffordance(
  capability: EditingCapability,
  now: CopyInstant,
): CapabilityAffordance | null {
  if (capability.kind === "writable" || capability.kind === "read-only")
    return null;
  const { icon, tone, label, detail, spinning } = editingCapabilityCopy(
    capability,
    now,
  );
  return {
    disabled: capability.kind !== "authorization-required",
    icon,
    tone,
    label:
      capability.kind === "authorization-required"
        ? m.capability_enable_editing()
        : label,
    tooltip:
      detail === null
        ? label
        : m.capability_affordance_tooltip({ label, detail }),
    spinning,
    countdown:
      capability.kind === "cooldown"
        ? secondsUntil(capability.retryAfter, now)
        : null,
  };
}

export function secondsUntil(deadline: CopyInstant, now: CopyInstant): number {
  const left = (deadline.epochMilliseconds - now.epochMilliseconds) / 1000;
  return left <= 0 ? 0 : Math.ceil(left);
}

function readOnlyCopy(
  reason: Extract<EditingCapability, { kind: "read-only" }>["reason"],
): CapabilityCopy {
  switch (reason) {
    case "probing":
      return {
        icon: "loader",
        tone: "busy",
        label: m.capability_probing(),
        detail: null,
        spinning: true,
      };
    case "zotero-unavailable":
      return warning(
        m.capability_zotero_unavailable(),
        m.capability_zotero_unavailable_detail(),
      );
    case "local-api-disabled":
      return warning(
        m.capability_local_api_disabled(),
        m.capability_local_api_disabled_detail(),
      );
    case "incompatible-zotero":
      return warning(
        m.capability_incompatible_zotero(),
        m.capability_incompatible_zotero_detail(),
      );
    case "invalid-response":
      return warning(
        m.capability_invalid_response(),
        m.capability_invalid_response_detail(),
      );
    case "server-changed":
      return warning(
        m.capability_server_changed(),
        m.capability_server_changed_detail(),
      );
    case "library-read-only":
      return warning(
        m.capability_library_read_only(),
        m.capability_library_read_only_detail(),
      );
  }
}

function warning(label: string, detail: string): CapabilityCopy {
  return {
    icon: "alert-triangle",
    tone: "warning",
    label,
    detail,
    spinning: false,
  };
}
