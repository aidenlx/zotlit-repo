import { Effect } from "effect";

import { viewRuntime } from "@zotlit/obsidian-kit/view-atoms.ts";

import { Release } from "./service.ts";

export const releaseVersionAtom = viewRuntime.atom(
  Release.use((release) => Effect.succeed(release.version)),
);
