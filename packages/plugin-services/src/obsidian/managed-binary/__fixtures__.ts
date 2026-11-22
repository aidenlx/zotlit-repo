import { Context, Effect, Layer } from "effect";

import { layerPackBinary } from "./pack-binary.ts";
import type { PackBinary, PackBinaryApi } from "./pack-binary.ts";
import { ResourcePackPlatform, resourcePackPorts } from "./pack-platform.ts";
import type { ResourcePackHostPorts } from "./pack-platform.ts";

export const layerPackDevice = (
  ports: ResourcePackHostPorts,
): Layer.Layer<ResourcePackPlatform> =>
  Layer.succeed(ResourcePackPlatform, resourcePackPorts(ports));

export function packBinary<Engine extends Disposable | AsyncDisposable>(
  binary: PackBinary<Engine>,
  ports: ResourcePackHostPorts,
) {
  const tag = Context.Service<PackBinaryApi<Engine>>(
    "zotlit/managed-binary/TestPackBinary",
  );
  return Layer.build(
    layerPackBinary(tag, binary).pipe(Layer.provide(layerPackDevice(ports))),
  ).pipe(Effect.map((context) => Context.get(context, tag)));
}
