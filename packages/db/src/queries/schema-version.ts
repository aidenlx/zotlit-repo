import type { ZoteroDatabase } from "#client/database.ts";

import { readDatabaseLayout } from "#layout/index.ts";

export const SUPPORTED_SCHEMA_VERSIONS = {
  userdata: { min: 125, max: 129 },
  compatibility: { min: 7, max: 9 },
} as const;

export interface ZoteroSchemaVersions {
  userdata: number | null;
  compatibility: number | null;
  supported: boolean;
}

export function getSchemaVersions(db: ZoteroDatabase): ZoteroSchemaVersions {
  const { userdata, compatibility } = readDatabaseLayout(db).versions;
  const supported =
    inRange(userdata, SUPPORTED_SCHEMA_VERSIONS.userdata) &&
    inRange(compatibility, SUPPORTED_SCHEMA_VERSIONS.compatibility);
  return { userdata, compatibility, supported };
}

function inRange(
  version: number | null,
  { min, max }: { min: number; max: number },
): boolean {
  return version !== null && version >= min && version <= max;
}
