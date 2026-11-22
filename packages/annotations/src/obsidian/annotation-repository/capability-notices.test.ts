import { DateTime } from "effect";
import { describe, expect, it } from "vitest";

import * as m from "@zotlit/plugin-messages/messages.ts";

import { editingCapabilityCopy } from "./capability-copy.ts";
import {
  allowEditingNotice,
  CapabilityNoticeLedger,
} from "./capability-notices.ts";
import type { EditingCapability } from "./capability.ts";

import {
  cooldownFailureOf,
  deadlineAfter,
} from "#__fixtures__/annotation-repository/capability.ts";

const ATTACHMENT = "ABCD2345";
const OTHER_ATTACHMENT = "WXYZ6789";
const LIBRARY = "users/0";

const WRITABLE = { kind: "writable" } as const;
const CLOSED = { kind: "read-only", reason: "zotero-unavailable" } as const;
const NEEDS_AUTH = { kind: "authorization-required" } as const;

function clock(start = "2026-09-17T10:00:00Z") {
  let now = DateTime.makeUnsafe(start);
  return {
    read: () => now,
    advance: (seconds: number) => {
      now = DateTime.add(now, { seconds });
    },
    get instant() {
      return now;
    },
  };
}

function copyOf(capability: EditingCapability, now: DateTime.Utc) {
  const { label, detail } = editingCapabilityCopy(capability, now);
  return { label, detail };
}

function readOnlyLines(
  reason: Extract<EditingCapability, { kind: "read-only" }>["reason"],
  now: DateTime.Utc,
): string[] {
  const { label, detail } = copyOf({ kind: "read-only", reason }, now);
  return detail === null ? [label] : [label, detail];
}

function everyAttachmentIs(
  ledger: CapabilityNoticeLedger,
  capability: EditingCapability,
) {
  return new Map(
    ledger.openEpisodes().map((attachmentKey) => [attachmentKey, capability]),
  );
}

describe("authorization notice lifetime", () => {
  it("gives a remembered grant a brief success notice", () => {
    const notice = allowEditingNotice({ value: undefined });

    expect(notice).toMatchObject({ sticky: false, action: null });
    expect(notice?.durationMs).toBe(3000);
  });

  it.each(["not-remembered", "not-saved"] as const)(
    "keeps the normal reading time for %s",
    (kind) => {
      const notice = allowEditingNotice({ failure: { kind } });

      expect(notice).toMatchObject({ sticky: false });
      expect(notice).not.toHaveProperty("durationMs");
    },
  );
});

describe("a blocked keyboard gesture", () => {
  it("says why once per reason per Attachment per capability episode", () => {
    const time = clock();
    const ledger = new CapabilityNoticeLedger(time.read);
    const { label, detail } = copyOf(CLOSED, time.instant);

    const first = ledger.blockedGesture(ATTACHMENT, CLOSED);
    expect(first).toEqual({
      title: label,
      lines: [detail],
      sticky: false,
      action: expect.any(String),
    });

    time.advance(600);
    expect(ledger.blockedGesture(ATTACHMENT, CLOSED)).toBeNull();
    expect(ledger.blockedGesture(ATTACHMENT, CLOSED)).toBeNull();

    expect(ledger.blockedGesture(OTHER_ATTACHMENT, CLOSED)).not.toBeNull();

    const needsAuth = copyOf(NEEDS_AUTH, time.instant);
    expect(ledger.blockedGesture(ATTACHMENT, NEEDS_AUTH)).toMatchObject({
      title: needsAuth.label,
      lines: [needsAuth.detail],
    });
    expect(ledger.blockedGesture(ATTACHMENT, NEEDS_AUTH)).toBeNull();
  });

  it("closes the episode when editing works again, and speaks on the next one", () => {
    const time = clock();
    const ledger = new CapabilityNoticeLedger(time.read);

    expect(ledger.blockedGesture(ATTACHMENT, CLOSED)).not.toBeNull();
    expect(ledger.blockedGesture(ATTACHMENT, CLOSED)).toBeNull();

    ledger.refresh(everyAttachmentIs(ledger, WRITABLE));
    expect(ledger.blockedGesture(ATTACHMENT, CLOSED)).not.toBeNull();

    expect(ledger.blockedGesture(ATTACHMENT, WRITABLE)).toBeNull();
    expect(ledger.blockedGesture(ATTACHMENT, CLOSED)).not.toBeNull();
  });

  it("counts a cooldown as one reason however far its deadline has moved", () => {
    const time = clock();
    const ledger = new CapabilityNoticeLedger(time.read);
    const cooling = (seconds: number): EditingCapability => ({
      kind: "cooldown",
      retryAfter: deadlineAfter(time.instant, seconds),
    });

    const notice = ledger.blockedGesture(ATTACHMENT, cooling(60));
    expect(notice?.lines[0]).toContain("60");

    time.advance(1);
    expect(ledger.blockedGesture(ATTACHMENT, cooling(59))).toBeNull();
    time.advance(30);
    expect(ledger.blockedGesture(ATTACHMENT, cooling(29))).toBeNull();
  });
});

