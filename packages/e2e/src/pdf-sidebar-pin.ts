// Automated desktop runs hold Obsidian's PDF sidebar closed.
//
// Obsidian's own PDF viewer reads the `localStorage` key `pdfjs.sidebarView`
// each time it opens a PDF. With "1" it opens the thumbnail sidebar after the
// first view is set, and the page moves under a case that reads its geometry.
// The key outranks the per-file value in `pdfjs.history`, and every vault
// window of the app shares one `localStorage`, so one press of the thumbnail
// button in any vault changes every later run. Each automated run that can
// open a PDF therefore pins the key to "0" ({@link pinPdfSidebar}), and the
// value from before the first run comes back when the last run ends.
//
// Runs from other worktrees overlap in the same app (Desktop Slots), so the
// pin is counted across processes in one state file, changed only under a
// machine-wide mutex:
//
//   first pin     saves the value it finds, writes the pinned value
//   later pin     joins; the saved value stays the one from before the first
//   release       leaves the pinned value while another holder lives;
//                 the last one writes the saved value back and deletes the file
//
// A holder whose process died without its release stays in the file until the
// next pin or release drops it, so the last live run still puts the value
// back. A file with no live holder is such a leftover: the next pin keeps its
// saved value, unless the key no longer has the pinned value, which then is a
// newer choice of the person at the app.

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

/** One key of the app's shared `localStorage`; null stands for no value. */
export interface AppStorage {
  read(): Promise<string | null>;
  write(value: string | null): Promise<void>;
}

interface PinHolder extends ProcessRecord {
  token: string;
}

interface PinState {
  /** The value from before the first pin; null when the key had none. */
  saved: string | null;
  holders: PinHolder[];
}

export interface LocalStoragePinOptions {
  key: string;
  value: string;
  storage: AppStorage;
  /** @default desktopStateDir() */
  dir?: string;
  /** The process whose life the pin lasts at most. @default this process */
  holder?: ProcessRecord;
}

/** A held pin; disposing it releases the pin once. */
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

/**
 * Pin `key` of the app's `localStorage` to `value` until the returned pin is
 * disposed or its holder process ends. Pins of several processes overlap: the
 * key keeps `value` while any of them lives, and the last release writes back
 * the value from before the first pin.
 */
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
    // The file comes first: a run that dies before the write below has its
    // saved value recorded.
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
      // This holder leaves the file before the write: when the write fails,
      // the file keeps the saved value for the next last release.
      await writeState(path, { saved: state.saved, holders: live });
      if (live.length > 0) return;
      await storage.write(state.saved);
      await rm(path, { force: true });
    },
  };
}

export const PDF_SIDEBAR_KEY = "pdfjs.sidebarView";

/** The reply value of Obsidian's `eval`, after its `=> ` prefix. */
async function evalInApp(code: string): Promise<string> {
  // `localStorage` is one for every vault window, so any window answers.
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

/** One key of the desktop app's `localStorage`, read and written in a vault window. */
function appLocalStorage(key: string): AppStorage {
  const name = JSON.stringify(key);
  return {
    read: async () =>
      JSON.parse(
        await evalInApp(`JSON.stringify(localStorage.getItem(${name}))`),
      ) as string | null,
    write: async (value) => {
      // A call that returns nothing gets no `=> ` reply; "written" proves it ran.
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

/**
 * Hold Obsidian's PDF sidebar closed ({@link PDF_SIDEBAR_KEY} at "0") for
 * an automated desktop run, from before its first vault opens to its end.
 * Every PDF the run opens then keeps the page geometry its cases read.
 */
export function pinPdfSidebar(): Promise<LocalStoragePin> {
  return pinLocalStorage({
    key: PDF_SIDEBAR_KEY,
    value: "0",
    storage: appLocalStorage(PDF_SIDEBAR_KEY),
  });
}
