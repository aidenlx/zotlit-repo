import { DateTime } from "effect";

import type {
  LocalApiFailure,
  LocalApiState,
  WriteAuthorizationState,
} from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";

export type EditingCapability =
  | { kind: "writable" }
  | { kind: "authorization-required" }
  | { kind: "authorizing" }
  | { kind: "cooldown"; retryAfter: DateTime.Utc }
  | {
      kind: "read-only";
      reason:
        | "zotero-unavailable"
        | "local-api-disabled"
        | "incompatible-zotero"
        | "invalid-response"
        | "server-changed"
        | "library-read-only"
        | "probing";
    };

export function capabilityReason(capability: EditingCapability): string {
  return capability.kind === "read-only"
    ? `read-only:${capability.reason}`
    : capability.kind;
}

export function sameDeadline(a: DateTime.Utc, b: DateTime.Utc): boolean {
  return DateTime.Equivalence(a, b);
}

export function editingCapabilityOf(
  state: LocalApiState,
  writes: WriteAuthorizationState,
  now: DateTime.Utc,
): EditingCapability {
  if (writes.libraryReadOnly) {
    return { kind: "read-only", reason: "library-read-only" };
  }
  if (writes.authorizing) return { kind: "authorizing" };
  switch (state.kind) {
    case "available": {
      if (state.authorized) return { kind: "writable" };
      const cooldownUntil = writes.cooldownUntil;
      return cooldownUntil !== null &&
        DateTime.isGreaterThan(cooldownUntil, now)
        ? { kind: "cooldown", retryAfter: cooldownUntil }
        : { kind: "authorization-required" };
    }
    case "probing":
      return { kind: "read-only", reason: "probing" };
    default:
      return capabilityOfFailure(state.failure, now);
  }
}

export function capabilityOfFailure(
  failure: LocalApiFailure,
  now: DateTime.Utc,
): EditingCapability {
  switch (failure.kind) {
    case "unreachable":
    case "unknown-outcome":
      return { kind: "read-only", reason: "zotero-unavailable" };
    case "local-api-disabled":
      return { kind: "read-only", reason: "local-api-disabled" };
    case "incompatible-zotero":
      return { kind: "read-only", reason: "incompatible-zotero" };
    case "server-changed":
      return { kind: "read-only", reason: "server-changed" };
    case "library-read-only":
      return { kind: "read-only", reason: "library-read-only" };
    case "unauthorized":
    case "denied":
    case "not-remembered":
    case "not-saved":
      return { kind: "authorization-required" };
    case "cooldown":
      return {
        kind: "cooldown",
        retryAfter: DateTime.addDuration(now, failure.retryAfter),
      };
    case "invalid-response":
    case "conflict":
    case "write-token-used":
    case "not-found":
      return { kind: "read-only", reason: "invalid-response" };
    default:
      failure satisfies never;
      return { kind: "read-only", reason: "invalid-response" };
  }
}
