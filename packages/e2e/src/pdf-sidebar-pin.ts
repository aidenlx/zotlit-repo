import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { desktopStateDir } from "@zotlit/config/memory-gate";
import type { ProcessRecord } from "@zotlit/scripts/desktop-slot";
import {
  holdDesktopMutex,
  isHolderAlive,
  processRecord,
} from "@zotlit/scripts/desktop-slot";

import { cli } from "./obsidian-cli.ts";
import { stableHost } from "./vault-script.ts";

export interface AppStorage {
  read(): Promise<string | null>;
  write(value: string | null): Promise<void>;
}

interface PinHolder extends ProcessRecord {
  token: string;
}

interface PinState {
  saved: string | null;
  holders: PinHolder[];
}

export interface LocalStoragePinOptions {
  key: string;
  value: string;
  storage: AppStorage;
  dir?: string;
  holder?: ProcessRecord;
}

export interface LocalStoragePin {
  [Symbol.asyncDispose](): Promise<void>;
}

const MUTEX = "local-storage-pin.lock";

function statePath(dir: string, key: string): string {
  return join(dir, `local-storage-pin-${encodeURIComponent(key)}.json`);
}

async function readState(path: string): Promise<PinState | undefined> {
  const text = await readFile(path, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    },
  );
  return text === undefined ? undefined : (JSON.parse(text) as PinState);
}

async function writeState(path: string, state: PinState): Promise<void> {
  const draft = `${path}.${randomUUID()}.draft`;
  await writeFile(draft, JSON.stringify(state));
  await rename(draft, path);
}

async function liveHolders(holders: PinHolder[]): Promise<PinHolder[]> {
  const alive = await Promise.all(holders.map(isHolderAlive));
  return holders.filter((_, index) => alive[index]);
}

export async function pinLocalStorage(
  options: LocalStoragePinOptions,
): Promise<LocalStoragePin> {
  const { key, value, storage } = options;
  const dir = options.dir ?? desktopStateDir();
  await mkdir(dir, { recursive: true });
  const path = statePath(dir, key);
  const self: PinHolder = {
    ...(options.holder ?? (await processRecord())),
    token: randomUUID(),
  };
  {
    using _mutex = await holdDesktopMutex(MUTEX, { dir });
    const state = await readState(path);
    const live = state ? await liveHolders(state.holders) : [];
    const current = await storage.read();
    const saved =
      state && (live.length > 0 || current === value) ? state.saved : current;
    await writeState(path, { saved, holders: [...live, self] });
    if (current !== value) await storage.write(value);
  }
  let released = false;
  return {
    [Symbol.asyncDispose]: async () => {
      if (released) return;
      released = true;
      using _mutex = await holdDesktopMutex(MUTEX, { dir });
      const state = await readState(path);
      if (!state) return;
      const live = await liveHolders(
        state.holders.filter((holder) => holder.token !== self.token),
      );
      await writeState(path, { saved: state.saved, holders: live });
      if (live.length > 0) return;
      await storage.write(state.saved);
      await rm(path, { force: true });
    },
  };
}

export const PDF_SIDEBAR_KEY = "pdfjs.sidebarView";

async function evalInApp(code: string): Promise<string> {
  const host = await stableHost();
  const output = await cli([
    ...(host ? [`vault=${host}`] : []),
    "eval",
    `code=${code}`,
  ]);
  const at = output.lastIndexOf("=> ");
  if (at < 0) throw new Error(`obsidian eval failed: ${output}`);
  return output.slice(at + 3);
}

function appLocalStorage(key: string): AppStorage {
  const name = JSON.stringify(key);
  return {
    read: async () =>
      JSON.parse(
        await evalInApp(`JSON.stringify(localStorage.getItem(${name}))`),
      ) as string | null,
    write: async (value) => {
      const reply = await evalInApp(
        value === null
          ? `(localStorage.removeItem(${name}),"written")`
          : `(localStorage.setItem(${name},${JSON.stringify(value)}),"written")`,
      );
      if (reply !== "written")
        throw new Error(`writing ${key} answered ${reply}`);
    },
  };
}

export function pinPdfSidebar(): Promise<LocalStoragePin> {
  return pinLocalStorage({
    key: PDF_SIDEBAR_KEY,
    value: "0",
    storage: appLocalStorage(PDF_SIDEBAR_KEY),
  });
}
