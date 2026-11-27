import type { Scope } from "effect";
import { Cause, Console, DateTime, Effect, Logger } from "effect";
import type { DataAdapter } from "obsidian";

import type { LogRecord } from "@zotlit/plugin-kernel/effect-log.ts";

const errorFields = (_key: string, value: unknown): unknown => {
  if (!(value instanceof Error)) return value;
  const fields: Record<string, unknown> = {
    name: value.name,
    message: value.message,
  };
  if (typeof value.stack === "string") fields["stack"] = value.stack;
  if (value.cause !== undefined) fields["cause"] = value.cause;
  if (value instanceof AggregateError) fields["errors"] = value.errors;
  for (const key of Object.keys(value))
    if (!(key in fields)) fields[key] = (value as never)[key];
  return fields;
};

const messageText = (message: readonly unknown[]): unknown => {
  if (message.length === 1) return message[0];
  let text = "";
  for (let i = 0; i < message.length; i++)
    text += i % 2 === 0 ? message[i] : JSON.stringify(message[i]);
  return text;
};

export const jsonLine = (record: LogRecord): string =>
  `${JSON.stringify(
    {
      "@timestamp": DateTime.formatIso(DateTime.makeUnsafe(record.timestamp)),
      level: record.level === "warning" ? "WARN" : record.level.toUpperCase(),
      message: messageText(record.message),
      logger: record.category.join("."),
      properties: record.properties,
    },
    errorFields,
  )}\n`;

export const openVaultFileSink = (
  adapter: Pick<DataAdapter, "write" | "append">,
  path: string,
): Effect.Effect<Logger.Logger<LogRecord, void>, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise(() => adapter.write(path, ""));
    return yield* Logger.batched(
      Logger.make<LogRecord, string>(({ message }) => jsonLine(message)),
      {
        window: "1 second",
        flush: (lines) =>
          Effect.tryPromise(() => adapter.append(path, lines.join(""))).pipe(
            Effect.catchCause((cause) =>
              Console.error(
                "Failed to write to plugin log file",
                Cause.squash(cause),
              ),
            ),
          ),
      },
    );
  });
