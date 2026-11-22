import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export const LogCategory = Context.Reference<readonly string[]>(
  "zotlit/effect-log/LogCategory",
  { defaultValue: () => [] },
);

export const withLogCategory =
  (...category: [string, ...string[]]) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.provideService(self, LogCategory, category);

export type LibraryLogLevel =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal";

export interface LibraryLogRecord {
  readonly level: LibraryLogLevel;
  readonly category: readonly [string, ...string[]];
  readonly message: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

export type LibraryLogSink = (record: LibraryLogRecord) => void;

export interface LibraryLogInput {
  readonly level: LibraryLogLevel;
  readonly category: readonly [string, ...string[]];
  readonly message: string;
  readonly properties?: Readonly<Record<string, unknown>>;
}

let sink: LibraryLogSink | undefined;

export const setLibraryLogSink = (next: LibraryLogSink | undefined): void => {
  sink = next;
};

export const logLibrary = ({
  level,
  category,
  message,
  properties,
}: LibraryLogInput): void => {
  sink?.({
    level,
    category,
    message,
    properties: properties ?? {},
  });
};
