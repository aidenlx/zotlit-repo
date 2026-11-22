import type { FlatGroupDef } from "#desktop/batch/modal/index.ts";
import { Effect } from "effect";
import type { RpcClientError } from "effect/rpc";

import { USER_LIBRARY_ID } from "@zotlit/db";
import type { Library } from "@zotlit/db";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { libraryLabel } from "@zotlit/plugin-services/core/library-scope/label.ts";
import { LibraryScope } from "@zotlit/plugin-services/obsidian/library-scope/service.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type { ZoteroReadsApi } from "@zotlit/zotero-reads/client/service.ts";
import {
  compareSelectors,
  selectorOf,
} from "@zotlit/zotero-reads/contract/library-scope.ts";
import type { ResolvedLibraryScope } from "@zotlit/zotero-reads/contract/library-scope.ts";
import type {
  DbUnavailable,
  SnapshotExpired,
} from "@zotlit/zotero-reads/contract/rpc.ts";

export type BatchScopeKind = "literature-items" | "notes";

export type BatchTarget =
  | {
      groupID: number;
      collectionKey?: string;
    }
  | { groupID?: never; collectionKey?: never };

export interface BatchScopeRequest {
  target: BatchTarget;
  scope?: ResolvedLibraryScope;
  libraries: readonly Library[];
}

export type BatchScope =
  | { outcome: "unavailable-target" }
  | { outcome: "collection-not-found" }
  | { outcome: "resolved"; itemIDs: number[] };

export type BatchScopeError =
  | DbUnavailable
  | SnapshotExpired
  | RpcClientError.RpcClientError;

export function resolveBatchScope(
  reads: ZoteroReadsApi,
  kind: BatchScopeKind,
  request: BatchScopeRequest,
): Effect.Effect<BatchScope, BatchScopeError> {
  return Effect.gen(function* () {
    const { groupID, collectionKey } = request.target;

    let libraryIDs: number[];
    if (groupID === undefined) {
      libraryIDs = request.scope!.available.map((library) => library.libraryID);
    } else {
      const libraryID = exactLibraryID(request.libraries, groupID);
      if (libraryID === null) {
        yield* Effect.logDebug("Batch scope: target library unavailable").pipe(
          Effect.annotateLogs({ kind, groupID }),
          withLogCategory("batch-scope"),
        );
        return { outcome: "unavailable-target" };
      }
      libraryIDs = [libraryID];
    }

    const itemIDs: number[] = [];
    for (const libraryID of libraryIDs) {
      const ids = yield* reads.ScopeItemIDs({
        kind,
        libraryID,
        ...(collectionKey !== undefined && { collectionKey }),
      });
      if (ids === null) {
        yield* Effect.logDebug("Batch scope: collection not found").pipe(
          Effect.annotateLogs({ kind, libraryID, collectionKey }),
          withLogCategory("batch-scope"),
        );
        return { outcome: "collection-not-found" };
      }
      itemIDs.push(...ids);
    }
    return { outcome: "resolved", itemIDs };
  });
}

export type BatchScopePlan =
  | { outcome: "no-library-in-scope" }
  | { outcome: "unavailable-target" }
  | { outcome: "collection-not-found" }
  | {
      outcome: "resolved";
      itemIDs: number[];
      unavailableLibraries: number;
    };

export function planBatchScope(
  kind: BatchScopeKind,
  target: BatchTarget,
): Effect.Effect<BatchScopePlan, BatchScopeError, LibraryScope | ZoteroReads> {
  return Effect.scoped(
    Effect.gen(function* () {
      const reads = yield* (yield* ZoteroReads).snapshot;
      const libraries = yield* reads.Libraries({});
      const libraryScope =
        target.groupID === undefined
          ? yield* (yield* LibraryScope).resolveLibraries(libraries)
          : null;
      let unavailableLibraries = 0;
      if (libraryScope !== null) {
        if (libraryScope.available.length === 0) {
          yield* Effect.logDebug(
            "Batch scope: no library in scope is available",
          ).pipe(Effect.annotateLogs({ kind }), withLogCategory("batch-scope"));
          return { outcome: "no-library-in-scope" };
        }
        unavailableLibraries = libraryScope.unavailable.length;
      }

      const scope = yield* resolveBatchScope(reads, kind, {
        target,
        ...(libraryScope === null ? {} : { scope: libraryScope }),
        libraries,
      });
      if (scope.outcome !== "resolved") return { outcome: scope.outcome };
      return {
        outcome: "resolved",
        itemIDs: scope.itemIDs,
        unavailableLibraries,
      };
    }),
  );
}

function exactLibraryID(
  libraries: readonly Library[],
  groupID: number,
): number | null {
  if (groupID === 0) return USER_LIBRARY_ID;
  return (
    libraries.find((library) => library.groupID === groupID)?.libraryID ?? null
  );
}

export interface BatchLibrary {
  libraryID: number;
  label: string;
}

export function batchLibraries(
  libraries: readonly Library[],
  libraryIDs: ReadonlySet<number>,
): BatchLibrary[] {
  return libraries
    .filter((library) => libraryIDs.has(library.libraryID))
    .sort(compareLibraries)
    .map((library) => ({
      libraryID: library.libraryID,
      label: batchLibraryLabel(library),
    }));
}

function compareLibraries(a: Library, b: Library): number {
  const left = selectorOf(a);
  const right = selectorOf(b);
  if (left && right) return compareSelectors(left, right);
  if (left) return -1;
  if (right) return 1;
  return a.libraryID - b.libraryID;
}

function batchLibraryLabel(library: Library): string {
  const selector = selectorOf(library);
  return selector
    ? libraryLabel({
        selector,
        libraryID: library.libraryID,
        name: library.name,
      })
    : (library.name ??
        m.settings_library_scope_group({ groupID: library.libraryID }));
}

export function batchGroupKey(libraryID: number, kind: string): string {
  return `${libraryID}:${kind}`;
}

export function batchGroups(
  libraries: readonly BatchLibrary[],
  kinds: readonly FlatGroupDef[],
): FlatGroupDef[] {
  const qualify = libraries.length > 1;
  return libraries.flatMap((library) =>
    kinds.map((kind) => ({
      ...kind,
      kind: batchGroupKey(library.libraryID, kind.kind),
      header: qualify
        ? (args: { count: number }) =>
            m.batch_group_library({
              library: library.label,
              group: kind.header(args),
            })
        : kind.header,
    })),
  );
}

export function withUnavailableLibraries(
  intro: string,
  unavailable: number,
): string {
  return unavailable === 0
    ? intro
    : m.batch_intro_with_unavailable({
        intro,
        unavailable: m.batch_libraries_unavailable({ count: unavailable }),
      });
}
