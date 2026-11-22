import { Duration, Effect } from "effect";
import { tmpdir } from "node:os";

import {
  isOlderThan,
  sweepTempDirectory,
} from "@zotlit/obsidian-desktop/temp-sweep.ts";
import type { ReapTempsOptions } from "@zotlit/obsidian-desktop/temp-sweep.ts";

import { excerptTempDirectory } from "./temp-store.ts";

const PNG_MAX_AGE = Duration.days(7);

const PART_MAX_AGE = Duration.hours(1);

export const reapExcerptTemps = Effect.fnUntraced(function* ({
  parent = tmpdir(),
}: ReapTempsOptions = {}) {
  yield* sweepTempDirectory({
    directory: excerptTempDirectory(parent),
    kind: "excerpt PNG",
    isResidue: (name, path) =>
      isOlderThan(path, name.endsWith(".part") ? PART_MAX_AGE : PNG_MAX_AGE),
  });
});
