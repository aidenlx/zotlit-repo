// The logging keys of the plugin settings.
import * as v from "valibot";

import { LOG_LEVELS } from "@zotlit/shared/log-formatter";

import { settingsSlice } from "#core/settings/slice.ts";

/**
 * The plugin logger's severity levels. `null` means logging is disabled,
 * matching legacy log4js `OFF`; legacy `MARK` is dropped during migration
 * because the plugin logger has no such level.
 */
const logLevel = v.nullable(v.picklist(LOG_LEVELS));
export type LogLevel = v.InferOutput<typeof logLevel>;

export { LOG_LEVELS };

/** Whether `value` names a plugin logger severity level. */
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
