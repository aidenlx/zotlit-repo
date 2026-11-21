// Test support: a fake device for Managed Binary services, with an in-memory store and consent record.
import { testEvent } from "@zotlit/plugin-kernel/__fixtures__/event-stream.ts";
import { bytesRange } from "@zotlit/resource-pack/reader.ts";
import { sha256Hex } from "@zotlit/resource-pack/sha256.ts";
import { writePack } from "@zotlit/resource-pack/writer.ts";

import type { ResourcePackHostPorts } from "./pack-platform.ts";
import type { BinaryStore, ManagedBinaryHostPorts } from "./service.ts";

/**
 * The device: one origin-wide store root with a directory per Managed Binary,
 * and the consent storage of its first vault.
 */
export function memoryDevice() {
  const directories = new Map<string, Map<string, Uint8Array<ArrayBuffer>>>();
  const files = (directory: string) => {
    let entries = directories.get(directory);
    if (!entries) directories.set(directory, (entries = new Map()));
    return entries;
  };
  const openStore = (directory: string): BinaryStore => ({
    list: () => Promise.resolve([...files(directory).keys()]),
    read: (name) => {
      const stored = files(directory).get(name);
      return Promise.resolve(stored && new Blob([stored]));
    },
    write: (name, written) => {
      files(directory).set(name, written);
      return Promise.resolve();
    },
    rename: (from, to) => {
      const entries = files(directory);
      const moved = entries.get(from);
      if (!moved) throw new Error(`No entry named ${from}`);
      entries.delete(from);
      entries.set(to, moved);
      return Promise.resolve();
    },
    remove: (name) => {
      files(directory).delete(name);
      return Promise.resolve();
    },
    clear: () => {
      directories.delete(directory);
      return Promise.resolve();
    },
  });
  /** The names stored in one directory, sorted. */
  const names = (directory: string) =>
    [...(directories.get(directory)?.keys() ?? [])].sort();
  return { openStore, consent: vaultConsent(), files, names };
}

/** One vault's local storage, where a dismissed install offer is remembered. */
export function vaultConsent(): ManagedBinaryHostPorts["consent"] {
  const values = new Map<string, unknown>();
  return {
    loadLocalStorage: (key) => values.get(key) ?? null,
    saveLocalStorage: (key, value) => {
      if (value === null) values.delete(key);
      else values.set(key, value);
    },
  };
}

/** The file of a Resource Pack that holds `entries`, by entry name. */
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

/**
 * A device whose installed plugins hold the Resource Pack `file` at
 * `version`, or no pack for `null`. `install` puts another pack in its place
 * as a file copy does, with no word from Obsidian; `announce` is Obsidian's
 * report of an installed, updated or removed pack.
 */
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
