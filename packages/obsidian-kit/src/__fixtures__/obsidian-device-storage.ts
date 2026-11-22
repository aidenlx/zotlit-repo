import type { DeviceStorageSource } from "#obsidian-device-storage.ts";

export class MemoryDeviceStorage implements DeviceStorageSource {
  readonly values = new Map<string, string>();

  loadLocalStorage(key: string): unknown {
    const text = this.values.get(key);
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  saveLocalStorage(key: string, data: unknown): void {
    if (data) this.values.set(key, JSON.stringify(data));
    else this.values.delete(key);
  }
}
