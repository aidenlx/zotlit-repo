// The logging keys of the plugin settings.
import { getLogLevels } from "@logtape/logtape";
import * as v from "valibot";

import { settingsSlice } from "#core/settings/slice.ts";

/**
 * LogTape severity levels. `null` means logging is disabled, matching legacy
 * log4js `OFF`; legacy `MARK` is dropped during migration because there is no
 * LogTape equivalent.
 */
const logLevel = v.nullable(v.picklist(getLogLevels()));
export type LogLevel = v.InferOutput<typeof logLevel>;

/** Every LogTape severity level, in LogTape's order. */
export const LOG_LEVELS = getLogLevels();

/** Whether `value` names a LogTape severity level. */
export const isLogLevel = (value: string): value is NonNullable<LogLevel> =>
  LOG_LEVELS.some((level) => level === value);

export const logSettings = settingsSlice(
  {
    "log.level": logLevel,
    "log.to-file": v.boolean(),
  },
  {
    "log.level": __DEV__ ? "trace" : "info",
    "log.to-file": false,
  },
);
