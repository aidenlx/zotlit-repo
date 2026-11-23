import { DateTime } from "effect";
import { expect, it } from "vitest";

import type {
  LocalApiFailure,
  LocalApiState,
  WriteAuthorizationState,
} from "@zotlit/plugin-services/obsidian/zotero-local-api/service.ts";

import { editingCapabilityOf } from "./capability.ts";
import type { EditingCapability } from "./capability.ts";

import { cooldownFailureOf } from "#__fixtures__/annotation-repository/capability.ts";

const NOW = DateTime.makeUnsafe("2026-09-16T15:52:21Z");

const SOURCE = {
  kind: "zotero-local-api",
  serverID: "A8sf5Zsz8ySw",
} as const;

it("lets a session with a remembered authorization write, and asks otherwise", () => {
  expect(
    capabilityOf({ kind: "available", source: SOURCE, authorized: true }),
  ).toEqual({ kind: "writable" });
  expect(
    capabilityOf({ kind: "available", source: SOURCE, authorized: false }),
  ).toEqual({ kind: "authorization-required" });
});

it("says it is checking while no probe has answered", () => {
  expect(capabilityOf({ kind: "probing" })).toEqual({
    kind: "read-only",
    reason: "probing",
  });
});

it.each<[LocalApiFailure, string]>([
  [{ kind: "unreachable" }, "zotero-unavailable"],
  [{ kind: "unknown-outcome" }, "zotero-unavailable"],
  [{ kind: "local-api-disabled" }, "local-api-disabled"],
  [{ kind: "incompatible-zotero" }, "incompatible-zotero"],
  [{ kind: "server-changed" }, "server-changed"],
  [{ kind: "library-read-only" }, "library-read-only"],
  [{ kind: "invalid-response", issue: "server id absent" }, "invalid-response"],
  [{ kind: "conflict" }, "invalid-response"],
  [{ kind: "write-token-used" }, "invalid-response"],
])("reads %o as read-only with its own reason", (failure, reason) => {
  expect(capabilityOf({ kind: "unavailable", failure })).toEqual({
    kind: "read-only",
    reason,
  });
});

it.each<LocalApiFailure>([
  { kind: "unauthorized" },
  { kind: "denied" },
  { kind: "not-confirmed" },
])("keeps authorization available after %o", (failure) => {
  expect(capabilityOf({ kind: "unavailable", failure })).toEqual({
    kind: "authorization-required",
  });
});

it("turns Zotero's cooldown into the instant it ends", () => {
  const failure: LocalApiFailure = cooldownFailureOf(97);

  expect(capabilityOf({ kind: "unavailable", failure })).toEqual({
    kind: "cooldown",
    retryAfter: DateTime.makeUnsafe("2026-09-16T15:53:58Z"),
  });
});

const NO_WRITES: WriteAuthorizationState = {
  authorizing: false,
  libraryReadOnly: false,
  cooldownUntil: null,
};

function capabilityOf(
  state: LocalApiState,
  writes: WriteAuthorizationState = NO_WRITES,
): EditingCapability {
  return editingCapabilityOf(state, writes, NOW);
}

it("says it is asking while a gesture stands at Zotero's dialog", () => {
  expect(
    capabilityOf(
      { kind: "available", source: SOURCE, authorized: false },
      { ...NO_WRITES, authorizing: true },
    ),
  ).toEqual({ kind: "authorizing" });
});

it("reads a library Zotero refuses writes to as read-only, whatever else holds", () => {
  const libraryReadOnly = { ...NO_WRITES, libraryReadOnly: true };

  expect(
    capabilityOf(
      { kind: "available", source: SOURCE, authorized: true },
      { ...libraryReadOnly, authorizing: true },
    ),
  ).toEqual({ kind: "read-only", reason: "library-read-only" });
});

it("counts down Zotero's dialog cooldown only while it blocks the asking", () => {
  const cooldownUntil = DateTime.add(NOW, { seconds: 44 });
  const cooling = { ...NO_WRITES, cooldownUntil };

  expect(
    capabilityOf(
      { kind: "available", source: SOURCE, authorized: false },
      cooling,
    ),
  ).toEqual({ kind: "cooldown", retryAfter: cooldownUntil });
  expect(
    capabilityOf(
      { kind: "available", source: SOURCE, authorized: true },
      cooling,
    ),
  ).toEqual({ kind: "writable" });
  expect(
    capabilityOf(
      { kind: "available", source: SOURCE, authorized: false },
      { ...NO_WRITES, cooldownUntil: NOW },
    ),
  ).toEqual({ kind: "authorization-required" });
});
