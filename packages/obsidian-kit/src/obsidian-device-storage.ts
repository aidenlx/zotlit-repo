import { Context, Effect, Layer, Schema } from "effect";
import type { App } from "obsidian";

import { ObsidianApp } from "#obsidian-app.ts";

export type DeviceStorageSource = Pick<
  App,
  "loadLocalStorage" | "saveLocalStorage"
>;

export class DeviceStorageError extends Schema.TaggedError<
  DeviceStorageError,
  { readonly brand: unique symbol }
>()("DeviceStorageError", {
  operation: Schema.Literals(["loadLocalStorage", "saveLocalStorage"]),
  key: Schema.String,
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export interface DeviceStorageShape {
  load(key: string): Effect.Effect<unknown, DeviceStorageError>;
  save(key: string, value: unknown): Effect.Effect<void, DeviceStorageError>;
}

export class DeviceStorage extends Context.Service<
  DeviceStorage,
  DeviceStorageShape
>()("zotlit/obsidian/DeviceStorage") {}

const storageError =
  (operation: DeviceStorageError["operation"], key: string) =>
  (cause: unknown): DeviceStorageError =>
    new DeviceStorageError({
      operation,
      key,
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    });

export function makeDeviceStorage(
  source: DeviceStorageSource,
): DeviceStorage["Service"] {
  return DeviceStorage.of({
    load: Effect.fn("DeviceStorage.load")((key) =>
      Effect.try({
        try: (): unknown => source.loadLocalStorage(key),
        catch: storageError("loadLocalStorage", key),
      }),
    ),
    save: Effect.fn("DeviceStorage.save")((key, value) =>
      Effect.try({
        try: () => source.saveLocalStorage(key, value),
        catch: storageError("saveLocalStorage", key),
      }),
    ),
  });
}

export const layerDeviceStorageFrom = (
  source: DeviceStorageSource,
): Layer.Layer<DeviceStorage> =>
  Layer.succeed(DeviceStorage, makeDeviceStorage(source));

export const layerDeviceStorage: Layer.Layer<
  DeviceStorage,
  never,
  ObsidianApp
> = Layer.effect(
  DeviceStorage,
  Effect.gen(function* () {
    return makeDeviceStorage(yield* ObsidianApp);
  }),
);
