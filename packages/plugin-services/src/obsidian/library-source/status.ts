import * as m from "@zotlit/plugin-messages/messages.ts";
import type { PackBinaryRefusal } from "@zotlit/resource-pack/status.ts";
import type {
  WebSyncProblem,
  WebSyncStatus,
} from "@zotlit/zotero-reads/contract/web-worker-rpc.ts";

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
  const { progress } = sync;
  if (sync.syncing && sync.rateWaitUntil)
    return m.settings_online_status_rate_wait({
      time: formatTime(sync.rateWaitUntil),
    });
  if (progress?.phase === "apply")
    return m.settings_online_status_applying({
      done: String(progress.done),
      total: String(progress.total),
    });
  if (progress)
    return (
      progress.phase === "collections"
        ? m.settings_online_status_collections
        : m.settings_online_status_items
    )({ done: String(progress.done), total: String(progress.total) });
  if (sync.syncing) return m.settings_online_status_syncing();
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
      return status.sync.problem !== null && !status.sync.syncing;
    default:
      return false;
  }
}

export interface LibrarySourceActions {
  readonly syncNow: boolean;
  readonly replace: number | null;
  readonly remove: boolean;
}

export interface LibrarySourceView {
  readonly selected: "file" | "web-api";
  readonly status: OnlineLibraryStatus;
  readonly actions: LibrarySourceActions;
}

export function viewOf(facts: {
  readonly selected: "file" | "web-api";
  readonly status: OnlineLibraryStatus;
  readonly replace: number | null;
  readonly removal: boolean;
}): LibrarySourceView {
  const { status, removal } = facts;
  return {
    selected: facts.selected,
    status,
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
