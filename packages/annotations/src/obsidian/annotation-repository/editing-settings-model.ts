import type { ButtonComponent } from "obsidian";

import type { CapabilityCopy, CopyInstant } from "./capability-copy.ts";
import { editingCapabilityCopy } from "./capability-copy.ts";
import type { EditingCapability } from "./capability.ts";

export interface ActionState {
  shown: boolean;
  disabled: boolean;
}

export interface EditingRowModel {
  status: CapabilityCopy;
  enable: ActionState;
  check: ActionState;
  forget: ActionState;
  countsDown: boolean;
}

export interface EditingRowInput {
  capability: EditingCapability;
  checking?: boolean;
  remembered: boolean;
  now: CopyInstant;
}

export function editingRowModel({
  capability,
  checking = false,
  remembered,
  now,
}: EditingRowInput): EditingRowModel {
  return {
    status: editingCapabilityCopy(
      checking ? { kind: "read-only", reason: "probing" } : capability,
      now,
    ),
    enable: {
      shown: !checking && capability.kind === "authorization-required",
      disabled: checking || capability.kind !== "authorization-required",
    },
    check: {
      shown: checking || capability.kind === "read-only",
      disabled:
        checking ||
        (capability.kind === "read-only" && capability.reason === "probing"),
    },
    forget: {
      shown: remembered,
      disabled: checking || capability.kind === "authorizing",
    },
    countsDown: capability.kind === "cooldown",
  };
}

export function applyAction(
  button: ButtonComponent | undefined,
  state: ActionState,
): void {
  if (!button) return;
  button.buttonEl.toggle(state.shown);
  button.setDisabled(state.disabled);
}
