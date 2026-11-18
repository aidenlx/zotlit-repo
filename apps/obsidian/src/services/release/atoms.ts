// The running release version, shared by view leaves through the plugin registry.
import { Effect } from "effect";

import { viewRuntime } from "@/lib/view-atoms.ts";

import { Release } from "./service.ts";

export const releaseVersionAtom = viewRuntime.atom(
  Release.use((release) => Effect.succeed(release.version)),
);
