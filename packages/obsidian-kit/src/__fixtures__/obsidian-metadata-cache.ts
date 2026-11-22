import type { CachedMetadata, EventRef, TFile } from "obsidian";

import type { MetadataCacheSource } from "#obsidian-metadata-cache.ts";

type Callback = (...args: unknown[]) => unknown;

export class MemoryMetadataCache implements MetadataCacheSource {
  readonly entries = new Map<string, CachedMetadata>();
  readonly links = new Map<string, TFile>();
  resolvedLinks: Record<string, Record<string, number>> = {};
  clean = false;
  readonly #listeners = new Map<string, Set<Callback>>();
  readonly #cleanCallbacks: (() => void)[] = [];

  getFileCache(file: TFile): CachedMetadata | null {
    return this.getCache(file.path);
  }

  getFirstLinkpathDest(linkpath: string, _sourcePath: string): TFile | null {
    return this.links.get(linkpath) ?? null;
  }

  getCache(path: string): CachedMetadata | null {
    const cache = this.entries.get(path);
    if (!cache) return null;
    return path.endsWith(".md") ? cache : {};
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

  setCache(path: string, cache: CachedMetadata): void {
    this.entries.set(path, cache);
  }

  change(file: TFile, cache: CachedMetadata, data = ""): void {
    this.entries.set(file.path, cache);
    this.trigger("changed", file, data, cache);
  }

  delete(file: TFile): void {
    const prevCache = this.entries.get(file.path) ?? null;
    this.entries.delete(file.path);
    this.trigger("deleted", file, prevCache);
  }

  onCleanCache(callback: () => void): void {
    if (this.clean) callback();
    else this.#cleanCallbacks.push(callback);
  }

  resolve(): void {
    this.clean = true;
    this.trigger("resolved");
    for (const callback of this.#cleanCallbacks.splice(0)) callback();
  }

  trigger(name: string, ...args: unknown[]): void {
    for (const callback of this.#listeners.get(name) ?? [])
      callback(...args);
  }
}
