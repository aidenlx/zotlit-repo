import type { OriginDirectory, OriginEntry } from "./stored-replica.ts";

export interface OriginSlot {
  readonly size: number;
  readonly lastModified: number;
}

export interface OriginTree {
  [name: string]: OriginTree | OriginSlot;
}

const isSlot = (entry: OriginTree | OriginSlot): entry is OriginSlot =>
  typeof entry.size === "number" && typeof entry.lastModified === "number";

function notFound(name: string): DOMException {
  return new DOMException(`No entry named ${name}`, "NotFoundError");
}

function notAFolder(name: string): DOMException {
  return new DOMException(`${name} is a file`, "TypeMismatchError");
}

export function originPools(tree: OriginTree): () => Promise<OriginDirectory> {
  const directory = (folder: OriginTree): OriginDirectory => ({
    getDirectoryHandle: (name) => {
      const entry = folder[name];
      if (!entry) return Promise.reject(notFound(name));
      return isSlot(entry)
        ? Promise.reject(notAFolder(name))
        : Promise.resolve(directory(entry));
    },
    removeEntry: (name, options) => {
      const entry = folder[name];
      if (!entry) return Promise.reject(notFound(name));
      if (!isSlot(entry) && Object.keys(entry).length > 0 && !options.recursive)
        return Promise.reject(
          new DOMException(`${name} is not empty`, "InvalidModificationError"),
        );
      delete folder[name];
      return Promise.resolve();
    },
    values: () => {
      const entries = Object.entries(folder).map(([name, entry]): OriginEntry =>
        isSlot(entry)
          ? { kind: "file", name, getFile: () => Promise.resolve(entry) }
          : { kind: "directory", name, ...directory(entry) },
      );
      const iterator = entries.values();
      return {
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.resolve(iterator.next()),
        }),
      };
    },
  });
  return () => Promise.resolve(directory(tree));
}
