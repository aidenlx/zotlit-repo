// A Managed Binary layer over fake device ports, with the same handle as the plugin.
import { Context, Layer } from "effect";

import { effectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { buildRuntime } from "@zotlit/plugin-kernel/effect-layer.ts";

import { bindManagedBinary } from "./handle.ts";
import { managedBinaryPorts } from "./platform.ts";
import { layerManagedBinary, ManagedBinaryPlatform } from "./service.ts";
import type {
  ManagedBinary,
  ManagedBinaryApi,
  ManagedBinaryHostPorts,
} from "./service.ts";

/** Build one binary for a plain-interface test; the caller's stack owns it. */
export async function buildManagedBinary<
  Engine extends Disposable | AsyncDisposable,
>(
  binary: ManagedBinary<Engine>,
  ports: ManagedBinaryHostPorts,
  stack: AsyncDisposableStack,
) {
  const tag = Context.Service<ManagedBinaryApi<Engine>>(
    "zotlit/managed-binary/TestBinary",
  );
  const runtime = buildRuntime(
    layerManagedBinary(tag, binary).pipe(
      Layer.provide(
        Layer.succeed(ManagedBinaryPlatform, managedBinaryPorts(ports)),
      ),
    ),
    stack,
  );
  await runtime.context();
  const service = runtime.runSync(tag);
  const handle = bindManagedBinary(effectBridge(runtime), service);
  return { service, handle, runtime };
}

/** A disposable test owner around the handle and its service. */
export async function openManagedBinary<
  Engine extends Disposable | AsyncDisposable,
>(binary: ManagedBinary<Engine>, ports: ManagedBinaryHostPorts) {
  await using stack = new AsyncDisposableStack();
  const built = await buildManagedBinary(binary, ports, stack);
  const owned = stack.move();
  return Object.assign(built, {
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  });
}
