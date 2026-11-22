import { Effect } from "effect";

import type { Annotation } from "@zotlit/db";
import {
  logServices,
  withLogCategory,
  logLevelEnabled,
} from "@zotlit/plugin-kernel/effect-log.ts";

import { lockReasonText } from "./lock-copy.ts";

export type LockReason = "external" | "another-user";

export interface AnnotationLock {
  reason: LockReason;
}

export type LockedVerb =
  | "color"
  | "comment"
  | "text"
  | "tags"
  | "geometry"
  | "delete";

export function lockRefuses(
  lock: AnnotationLock | null,
  verb: LockedVerb,
): boolean {
  if (lock === null) return false;
  switch (lock.reason) {
    case "external":
      return true;
    case "another-user":
      return verb !== "delete";
  }
}

export interface LockBlock {
  reason: string;
  action: null;
  source: "lock";
}

export function lockBlock(
  lock: AnnotationLock | null,
  verb: LockedVerb,
): LockBlock | null {
  if (lock === null || !lockRefuses(lock, verb)) return null;
  return { reason: lockReasonText(lock.reason), action: null, source: "lock" };
}

export function firstLockRefusal(
  annotationKeys: Iterable<string>,
  verb: LockedVerb,
  lockOn: (annotationKey: string) => AnnotationLock | null,
): { annotationKey: string; lock: AnnotationLock } | null {
  for (const annotationKey of annotationKeys) {
    const lock = lockOn(annotationKey);
    if (lock && lockRefuses(lock, verb)) return { annotationKey, lock };
  }
  return null;
}

export function lockOf(
  facts: Pick<
    Annotation,
    "indexedKey" | "isExternal" | "groupID" | "createdByUserID"
  >,
  currentUserID: number | null,
): AnnotationLock | null {
  const { indexedKey, isExternal, groupID, createdByUserID } = facts;
  if (isExternal) return { reason: "external" };
  if (groupID === null) return null;
  const byAnotherUser =
    !!createdByUserID &&
    currentUserID !== null &&
    createdByUserID !== currentUserID;
  if (logLevelEnabled("trace"))
    Effect.runSyncWith(logServices)(
      Effect.logTrace("Read the creator lock of a group Annotation").pipe(
        Effect.annotateLogs({
          annotationKey: indexedKey,
          createdByUserID,
          currentUserID,
          byAnotherUser,
        }),
        withLogCategory("annotation-repository"),
      ),
    );
  return byAnotherUser ? { reason: "another-user" } : null;
}
