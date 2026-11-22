import type { DateTime } from "effect";

import * as m from "@zotlit/plugin-messages/messages.ts";
import type {
  LocalApiFailure,
  LocalApiResult,
} from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";

import { editingCapabilityCopy } from "./capability-copy.ts";
import { capabilityReason } from "./capability.ts";
import type { EditingCapability } from "./capability.ts";

export interface CapabilityNotice {
  title: string;
  lines: readonly string[];
  sticky: boolean;
  durationMs?: number;
  action: string | null;
}

export function allowEditingNotice(
  result: LocalApiResult<void>,
): CapabilityNotice | null {
  if (!("failure" in result)) {
    return {
      ...plainNotice(m.notice_zotero_editing_enabled()),
      durationMs: 3000,
    };
  }
  switch (result.failure.kind) {
    case "not-remembered":
      return {
        ...plainNotice(m.notice_zotero_editing_not_remembered()),
        action: m.capability_enable_editing(),
      };
    case "not-saved":
      return plainNotice(m.notice_zotero_editing_not_saved());
    default:
      return null;
  }
}

function plainNotice(title: string): CapabilityNotice {
  return { title, lines: [], sticky: false, action: null };
}

export class CapabilityNoticeLedger {
  readonly #now;
  readonly #episodes = new Map<string, Set<string>>();
  #serverSpoken: string | null = null;
  readonly #readOnlyLibraries = new Set<string>();
  readonly #conflictsSpoken = new Set<string>();

  constructor(now: () => DateTime.Utc) {
    this.#now = now;
  }

  openEpisodes(): string[] {
    return [...this.#episodes.keys()];
  }

  refresh(capabilities: ReadonlyMap<string, EditingCapability>): void {
    for (const [attachmentKey, capability] of capabilities) {
      if (capability.kind === "writable") {
        this.#episodes.delete(attachmentKey);
      }
    }
  }

  serverChanged(serverID: string): CapabilityNotice | null {
    if (this.#serverSpoken === serverID) return null;
    this.#serverSpoken = serverID;
    return this.#rolledBack("server-changed", false);
  }

  conflictOffScreen(annotationKey: string): CapabilityNotice | null {
    if (this.#conflictsSpoken.has(annotationKey)) return null;
    this.#conflictsSpoken.add(annotationKey);
    return {
      title: m.notice_write_conflict(),
      lines: [m.notice_write_conflict_detail()],
      sticky: false,
      action: m.notice_write_conflict_show(),
    };
  }

  conflictResolved(annotationKey: string): void {
    this.#conflictsSpoken.delete(annotationKey);
  }

  writeRefusalsRetired(): void {
    this.#readOnlyLibraries.clear();
  }

  blockedGesture(
    attachmentKey: string,
    capability: EditingCapability,
  ): CapabilityNotice | null {
    if (capability.kind === "writable") {
      this.#episodes.delete(attachmentKey);
      return null;
    }
    let spoken = this.#episodes.get(attachmentKey);
    if (!spoken) {
      spoken = new Set();
      this.#episodes.set(attachmentKey, spoken);
    }
    const reason = capabilityReason(capability);
    if (spoken.has(reason)) return null;
    spoken.add(reason);

    const { label, detail } = editingCapabilityCopy(capability, this.#now());
    return {
      title: label,
      lines: detail === null ? [] : [detail],
      sticky: false,
      action: m.notice_capability_open_settings(),
    };
  }

  writeRefused(
    failure: LocalApiFailure,
    library: string,
  ): CapabilityNotice | null {
    switch (failure.kind) {
      case "invalid-response":
        return this.#rolledBack("invalid-response", true);
      case "incompatible-zotero":
        return this.#rolledBack("incompatible-zotero", true);
      case "library-read-only": {
        if (this.#readOnlyLibraries.has(library)) return null;
        this.#readOnlyLibraries.add(library);
        return this.#rolledBack("library-read-only", false);
      }
      default:
        return null;
    }
  }

  #rolledBack(
    reason: Extract<EditingCapability, { kind: "read-only" }>["reason"],
    sticky: boolean,
  ): CapabilityNotice {
    const { label, detail } = editingCapabilityCopy(
      { kind: "read-only", reason },
      this.#now(),
    );
    return {
      title: m.notice_write_not_saved(),
      lines: detail === null ? [label] : [label, detail],
      sticky,
      action: m.notice_capability_open_settings(),
    };
  }
}
