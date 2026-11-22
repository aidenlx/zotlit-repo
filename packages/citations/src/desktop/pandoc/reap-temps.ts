import { Duration, Effect } from "effect";
import { tmpdir } from "node:os";

import {
  isOlderThan,
  sweepTempDirectory,
} from "@zotlit/obsidian-desktop/temp-sweep.ts";
import type { ReapTempsOptions } from "@zotlit/obsidian-desktop/temp-sweep.ts";

import { CSL_STAGING_EXT, cslStoreDirectory } from "./csl.ts";

const CSL_MAX_AGE = Duration.days(30);

const STAGING_MAX_AGE = Duration.hours(1);

export const reapCslStore = Effect.fnUntraced(function* ({
  parent = tmpdir(),
}: ReapTempsOptions = {}) {
  yield* sweepTempDirectory({
    directory: cslStoreDirectory(parent),
    kind: "materialized CSL style",
    isResidue: (name, path) =>
      isOlderThan(
        path,
        name.endsWith(CSL_STAGING_EXT) ? STAGING_MAX_AGE : CSL_MAX_AGE,
      ),
  });
});
