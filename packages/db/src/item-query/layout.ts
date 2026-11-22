import type { ZoteroDatabase } from "#client/database.ts";
import type {
  DatabaseLayout,
  LayoutGap,
  LayoutVersions,
} from "#layout/index.ts";
import { Data } from "effect";

import {
  describeLayoutGaps,
  NotZoteroDatabaseError,
  readDatabaseLayout,
} from "#layout/index.ts";

export type { LayoutGap, LayoutVersions } from "#layout/index.ts";

export class ItemQueryLayoutError extends Data.TaggedError(
  "ItemQueryLayoutError",
)<{
  readonly missing: readonly LayoutGap[];
  readonly versions: LayoutVersions;
}> {
  override get message(): string {
    return `This version of ZotLit cannot read the data layout of this Zotero database. Missing: ${describeLayoutGaps(this.missing)}. Update ZotLit to read it.`;
  }
}

export function layoutErrorOf(
  layout: DatabaseLayout,
): ItemQueryLayoutError | null {
  return layout.missing.length === 0
    ? null
    : new ItemQueryLayoutError({
        missing: layout.missing,
        versions: layout.versions,
      });
}

export function checkDatabaseLayout(client: ZoteroDatabase): DatabaseLayout {
  const layout = readDatabaseLayout(client);
  if (!layout.isZoteroDatabase) throw new NotZoteroDatabaseError();
  const error = layoutErrorOf(layout);
  if (error) throw error;
  return layout;
}
