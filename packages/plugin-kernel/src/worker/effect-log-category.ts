import * as Context from "effect/Context";

export { LogCategory, withLogCategory } from "@zotlit/shared/logging";

export const LogTimestamp = Context.Reference<number | undefined>(
  "zotlit/effect-log/LogTimestamp",
  { defaultValue: () => undefined },
);
