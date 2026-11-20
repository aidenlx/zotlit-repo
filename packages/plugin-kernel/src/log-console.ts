import * as Logger from "effect/Logger";

import { devToolsFormatter } from "@zotlit/shared/log-formatter";
import type { LogLevel, LogRecord } from "@zotlit/shared/log-formatter";

const METHODS = {
  trace: "debug",
  debug: "debug",
  info: "info",
  warning: "warn",
  error: "error",
  fatal: "error",
} as const satisfies Record<LogLevel, keyof Console>;

export const consoleLogSink = Logger.make<LogRecord, void>(({ message }) => {
  // oxlint-disable-next-line effecttsgo/global-console, obsidianmd/rule-custom-message -- the console sink of the plugin's logger
  console[METHODS[message.level]](...devToolsFormatter(message));
});
