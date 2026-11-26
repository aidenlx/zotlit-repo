import { Context, Effect, Layer } from "effect";

import { testEvent } from "@zotlit/plugin-kernel/__fixtures__/event-stream.ts";
import { bytesRange } from "@zotlit/resource-pack/reader.ts";
import { sha256Hex } from "@zotlit/resource-pack/sha256.ts";
import { writePack } from "@zotlit/resource-pack/writer.ts";

import type { OldStoreDirectory } from "./old-store-cleanup.ts";
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

export async function packFile(
  entries: Readonly<Record<string, Uint8Array<ArrayBuffer>>>,
  compat?: number,
): Promise<Uint8Array<ArrayBuffer>> {
  return writePack({
    compat,
    entries: await Promise.all(
      Object.entries(entries).map(async ([name, bytes]) => ({
        name,
        bytes,
        sha256: await sha256Hex(bytes),
      })),
    ),
  });
}

export function packDevice(
  file: Uint8Array | null,
  version = "1.0.0",
): ResourcePackHostPorts & {
  install(file: Uint8Array | null, version?: string): void;
  announce(): void;
} {
  let installed = file && { file, version };
  const reports = testEvent<void>();
  return {
    changes: reports.stream,
    announce: () => {
      reports.emit();
    },
    locate: Effect.sync(
      () =>
        installed && {
          version: installed.version,
          url: "app://device/plugins/zotlit-resources/main.js",
        },
    ),
    open: () => (offset, length) => {
      if (!installed) throw new Error("No pack file");
      return bytesRange(installed.file)(offset, length);
    },
    install: (next, nextVersion = version) => {
      installed = next && { file: next, version: nextVersion };
    },
  };
}

export interface OriginFolder {
  [name: string]: OriginFolder | null;
}

function notFound(name: string): DOMException {
  return new DOMException(`No entry named ${name}`, "NotFoundError");
}

export function originFiles(tree: OriginFolder) {
  let refused = false;
  const directory = (folder: OriginFolder): OldStoreDirectory => ({
    getDirectoryHandle: (name) => {
      const entry = folder[name];
      return entry
        ? Promise.resolve(directory(entry))
        : Promise.reject(notFound(name));
    },
    removeEntry: (name, options) => {
      if (refused) {
        refused = false;
        return Promise.reject(
          new DOMException("The entry is in use", "NoModificationAllowedError"),
        );
      }
      if (!(name in folder)) return Promise.reject(notFound(name));
      const entry = folder[name];
      if (entry && Object.keys(entry).length > 0 && !options?.recursive)
        return Promise.reject(
          new DOMException(
            "The folder is not empty",
            "InvalidModificationError",
          ),
        );
      delete folder[name];
      return Promise.resolve();
    },
    keys: () => {
      const names = Object.keys(folder).values();
      return {
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.resolve(names.next()),
        }),
      };
    },
  });
  const paths = (folder: OriginFolder, prefix: string): string[] =>
    Object.entries(folder).flatMap(([name, entry]) => [
      `${prefix}${name}`,
      ...(entry ? paths(entry, `${prefix}${name}/`) : []),
    ]);
  const device = {
    opens: 0,
    open: () => {
      device.opens++;
      return Promise.resolve(directory(tree));
    },
    paths: () => paths(tree, ""),
    refuse: () => {
      refused = true;
    },
  };
  return device;
}
