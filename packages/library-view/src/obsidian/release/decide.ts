import eq from "semver/functions/eq";
import gt from "semver/functions/gt";
import gte from "semver/functions/gte";
import lt from "semver/functions/lt";
import valid from "semver/functions/valid";

import type { HydrationOrigin } from "@zotlit/plugin-services/core/settings/classify.ts";

import { V1_TEMPLATE_FOLDER } from "./constants.ts";

const ZOTERO_10_COMPANION_RELEASE = "2.1.0";

export type ReleaseBranch =
  | "companion-notice"
  | "welcome-upgraded"
  | "welcome-fresh"
  | "update"
  | "none";

export interface ReleaseCheckInput {
  origin: HydrationOrigin;
  recordedVersion: string | null;
  currentVersion: string;
  migrationPending: boolean;
  noticesEnabled: boolean;
  legacyTemplatesPresent: boolean;
}

export interface ReleaseDecision {
  branch: ReleaseBranch;
  recordVersion: string;
  setMigrationPending?: boolean;
  setTemplateFolder?: string;
  setUpdatePending?: boolean;
}

export function decideRelease(input: ReleaseCheckInput): ReleaseDecision {
  const {
    origin,
    recordedVersion,
    currentVersion,
    migrationPending,
    noticesEnabled,
    legacyTemplatesPresent,
  } = input;
  const recordVersion = currentVersion;

  if (origin === "legacy") {
    return {
      branch: "welcome-upgraded",
      recordVersion,
      setMigrationPending: true,
    };
  }

  if (origin === "absent" && legacyTemplatesPresent) {
    return {
      branch: "welcome-upgraded",
      recordVersion,
      setMigrationPending: true,
      setTemplateFolder: V1_TEMPLATE_FOLDER,
    };
  }

  if (origin === "absent" || origin === "malformed") {
    return { branch: "welcome-fresh", recordVersion };
  }

  const setMigrationPending =
    migrationPending && !legacyTemplatesPresent ? false : undefined;

  if (recordedVersion === null || valid(recordedVersion) === null) {
    return {
      branch: "none",
      recordVersion,
      setMigrationPending,
      setUpdatePending: false,
    };
  }

  if (
    lt(recordedVersion, ZOTERO_10_COMPANION_RELEASE) &&
    gte(currentVersion, ZOTERO_10_COMPANION_RELEASE)
  ) {
    return {
      branch: "companion-notice",
      recordVersion,
      setMigrationPending,
      setUpdatePending: false,
    };
  }

  if (gt(currentVersion, recordedVersion) && noticesEnabled) {
    return {
      branch: "update",
      recordVersion,
      setMigrationPending,
      setUpdatePending: true,
    };
  }

  return {
    branch: "none",
    recordVersion,
    setMigrationPending,
    setUpdatePending: eq(currentVersion, recordedVersion) ? undefined : false,
  };
}