describe("a write Zotero refused", () => {
  it("rolls back with one sticky notice for the requests ZotLit should not send", () => {
    const time = clock();
    const ledger = new CapabilityNoticeLedger(time.read);

    const invalid = ledger.writeRefused(
      { kind: "invalid-response", issue: "400 Invalid JSON" },
      LIBRARY,
    );
    const unsupported = ledger.writeRefused(
      { kind: "incompatible-zotero" },
      LIBRARY,
    );

    expect(invalid).toMatchObject({ sticky: true });
    expect(unsupported).toMatchObject({ sticky: true });
    expect(invalid).not.toHaveProperty("durationMs");
    expect(unsupported).not.toHaveProperty("durationMs");
    expect(invalid?.lines).toEqual(
      readOnlyLines("invalid-response", time.instant),
    );
    expect(unsupported?.lines).toEqual(
      readOnlyLines("incompatible-zotero", time.instant),
    );
    expect(invalid?.title).toBe(unsupported?.title);
  });

  it("says a read-only library once while that refusal stands, per library", () => {
    const ledger = new CapabilityNoticeLedger(clock().read);
    const refusal = { kind: "library-read-only" } as const;

    expect(ledger.writeRefused(refusal, LIBRARY)).not.toBeNull();
    expect(ledger.writeRefused(refusal, LIBRARY)).toBeNull();
    expect(ledger.writeRefused(refusal, "groups/4711")).not.toBeNull();
    expect(ledger.writeRefused(refusal, "groups/4711")).toBeNull();

    ledger.writeRefusalsRetired();
    expect(ledger.writeRefused(refusal, LIBRARY)).not.toBeNull();
    expect(ledger.writeRefused(refusal, "groups/4711")).not.toBeNull();
  });

  it("leaves the refusals the write path answers itself alone", () => {
    const ledger = new CapabilityNoticeLedger(clock().read);
    const answered = [
      { kind: "unauthorized" },
      { kind: "denied" },
      { kind: "conflict" },
      { kind: "write-token-used" },
      { kind: "unreachable" },
      { kind: "local-api-disabled" },
      { kind: "unknown-outcome" },
      { kind: "server-changed" },
      cooldownFailureOf(60),
    ] as const;

    expect(
      answered.map((failure) => ledger.writeRefused(failure, LIBRARY)),
    ).toEqual(answered.map(() => null));
  });
});

describe("a Zotero database swapped under the port", () => {
  it("says one notice per database, whatever found the change", () => {
    const time = clock();
    const ledger = new CapabilityNoticeLedger(time.read);

    const first = ledger.serverChanged("A1B2C3D4E5F6");
    expect(first?.lines).toEqual(readOnlyLines("server-changed", time.instant));
    expect(first).toMatchObject({ sticky: false });

    expect(ledger.serverChanged("A1B2C3D4E5F6")).toBeNull();
    expect(ledger.serverChanged("A1B2C3D4E5F6")).toBeNull();

    ledger.refresh(everyAttachmentIs(ledger, WRITABLE));
    expect(ledger.serverChanged("A1B2C3D4E5F6")).toBeNull();

    expect(ledger.serverChanged("F6E5D4C3B2A1")).not.toBeNull();
    expect(ledger.serverChanged("F6E5D4C3B2A1")).toBeNull();
    expect(ledger.serverChanged("A1B2C3D4E5F6")).not.toBeNull();
  });
});

describe("a Write Conflict the user cannot see", () => {
  it("says so once, with the verb that opens the card", () => {
    const time = clock();
    const ledger = new CapabilityNoticeLedger(time.read);

    const first = ledger.conflictOffScreen("PUPR5FG5");

    expect(first).toEqual({
      title: m.notice_write_conflict(),
      lines: [m.notice_write_conflict_detail()],
      sticky: false,
      action: m.notice_write_conflict_show(),
    });
    expect(ledger.conflictOffScreen("PUPR5FG5")).toBeNull();
  });

  it("speaks again once that conflict is over, and for another Annotation", () => {
    const time = clock();
    const ledger = new CapabilityNoticeLedger(time.read);
    ledger.conflictOffScreen("PUPR5FG5");

    expect(ledger.conflictOffScreen("C94NJNYG")).not.toBeNull();

    ledger.conflictResolved("PUPR5FG5");
    expect(ledger.conflictOffScreen("PUPR5FG5")).not.toBeNull();
  });
});
