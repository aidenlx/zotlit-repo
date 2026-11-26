import { dirname } from "node:path/posix";
import { TFile, TFolder } from "obsidian";
import type { DataWriteOptions, EventRef, TAbstractFile } from "obsidian";

import type { VaultSource } from "#obsidian-vault.ts";

type Callback = (...args: unknown[]) => unknown;

export function heldInAnyCase(
  held: readonly TAbstractFile[],
  path: string,
): TAbstractFile | null {
  const folded = path.toLowerCase();
  return held.find((entry) => entry.path.toLowerCase() === folded) ?? null;
}

export class MemoryVault implements VaultSource {
  readonly files = new Map<string, TFile>();
  readonly contents = new Map<string, string>();
  readonly folders = new Map<string, TFolder>();
  readonly trashed: TAbstractFile[] = [];
  readonly #listeners = new Map<string, Set<Callback>>();

  static with<Stub extends object>(stub: Stub): MemoryVault & Stub {
    return Object.assign(new MemoryVault(), stub);
  }

  getFileByPath(path: string): TFile | null {
    return this.files.get(path) ?? null;
  }

  getFolderByPath(path: string): TFolder | null {
    return this.folders.get(path) ?? null;
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    return this.files.get(path) ?? this.folders.get(path) ?? null;
  }

  getAbstractFileByPathInsensitive(path: string): TAbstractFile | null {
    return (
      this.getAbstractFileByPath(path) ??
      heldInAnyCase([...this.files.values(), ...this.folders.values()], path)
    );
  }

  getMarkdownFiles(): TFile[] {
    return [...this.files.values()].filter((file) => file.extension === "md");
  }

  async read(file: TFile): Promise<string> {
    const text = this.contents.get(file.path);
    if (text === undefined) throw new Error(`ENOENT: ${file.path}`);
    return text;
  }

  cachedRead(file: TFile): Promise<string> {
    return this.read(file);
  }

  readonly adapter = {
    getBasePath: () => "/vault",
    getResourcePath: (path: string) => `app://test/${path}`,
    read: async (path: string): Promise<string> => {
      const text = this.contents.get(path);
      if (text === undefined)
        throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
      return text;
    },
  };

  async process(
    file: TFile,
    fn: (data: string) => string,
    _options?: DataWriteOptions,
  ): Promise<string> {
    const next = fn(await this.read(file));
    this.contents.set(file.path, next);
    this.trigger("modify", file);
    return next;
  }

  async create(
    path: string,
    data: string,
    _options?: DataWriteOptions,
  ): Promise<TFile> {
    if (this.files.has(path)) throw new Error("File already exists.");
    return this.add(path, data);
  }

  async createFolder(path: string): Promise<TFolder> {
    if (this.getAbstractFileByPath(path)) throw new Error("Folder already exists.");
    return this.addFolder(path);
  }

  async trash(file: TAbstractFile, _system: boolean): Promise<void> {
    this.trashed.push(file);
    this.remove(file.path);
  }

  on(name: string, callback: Callback): EventRef {
    let listeners = this.#listeners.get(name);
    if (!listeners) this.#listeners.set(name, (listeners = new Set()));
    listeners.add(callback);
    const ref = { e: this, name, fn: callback };
    return ref;
  }

  offref(ref: EventRef): void {
    const { name, fn } = ref as unknown as { name: string; fn: Callback };
    this.#listeners.get(name)?.delete(fn);
  }

  listenerCount(name: string): number {
    return this.#listeners.get(name)?.size ?? 0;
  }

  add(path: string, data = ""): TFile {
    const file = new TFile();
    file.path = path;
    this.files.set(path, file);
    this.contents.set(path, data);
    this.folders.get(dirname(path))?.children.push(file);
    this.trigger("create", file);
    return file;
  }

  addFolder(path: string): TFolder {
    const folder = new TFolder();
    folder.path = path;
    this.folders.set(path, folder);
    this.trigger("create", folder);
    return folder;
  }

  modify(file: TFile, data: string): void {
    this.contents.set(file.path, data);
    this.trigger("modify", file);
  }

  rename(file: TFile, path: string): void {
    const oldPath = file.path;
    const data = this.contents.get(oldPath);
    this.files.delete(oldPath);
    this.contents.delete(oldPath);
    file.path = path;
    this.files.set(path, file);
    if (data !== undefined) this.contents.set(path, data);
    this.trigger("rename", file, oldPath);
  }

  remove(path: string): void {
    const file = this.files.get(path);
    if (!file) return;
    this.files.delete(path);
    this.contents.delete(path);
    this.trigger("delete", file);
  }

  trigger(name: string, ...args: unknown[]): void {
    for (const callback of this.#listeners.get(name) ?? [])
      callback(...args);
  }
}
