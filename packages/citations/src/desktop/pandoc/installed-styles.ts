import type { InstalledCslStyle } from "#core/pandoc/csl-style.ts";
import type { FileSystem, PlatformError } from "effect";
import { Effect } from "effect";
import { join } from "node:path";

import { withLogCategory } from "@zotlit/plugin-kernel/worker/effect-log-category.ts";

import {
  HIDDEN_DIR,
  readStyleDir,
  readStyleDirOrEmpty,
  STYLES_DIR,
} from "./styles.ts";

import { selectableStyles } from "#core/pandoc/csl-style.ts";

export const listInstalledStyles = Effect.fn("CslStyles.listInstalled")(
  function* (
    dataDir: string,
  ): Effect.fn.Return<
    InstalledCslStyle[],
    PlatformError.PlatformError,
    FileSystem.FileSystem
  > {
    const root = join(dataDir, STYLES_DIR);
    return selectableStyles(
      (yield* readStyleDir(root)).files,
      (yield* readStyleDir(join(root, HIDDEN_DIR))).files,
    );
  },
  withLogCategory("pandoc", "styles"),
);
export const listInstalledStylesOrNone = Effect.fn("CslStyles.listReadable")(
  function* (dataDir: string) {
    const root = join(dataDir, STYLES_DIR);
    return selectableStyles(
      (yield* readStyleDirOrEmpty(root)).files,
      (yield* readStyleDirOrEmpty(join(root, HIDDEN_DIR))).files,
    );
  },
  withLogCategory("pandoc", "styles"),
);
