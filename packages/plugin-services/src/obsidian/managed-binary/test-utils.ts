import { testEvent } from "@zotlit/plugin-kernel/__fixtures__/event-stream.ts";
import { bytesRange } from "@zotlit/resource-pack/reader.ts";
import { sha256Hex } from "@zotlit/resource-pack/sha256.ts";
import { writePack } from "@zotlit/resource-pack/writer.ts";

import type { OldStoreDirectory } from "./old-store-cleanup.ts";
import type { ResourcePackHostPorts } from "./pack-platform.ts";

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
    locate: () =>
      installed && {
        version: installed.version,
        url: "app://device/plugins/zotlit-resources/main.js",
      },
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
    // oxlint-disable-next-line typescript/require-await -- the browser's listing is an async iterator.
    keys: async function* () {
      yield* Object.keys(folder);
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
