import * as v from "valibot";

import { LOG_LEVELS } from "@zotlit/shared/log-formatter";

import { settingsSlice } from "#core/settings/slice.ts";

const logLevel = v.nullable(v.picklist(LOG_LEVELS));
export type LogLevel = v.InferOutput<typeof logLevel>;

export { LOG_LEVELS };

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
