import { describe, expect, it } from "vitest";

import * as m from "@zotlit/plugin-messages/messages.ts";
import type {
  WebSyncProblem,
  WebSyncStatus,
} from "@zotlit/zotero-reads/contract/web-worker-rpc.ts";

import type { OnlineLibraryStatus } from "./status.ts";
import { isProblem, statusText } from "./status.ts";

const LAST = Temporal.Instant.from("2026-11-20T09:30:00Z");
const time = (instant: Temporal.Instant) => `at ${instant.toString()}`;

const sync = (patch: Partial<WebSyncStatus> = {}): WebSyncStatus => ({
  state: "ready",
  syncing: false,
  syncId: null,
  waitingForReaders: false,
  problem: null,
  progress: null,
  zoteroLocale: "en-US",
  unconsentedUserID: null,
  libraries: [],
  ...patch,
});

const synced = {
  libraries: [
    {
      library: { type: "user", id: 42 },
      committedVersion: 10,
      lastSync: LAST,
      retained: { deferred: 0, skipped: 0 },
    },
  ],
} as const;

const running = (patch: Partial<WebSyncStatus> = {}): OnlineLibraryStatus => ({
  kind: "running",
  sync: sync(patch),
  account: null,
  serverSchemaVersion: null,
});

describe("the text of the online library state", () => {
  it.each<[string, OnlineLibraryStatus, string]>([
    ["no key", { kind: "no-key" }, m.settings_online_status_no_key()],
    [
      "no Resource Pack",
      { kind: "pack", refusal: { kind: "pack-absent" } },
      m.settings_resource_pack_status_absent(),
    ],
    [
      "an old Resource Pack",
      { kind: "pack", refusal: { kind: "pack-outdated" } },
      m.settings_resource_pack_status_pack_outdated(),
    ],
    [
      "an old plugin",
      { kind: "pack", refusal: { kind: "plugin-outdated" } },
      m.settings_resource_pack_status_plugin_outdated(),
    ],
    [
      "a damaged Resource Pack",
      { kind: "pack", refusal: { kind: "pack-damaged" } },
      m.settings_resource_pack_status_damaged(),
    ],
    [
      "a Resource Pack that does not read",
      { kind: "pack", refusal: { kind: "failed", detail: "EACCES: wasm" } },
      m.settings_online_status_pack_failed(),
    ],
    [
      "an unreadable Worker",
      { kind: "code-unreadable" },
      m.settings_online_status_code_unreadable(),
    ],
    ["never synced", running(), m.settings_online_status_never_synced()],
    [
      "a sync before its download",
      running({ syncing: true }),
      m.settings_online_status_syncing(),
    ],
    [
      "the download of all libraries",
      running({
        syncing: true,
        state: "loading",
        progress: { phase: "download", done: 50, total: 1200 },
      }),
      m.settings_online_status_downloading({ done: "50", total: "1200" }),
    ],
    [
      "the download before every library has counted its items",
      running({
        syncing: true,
        progress: { phase: "download", done: 50, total: null },
      }),
      m.settings_online_status_downloaded({ done: "50" }),
    ],
    [
      "an apply that waits for a running task",
      running({ syncing: true, progress: { phase: "waiting" } }),
      m.settings_online_status_waiting(),
    ],
    [
      "the apply, with the wait of searches",
      running({
        syncing: true,
        progress: { phase: "apply", done: 300, total: 1200 },
      }),
      `${m.settings_online_status_applying({ done: "300", total: "1200" })} ${m.settings_online_status_searches_wait()}`,
    ],
    [
      "the apply after a download that Zotero asked to wait",
      running({
        syncing: true,
        rateWaitUntil: Temporal.Instant.from("2026-11-20T09:31:00Z"),
        progress: { phase: "apply", done: 300, total: 1200 },
      }),
      `${m.settings_online_status_applying({ done: "300", total: "1200" })} ${m.settings_online_status_searches_wait()}`,
    ],
    [
      "the wait of the apply after a download that Zotero asked to wait",
      running({
        syncing: true,
        rateWaitUntil: Temporal.Instant.from("2026-11-20T09:31:00Z"),
        progress: { phase: "waiting" },
      }),
      m.settings_online_status_waiting(),
    ],
    [
      "the progress that stays after the sync ended",
      running({
        ...synced,
        syncing: false,
        progress: { phase: "apply", done: 1200, total: 1200 },
      }),
      m.settings_online_status_up_to_date({ time: time(LAST) }),
    ],
    [
      "a sync that the user stopped",
      running({
        ...synced,
        problem: { _tag: "stopped", message: "" },
      }),
      `${m.settings_online_problem_stopped()} ${m.settings_online_status_last_good({ time: time(LAST) })}`,
    ],
    [
      "a wait that Zotero asked for during a download",
      running({
        syncing: true,
        state: "loading",
        rateWaitUntil: Temporal.Instant.from("2026-11-20T09:31:00Z"),
        progress: { phase: "download", done: 50, total: 1200 },
      }),
      m.settings_online_status_rate_wait({
        time: time(Temporal.Instant.from("2026-11-20T09:31:00Z")),
      }),
    ],
    [
      "the problem of a sync that ended while Zotero asked for a wait",
      running({
        syncing: false,
        state: "degraded",
        problem: { _tag: "key-invalid", message: "" },
        rateWaitUntil: Temporal.Instant.from("2026-11-20T09:31:00Z"),
      }),
      m.settings_online_problem_key_invalid(),
    ],
    [
      "up to date",
      running(synced),
      m.settings_online_status_up_to_date({ time: time(LAST) }),
    ],
  ])("names %s", (_, status, text) => {
    expect(statusText(status, time)).toBe(text);
  });

  it.each<[WebSyncProblem, string]>([
    [
      { _tag: "key-invalid", message: "" },
      m.settings_online_problem_key_invalid(),
    ],
    [{ _tag: "no-access", message: "" }, m.settings_online_problem_no_access()],
    [
      {
        _tag: "account-changed",
        message: "",
        consentedUserID: 1,
        storedUserID: 1,
        keyUserID: 2,
      },
      m.settings_online_problem_account_changed(),
    ],
    [{ _tag: "network", message: "" }, m.settings_online_problem_network()],
    [
      { _tag: "rate-limited", message: "" },
      m.settings_online_problem_rate_limited(),
    ],
    [{ _tag: "protocol", message: "" }, m.settings_online_problem_protocol()],
    [
      { _tag: "storage", reason: "full", message: "" },
      m.settings_online_problem_storage_full(),
    ],
    [
      { _tag: "storage", reason: "failed", message: "" },
      m.settings_online_problem_storage_failed(),
    ],
    [
      { _tag: "libraries-failed", message: "", libraries: [] },
      m.settings_online_problem_libraries_failed(),
    ],
  ])("names the problem %j", (problem, text) => {
    expect(statusText(running({ problem, state: "degraded" }), time)).toBe(
      text,
    );
  });

  it("marks a stopped sync as no problem, and a failed one as a problem", () => {
    expect(
      isProblem(running({ problem: { _tag: "stopped", message: "" } })),
    ).toBe(false);
    expect(
      isProblem(running({ problem: { _tag: "network", message: "" } })),
    ).toBe(true);
  });

  it("adds the time of the last good sync to a problem", () => {
    expect(
      statusText(
        running({ ...synced, problem: { _tag: "network", message: "" } }),
        time,
      ),
    ).toBe(
      `${m.settings_online_problem_network()} ${m.settings_online_status_last_good({ time: time(LAST) })}`,
    );
  });

  it("names a problem of the replica file next to the outcome of the sync, and says that the synced library stays available", () => {
    const fileProblem: WebSyncProblem = {
      _tag: "storage",
      reason: "failed",
      message: "",
    };
    const stopped = running({
      ...synced,
      problem: { _tag: "stopped", message: "" },
      fileProblem,
    });
    expect(statusText(stopped, time)).toBe(
      `${m.settings_online_problem_stopped()} ${m.settings_online_status_last_good({ time: time(LAST) })} ${m.settings_online_file_problem_storage_failed()}`,
    );
    expect(isProblem(stopped)).toBe(true);
    const upToDate = running({ ...synced, fileProblem });
    expect(statusText(upToDate, time)).toBe(
      `${m.settings_online_status_up_to_date({ time: time(LAST) })} ${m.settings_online_file_problem_storage_failed()}`,
    );
    expect(statusText(upToDate, time)).not.toContain(
      m.settings_online_problem_storage_failed(),
    );
    expect(isProblem(upToDate)).toBe(true);
    const full = running({
      ...synced,
      fileProblem: { ...fileProblem, reason: "full" },
    });
    expect(statusText(full, time)).toBe(
      `${m.settings_online_status_up_to_date({ time: time(LAST) })} ${m.settings_online_file_problem_storage_full()}`,
    );
  });

  it("claims no synced library for a problem of the replica file before the first commit", () => {
    const neverSynced = running({
      problem: { _tag: "stopped", message: "" },
      fileProblem: { _tag: "storage", reason: "full", message: "" },
    });
    expect(statusText(neverSynced, time)).toBe(
      `${m.settings_online_problem_stopped()} ${m.settings_online_problem_storage_full()}`,
    );
  });
});
