import * as m from "@zotlit/plugin-messages/messages.ts";
import type { PackBinaryRefusal } from "@zotlit/resource-pack/status.ts";
import type {
  WebSyncProblem,
  WebSyncStatus,
} from "@zotlit/zotero-reads/contract/web-worker-rpc.ts";

export type SyncPhase =
  | { readonly kind: "starting" }
  | { readonly kind: "rate-wait"; readonly until: Temporal.Instant }
  | {
      readonly kind: "download";
      readonly done: number;
      readonly total: number | null;
    }
  | {
      readonly kind: "apply";
      readonly done: number;
      readonly total: number;
    }
  | { readonly kind: "waiting" };

export type OnlineLibraryStatus =
  | { readonly kind: "file-source" }
  | { readonly kind: "no-key" }
  | { readonly kind: "pack"; readonly refusal: PackBinaryRefusal }
  | { readonly kind: "code-unreadable" }
  | { readonly kind: "starting" }
  | { readonly kind: "stopped" }
  | { readonly kind: "device-record"; readonly message: string }
  | {
      readonly kind: "running";
      readonly sync: WebSyncStatus;
      readonly account: string | null;
      readonly serverSchemaVersion: number | null;
    };

export function formatSyncTime(instant: Temporal.Instant): string {
  return instant.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function lastSyncOf(sync: WebSyncStatus): Temporal.Instant | null {
  let last: Temporal.Instant | null = null;
  for (const { lastSync } of sync.libraries) {
    if (
      lastSync &&
      (last === null || Temporal.Instant.compare(lastSync, last) > 0)
    )
      last = lastSync;
  }
  return last;
}

export function problemText(problem: WebSyncProblem): string {
  switch (problem._tag) {
    case "key-invalid":
      return m.settings_online_problem_key_invalid();
    case "no-access":
      return m.settings_online_problem_no_access();
    case "account-changed":
      return m.settings_online_problem_account_changed();
    case "network":
      return m.settings_online_problem_network();
    case "rate-limited":
      return m.settings_online_problem_rate_limited();
    case "protocol":
      return m.settings_online_problem_protocol();
    case "storage":
      return problem.reason === "full"
        ? m.settings_online_problem_storage_full()
        : m.settings_online_problem_storage_failed();
    case "libraries-failed":
      return m.settings_online_problem_libraries_failed();
    case "stopped":
      return m.settings_online_problem_stopped();
  }
}

export function syncPhaseOf(sync: WebSyncStatus): SyncPhase | null {
  const { progress } = sync;
  if (!sync.syncing) return null;
  if (progress?.phase === "waiting") return { kind: "waiting" };
  if (progress?.phase === "apply")
    return { kind: "apply", done: progress.done, total: progress.total };
  if (sync.rateWaitUntil)
    return { kind: "rate-wait", until: sync.rateWaitUntil };
  if (progress === null) return { kind: "starting" };
  return { kind: "download", done: progress.done, total: progress.total };
}

export function syncPhaseLines(
  phase: SyncPhase,
  formatTime: (instant: Temporal.Instant) => string,
): string[] {
  switch (phase.kind) {
    case "starting":
      return [m.settings_online_status_syncing()];
    case "rate-wait":
      return [
        m.settings_online_status_rate_wait({ time: formatTime(phase.until) }),
      ];
    case "download":
      return [
        phase.total === null
          ? m.settings_online_status_downloaded({ done: String(phase.done) })
          : m.settings_online_status_downloading({
              done: String(phase.done),
              total: String(phase.total),
            }),
      ];
    case "waiting":
      return [m.settings_online_status_waiting()];
    case "apply":
      return [
        m.settings_online_status_applying({
          done: String(phase.done),
          total: String(phase.total),
        }),
        m.settings_online_status_searches_wait(),
      ];
  }
}

function packText(refusal: PackBinaryRefusal): string {
  switch (refusal.kind) {
    case "pack-absent":
      return m.settings_resource_pack_status_absent();
    case "pack-outdated":
      return m.settings_resource_pack_status_pack_outdated();
    case "plugin-outdated":
      return m.settings_resource_pack_status_plugin_outdated();
    case "pack-damaged":
      return m.settings_resource_pack_status_damaged();
    case "failed":
      return m.settings_online_status_pack_failed();
  }
}

function syncText(
  sync: WebSyncStatus,
  formatTime: (instant: Temporal.Instant) => string,
): string {
  const phase = syncPhaseOf(sync);
  if (phase) return syncPhaseLines(phase, formatTime).join(" ");
  const outcome = outcomeText(sync, formatTime);
  return sync.fileProblem
    ? `${outcome} ${fileProblemText(sync, sync.fileProblem)}`
    : outcome;
}

function fileProblemText(sync: WebSyncStatus, problem: WebSyncProblem): string {
  if (problem._tag !== "storage" || lastSyncOf(sync) === null)
    return problemText(problem);
  return problem.reason === "full"
    ? m.settings_online_file_problem_storage_full()
    : m.settings_online_file_problem_storage_failed();
}

function outcomeText(
  sync: WebSyncStatus,
  formatTime: (instant: Temporal.Instant) => string,
): string {
  const last = lastSyncOf(sync);
  if (sync.problem) {
    const text = problemText(sync.problem);
    return last
      ? `${text} ${m.settings_online_status_last_good({ time: formatTime(last) })}`
      : text;
  }
  return last
    ? m.settings_online_status_up_to_date({ time: formatTime(last) })
    : m.settings_online_status_never_synced();
}

export function statusText(
  status: OnlineLibraryStatus,
  formatTime: (instant: Temporal.Instant) => string,
): string {
  switch (status.kind) {
    case "file-source":
      return "";
    case "no-key":
      return m.settings_online_status_no_key();
    case "pack":
      return packText(status.refusal);
    case "code-unreadable":
      return m.settings_online_status_code_unreadable();
    case "starting":
      return m.settings_online_status_starting();
    case "stopped":
      return m.settings_online_status_stopped();
    case "device-record":
      return status.message;
    case "running":
      return syncText(status.sync, formatTime);
  }
}

export function isProblem(status: OnlineLibraryStatus): boolean {
  switch (status.kind) {
    case "pack":
    case "code-unreadable":
    case "stopped":
    case "device-record":
      return true;
    case "running":
      return (
        !status.sync.syncing &&
        ((status.sync.problem !== null &&
          status.sync.problem._tag !== "stopped") ||
          status.sync.fileProblem !== undefined)
      );
    default:
      return false;
  }
}

export interface LibrarySourceActions {
  readonly syncNow: boolean;
  readonly replace: number | null;
  readonly remove: boolean;
}

export type SyncStopState = "requested" | "confirmed" | "refused" | "failed";

export interface SyncStop {
  readonly syncId: number;
  readonly state: SyncStopState;
}

export interface LibrarySourceView {
  readonly selected: "file" | "web-api";
  readonly status: OnlineLibraryStatus;
  readonly actions: LibrarySourceActions;
  readonly stop?: SyncStop | null;
}

export function runningSyncOf(status: OnlineLibraryStatus): number | null {
  return status.kind === "running" && status.sync.syncing
    ? status.sync.syncId
    : null;
}

export function viewOf(facts: {
  readonly selected: "file" | "web-api";
  readonly status: OnlineLibraryStatus;
  readonly replace: number | null;
  readonly removal: boolean;
  readonly stop?: SyncStop | null;
}): LibrarySourceView {
  const { status, removal, stop } = facts;
  return {
    selected: facts.selected,
    status,
    stop:
      stop && stop.syncId === runningSyncOf(status)
        ? { syncId: stop.syncId, state: stop.state }
        : null,
    actions: {
      syncNow: !(
        removal ||
        status.kind === "file-source" ||
        status.kind === "starting" ||
        status.kind === "no-key" ||
        (status.kind === "running" && status.sync.syncing)
      ),
      replace: removal ? null : facts.replace,
      remove: true,
    },
  };
}
