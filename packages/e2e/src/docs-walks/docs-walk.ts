import { prepareRunWindow } from "@e2e/background-throttling.ts";
import type { CameraEvent, Rect } from "@e2e/docs-walks/camera.ts";
import {
  encodeClip,
  encodeMovie,
  readTrack,
} from "@e2e/docs-walks/clip-encode.ts";
import type {
  CameraLog,
  ClipSequence,
  RecordedFrame,
} from "@e2e/docs-walks/clip-encode.ts";
import { clipSettings } from "@e2e/docs-walks/clip-settings.ts";
import type { ClipSettings } from "@e2e/docs-walks/clip-settings.ts";
import type {
  DocsBrowser,
  DocsBrowserPage,
} from "@e2e/docs-walks/docs-browser.ts";
import { bringToFront, recordDesktop } from "@e2e/docs-walks/macos-desktop.ts";
import type { DesktopShot } from "@e2e/docs-walks/macos-desktop.ts";
import {
  arrowStyle,
  pointerGlide,
  pointerLook,
  ringStyle,
} from "@e2e/docs-walks/pointer-look.ts";
import {
  outputSizes,
  takeRecipe,
  takeRecordFile,
  takeRun,
  videoLength,
  writeTake,
} from "@e2e/docs-walks/takes.ts";
import type { TakeRun } from "@e2e/docs-walks/takes.ts";
import { clearNotices, cli, obRun } from "@e2e/obsidian-cli.ts";
import { openPairedEnvironment } from "@e2e/paired-environment.ts";
import { openZoteroRdp } from "@e2e/paired-zotero.ts";
import type { ZoteroRdp } from "@e2e/paired-zotero.ts";
import { execFile, spawn } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { expect } from "vitest";

import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

const execFileAsync = promisify(execFile);

declare module "../page-helpers.ts" {
  interface PageScratch {
    docsWalkNotices?: string[];
    docsWalkNoticeObserver?: MutationObserver;
    docsWalkPointer?: DocsWalkPointer;
    docsWalkReleaseNotices?: () => void;
    docsWalkStopRecording?: () => Promise<{
      frames: RecordedFrame[];
      camera: CameraLog;
    }>;
  }
}

export interface DocsWalkPointer {
  point(el: Element, options?: { inset?: number }): Promise<void>;
  pointAt(x: number, y: number): Promise<void>;
  park(x: number, y: number): Promise<void>;
  drag(from: DragEnd, to: DragEnd): Promise<void>;
  type(input: HTMLInputElement, text: string): Promise<void>;
  keys(
    text: string,
    put: (key: string) => void,
    options?: { speed?: number },
  ): Promise<void>;
  look(
    target: LookTarget | readonly LookTarget[],
    options?: { padding?: number },
  ): Promise<void>;
}

export type DragEnd = Element | { x: number; y: number };

export type LookTarget =
  | Element
  | { left: number; top: number; right: number; bottom: number };

export async function watchNotices(vaultId: string): Promise<void> {
  await obRun(vaultId, ({ page }) => {
    const { scratch } = page;
    scratch.docsWalkNotices = [];
    if (scratch.docsWalkNoticeObserver) return;
    scratch.docsWalkNoticeObserver = new MutationObserver(() => {
      const seen = (scratch.docsWalkNotices ??= []);
      for (const n of document.querySelectorAll(".notice")) {
        const t = n.textContent;
        if (!seen.includes(t)) seen.push(t);
      }
    });
    scratch.docsWalkNoticeObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
}

export function readNotices(vaultId: string): Promise<string[]> {
  return obRun(vaultId, ({ page }) => page.scratch.docsWalkNotices ?? []);
}

export async function holdNotices(vaultId: string): Promise<void> {
  await obRun(vaultId, ({ page }) => {
    const held = new Set<Element>();
    const observer = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.removedNodes) {
          if (
            !(node instanceof Element) ||
            !(node.matches(".notice") || node.querySelector(".notice"))
          )
            continue;
          for (const n of [node, ...node.querySelectorAll(".notice")])
            if (n instanceof HTMLElement) {
              n.style.transition = "none";
              n.style.opacity = "1";
              n.style.marginTop = "";
            }
          record.target.appendChild(node);
          held.add(node);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    page.scratch.docsWalkReleaseNotices = () => {
      observer.disconnect();
      for (const node of held) node.remove();
    };
  });
}

export async function closeWelcome(vaultId: string): Promise<void> {
  await obRun(vaultId, async ({ zotlit }) => {
    const s = zotlit.services;
    s.bridge.runSync(
      s.settings.update({
        "welcome.dismissed": true,
        "welcome.requested": false,
        "welcome.steps-shown": false,
      }),
    );
    await s.bridge.runPromise(s.settings.flush);
  });
}

export function captureRequested(): boolean {
  return process.env.DOCS_WALK_CAPTURE === "1";
}

export function recordRequested(name?: string): boolean {
  if (process.env.DOCS_WALK_RECORD !== "1") return false;
  const only = process.env.DOCS_WALK_ONLY;
  return !name || !only || only.split(",").includes(name);
}

export function exclusiveHoldRequested(): boolean {
  return captureRequested() || recordRequested();
}

export interface DocsWalkOptions {
  slug: string;
  collection: string;
  vaultCase?: string;
  window?: { width: number; height: number };
  clip?: Partial<ClipSettings>;
}

export interface DocsWalk extends AsyncDisposable {
  vaultId: string;
  zotero: ZoteroRdp;
  capture(layer: string, options?: { notices?: boolean }): Promise<void>;
  compose(name: string): Promise<void>;
  record<T>(
    name: string,
    actions: () => Promise<T>,
    options?: { notices?: boolean },
  ): Promise<T>;
  recordClip<T>(
    name: string,
    run: (shots: ClipShots) => Promise<T>,
  ): Promise<T>;
  recordZotero<T>(
    name: string,
    title: RegExp,
    actions: (
      pointAt: (window: string, element: string) => Promise<void>,
      stop: () => Promise<void>,
    ) => Promise<T>,
  ): Promise<T>;
}

export interface ClipShots {
  obsidian<T>(
    actions: () => Promise<T>,
    options?: { notices?: boolean },
  ): Promise<T>;
  browser<T>(
    browser: DocsBrowser,
    actions: (page: DocsBrowserPage) => Promise<T>,
  ): Promise<T>;
  desktop<T>(
    options: { pid: number; region: Rect; start: Rect; blur?: Rect[] },
    actions: (shot: DesktopShot) => Promise<T>,
  ): Promise<T>;
  mark(): number;
  rollback(mark: number): Promise<void>;
}

interface Layout {
  margin?: number;
  layers: { src: string; lights?: boolean }[];
}

export async function openDocsWalk(
  options: DocsWalkOptions,
): Promise<DocsWalk> {
  const root = await getWorkspaceRoot(import.meta.dirname);
  const { width, height } = options.window ?? { width: 1440, height: 860 };
  await using stack = new AsyncDisposableStack();
  const environment = stack.use(
    await openPairedEnvironment(root, {
      name: "docs-walk",
      vaultCase: options.vaultCase ?? "demo",
    }),
  );
  const { vaultId } = environment;
  await prepareRunWindow(vaultId);
  await obRun(vaultId, ({ app }) => {
    app.vault.setConfig("nativeMenus", false);
  });
  await obRun(
    vaultId,
    (_, size) => {
      (
        require("@electron/remote") as {
          getCurrentWindow(): { setSize(width: number, height: number): void };
        }
      )
        .getCurrentWindow()
        .setSize(size.width, size.height);
    },
    { width, height },
  );
  const zotero = stack.use(await openZoteroRdp(environment.debuggerPort));

  const captures = join(root, ".scratch", "docs-walks", options.slug);
  const layouts = join(import.meta.dirname, `${options.slug}.layouts`);
  const tracks = join(import.meta.dirname, `${options.slug}.camera`);
  const settings = clipSettings(options.clip);
  const takes = await takeRecordFile(root, options.slug);
  let run: TakeRun | undefined;
  const runFacts = async () =>
    (run ??= await takeRun(root, {
      slug: options.slug,
      running: (await cli(["version"])).trim(),
      zotero: await zotero.json<string>("Zotero.version"),
      vaultCase: options.vaultCase ?? "demo",
      window: { width, height },
    }));
  const images = join(
    root,
    "apps",
    "docs",
    "public",
    "img",
    options.collection,
  );

  const taken = new Set<string>();
  const shoot = async (layer: string, notices: boolean) => {
    await mkdir(captures, { recursive: true });
    if (!notices) await clearNotices(vaultId);
    else
      await obRun(vaultId, async ({ page }) => {
        await page
          .until(
            "notices in place",
            () =>
              [...document.querySelectorAll(".notice")].every(
                (n) => n.getBoundingClientRect().right <= window.innerWidth,
              ),
            2000,
          )
          .catch(() => undefined);
      });
    await obRun(
      vaultId,
      () =>
        new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        ),
    );
    await cli([
      `vault=${vaultId}`,
      "dev:screenshot",
      `path=${join(captures, `${layer}.png`)}`,
    ]);
  };

  const shootNotices = async (name: string) => {
    if (!captureRequested()) return;
    await obRun(vaultId, () => {
      for (const el of document.querySelectorAll<HTMLElement>(
        "[data-docs-walk-pointer]",
      ))
        el.style.visibility = "hidden";
    });
    await shoot(name, true);
    taken.add(name);
    await obRun(vaultId, () => {
      for (const el of document.querySelectorAll<HTMLElement>(
        "[data-docs-walk-pointer]",
      ))
        el.style.visibility = "";
    });
  };

  const owned = stack.move();
  return {
    vaultId,
    zotero,
    async capture(layer, { notices = false } = {}) {
      if (!captureRequested()) return;
      if (taken.delete(layer)) return;
      await shoot(layer, notices);
    },
    async compose(name) {
      if (!captureRequested()) return;
      const layoutFile = join(layouts, `${name}.json`);
      const layout: Layout = await access(layoutFile).then(
        async () => JSON.parse(await readFile(layoutFile, "utf8")) as Layout,
        () => ({
          margin: 0.1,
          layers: [{ src: `${name}.png`, lights: false }],
        }),
      );
      const resolved = join(captures, `${name}.layout.json`);
      await writeFile(resolved, JSON.stringify(layout, null, 2));
      await mkdir(images, { recursive: true });
      await execFileAsync(
        process.execPath,
        [
          join(root, ".agents", "skills", "docs-screenshot", "compose.mjs"),
          join(images, `${name}.webp`),
          resolved,
        ],
        { windowsHide: true },
      );
    },
    async record(name, actions, { notices = false } = {}) {
      if (!recordRequested(name)) return actions();
      const frames = join(captures, `${name}.frames`);
      await rm(frames, { recursive: true, force: true });
      await startRecording(vaultId, frames, settings);
      if (notices) await holdNotices(vaultId);
      let result: Awaited<ReturnType<typeof actions>>;
      try {
        result = await actions();
        if (notices) await shootNotices(name);
        await new Promise((r) => setTimeout(r, settings.rest * 1000));
      } finally {
        await stopRecording(vaultId, frames, settings);
      }
      await mkdir(images, { recursive: true });
      const out = join(images, name);
      const override = settings.camera
        ? await readTrack(join(tracks, `${name}.json`))
        : undefined;
      const cut = await encodeClip(frames, out, { track: override, settings });
      await writeTake(takes, name, {
        recordedAt: Temporal.Now.instant().toString(),
        step: expect.getState().currentTestName ?? "",
        recipe: takeRecipe(root, {
          slug: options.slug,
          name,
          out,
          frames,
          clip: options.clip,
        }),
        ...(await runFacts()),
        source: "obsidian-screencast",
        frames: relative(root, frames),
        settings,
        duration: await videoLength(`${out}.mp4`),
        outputs: await outputSizes(root, out),
        camera: {
          track: !settings.camera ? "whole" : override ? "override" : "planned",
          viewport: cut.log.viewport,
          events: cut.log.events,
          keyframes: cut.track.keyframes,
        },
      });
      return result;
    },
    async recordClip(name, run) {
      const frames = join(captures, `${name}.frames`);
      await rm(frames, { recursive: true, force: true });
      await mkdir(frames, { recursive: true });
      const sequence: ClipSequence = { shots: [] };
      const shot = (kind: string, track?: string) => {
        const dir = `${String(sequence.shots.length + 1).padStart(2, "0")}-${kind}`;
        sequence.shots.push({ dir, ...(track && { track }) });
        return join(frames, dir);
      };
      const result = await run({
        async obsidian(actions, { notices = false } = {}) {
          const dir = shot("obsidian");
          await mkdir(dir, { recursive: true });
          await startRecording(vaultId, dir, settings);
          try {
            const value = await actions();
            if (notices) await shootNotices(name);
            await new Promise((r) => setTimeout(r, settings.rest * 1000));
            return value;
          } finally {
            await stopRecording(vaultId, dir, settings);
          }
        },
        browser: (browser, actions) =>
          browser.record(shot("browser"), settings, actions),
        desktop: (options, actions) =>
          recordDesktop(
            shot("desktop", "track.json"),
            { ...options, settings },
            actions,
          ),
        mark: () => sequence.shots.length,
        async rollback(mark) {
          for (const { dir } of sequence.shots.splice(mark))
            await rm(join(frames, dir), { recursive: true, force: true });
        },
      });
      await writeFile(
        join(frames, "sequence.json"),
        `${JSON.stringify(sequence, null, 2)}\n`,
      );
      await mkdir(images, { recursive: true });
      const out = join(images, name);
      await encodeClip(frames, out, { settings });
      await writeTake(takes, name, {
        recordedAt: Temporal.Now.instant().toString(),
        step: expect.getState().currentTestName ?? "",
        recipe: takeRecipe(root, {
          slug: options.slug,
          name,
          out,
          frames,
          clip: options.clip,
        }),
        ...(await runFacts()),
        source: "sequence",
        frames: relative(root, frames),
        settings,
        duration: await videoLength(`${out}.mp4`),
        outputs: await outputSizes(root, out),
        shots: await Promise.all(
          sequence.shots.map(async ({ dir }) => {
            const log = JSON.parse(
              await readFile(join(frames, dir, "camera.json"), "utf8"),
            ) as CameraLog;
            const track = (await readTrack(join(frames, dir, "track.json")))!;
            return {
              dir,
              viewport: log.viewport,
              events: log.events,
              keyframes: track.keyframes,
            };
          }),
        ),
      });
      return result;
    },
    async recordZotero(name, title, actions) {
      const pointAt = (window: string, element: string) =>
        zoteroPointer(zotero, { window, element }, settings);
      if (!recordRequested(name))
        return actions(
          async () => {},
          async () => {},
        );
      await mkdir(captures, { recursive: true });
      const pid = await zotero.json<number>("Services.appinfo.processID");
      const movie = join(captures, `${name}.mov`);
      await rm(movie, { force: true });
      await bringToFront(pid);
      await zotero.json<boolean>(
        `(()=>{const t=new RegExp(${JSON.stringify(title.source)});for(const w of Services.wm.getEnumerator(null))if(t.test(w.document.title)){w.focus();return true;}return false;})()`,
      );
      const target = await raisedZoteroWindow(pid, title);
      const dialog = target.layer > 0;
      const capture = spawn(
        "screencapture",
        dialog
          ? ["-x", "-v", "-R", target.bounds, movie]
          : ["-x", "-v", "-o", "-l", String(target.id), movie],
        { stdio: "ignore" },
      );
      const ended = new Promise((r) => capture.once("exit", r));
      await new Promise((r) => setTimeout(r, 800));
      let stopped = false;
      const stop = async () => {
        if (stopped) return;
        stopped = true;
        await new Promise((r) => setTimeout(r, settings.rest * 1000));
        capture.kill("SIGINT");
        await ended;
      };
      let result: Awaited<ReturnType<typeof actions>>;
      try {
        result = await actions(pointAt, stop);
      } finally {
        await stop();
        await zotero
          .json<boolean>(
            `(()=>{for(const w of Services.wm.getEnumerator(null))for(const e of [...w.document.querySelectorAll('[data-docs-walk-pointer]')])e.remove();return true;})()`,
          )
          .catch(() => false);
      }
      await mkdir(images, { recursive: true });
      const out = join(images, name);
      await encodeMovie(movie, out, { inset: dialog ? 24 : 0, settings });
      await writeTake(takes, name, {
        recordedAt: Temporal.Now.instant().toString(),
        step: expect.getState().currentTestName ?? "",
        recipe: takeRecipe(root, {
          slug: options.slug,
          name,
          out,
          clip: options.clip,
        }),
        ...(await runFacts()),
        source: "zotero-window",
        frames: relative(root, movie),
        settings,
        duration: await videoLength(`${out}.mp4`),
        outputs: await outputSizes(root, out),
      });
      return result;
    },
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  };
}

async function stopRecording(
  vaultId: string,
  dir: string,
  settings: ClipSettings,
): Promise<void> {
  const recorded = await obRun(vaultId, async ({ page }) => {
    const stop = page.scratch.docsWalkStopRecording;
    delete page.scratch.docsWalkStopRecording;
    delete page.scratch.docsWalkPointer;
    for (const el of document.querySelectorAll("[data-docs-walk-pointer]"))
      el.remove();
    const done = stop ? await stop() : undefined;
    page.scratch.docsWalkReleaseNotices?.();
    delete page.scratch.docsWalkReleaseNotices;
    return done;
  });
  await writeFile(
    join(dir, "frames.json"),
    JSON.stringify(recorded?.frames ?? [], null, 2),
  );
  if (recorded)
    await writeFile(
      join(dir, "camera.json"),
      JSON.stringify({ ...recorded.camera, settings }, null, 2),
    );
}

async function startRecording(
  vaultId: string,
  dir: string,
  settings: ClipSettings,
): Promise<void> {
  const { glideMs, transitionMs } = pointerGlide(settings);
  await obRun(
    vaultId,
    async (
      { page },
      { dir, opening, glideMs, arrowCss, ringCss, typing, lookMs, look },
    ) => {
      const fs = require("fs") as typeof import("node:fs");
      const path = require("path") as typeof import("node:path");
      fs.mkdirSync(dir, { recursive: true });
      const contents = (
        require("@electron/remote") as typeof import("@electron/remote")
      ).getCurrentWebContents();
      const cdp = contents.debugger;
      if (!cdp.isAttached()) cdp.attach("1.3");
      const frames: { file: string; t: number }[] = [];
      const onMessage = (
        _event: unknown,
        method: string,
        params: {
          data: string;
          sessionId: number;
          metadata: { timestamp: number };
        },
      ) => {
        if (method !== "Page.screencastFrame") return;
        const file = `f${String(frames.length).padStart(5, "0")}.png`;
        fs.writeFileSync(
          path.join(dir, file),
          Buffer.from(params.data, "base64"),
        );
        frames.push({ file, t: params.metadata.timestamp });
        cdp
          .sendCommand("Page.screencastFrameAck", {
            sessionId: params.sessionId,
          })
          .catch(() => {});
      };
      cdp.on("message", onMessage);

      const pointer = document.body.createDiv({
        attr: { "data-docs-walk-pointer": "" },
      });
      pointer.style.cssText = arrowCss;
      pointer.innerHTML = look.arrow;
      const ring = document.body.createDiv({
        attr: { "data-docs-walk-pointer": "" },
      });
      ring.style.cssText = `position:fixed;left:0;top:0;${ringCss}opacity:0;`;
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const start = {
        x: Math.round(window.innerWidth * 0.55),
        y: Math.round(window.innerHeight * 0.6),
      };
      pointer.style.transform = `translate(${start.x}px,${start.y}px)`;
      const glide = async (x: number, y: number) => {
        const cx = Math.min(Math.max(x, 0), window.innerWidth - 22);
        const cy = Math.min(Math.max(y, 0), window.innerHeight - 26);
        pointer.style.transform = `translate(${cx}px,${cy}px)`;
        await wait(glideMs);
      };
      const mark = async (x: number, y: number) => {
        ring.style.left = `${x}px`;
        ring.style.top = `${y}px`;
        ring.animate(look.ringKeyframes, {
          duration: look.ringMs,
          easing: "ease-out",
        });
        await wait(look.markMs);
      };
      const typeKeys = async (
        text: string,
        put: (key: string) => void,
        { speed = 1 }: { speed?: number } = {},
      ) => {
        let n = 0;
        for (const ch of text) {
          put(ch);
          await wait(
            (ch === " " ? 150 : 85 + (n++ % 3) * 20) / (speed * typing),
          );
        }
      };

      const events: CameraEvent[] = [];
      const now = () => (performance.timeOrigin + performance.now()) / 1000;
      const rectOf = (b: {
        left: number;
        top: number;
        right: number;
        bottom: number;
      }): Rect => ({
        x: b.left,
        y: b.top,
        w: b.right - b.left,
        h: b.bottom - b.top,
      });
      const around = (rects: Rect[]): Rect | undefined => {
        if (rects.length === 0) return undefined;
        const x = Math.min(...rects.map((r) => r.x));
        const y = Math.min(...rects.map((r) => r.y));
        return {
          x,
          y,
          w: Math.max(...rects.map((r) => r.x + r.w)) - x,
          h: Math.max(...rects.map((r) => r.y + r.h)) - y,
        };
      };
      const caret = (): Rect | undefined => {
        const el = document.activeElement;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
          return rectOf(el.getBoundingClientRect());
        const selection = document.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const boxes = range.getClientRects();
          const b =
            boxes.item(boxes.length - 1) ?? range.getBoundingClientRect();
          if (b.height > 0) return rectOf(b);
          const node = selection.focusNode;
          const at =
            node instanceof Element
              ? (node.childNodes[selection.focusOffset] ?? node)
              : node;
          const line = (
            at instanceof Element ? at : at?.parentElement
          )?.closest(".cm-line, p, li");
          if (line) return rectOf(line.getBoundingClientRect());
        }
        return el && el !== document.body
          ? rectOf(el.getBoundingClientRect())
          : undefined;
      };

      const aim = (el: Element, inset?: number) => {
        el.scrollIntoView({ block: "nearest", behavior: "instant" });
        const b = el.getBoundingClientRect();
        return {
          x: Math.round(b.left + (inset ?? Math.min(b.width / 2, 120))),
          y: Math.round(b.top + b.height / 2),
          rect: rectOf(b),
        };
      };

      page.scratch.docsWalkPointer = {
        async point(el, { inset } = {}) {
          const { x, y, rect } = aim(el, inset);
          await glide(x, y);
          events.push({ kind: "point", t: now(), x, y, rect });
          await mark(x, y);
        },
        async pointAt(x, y) {
          await glide(Math.round(x), Math.round(y));
          events.push({ kind: "point", t: now(), x, y });
          await mark(Math.round(x), Math.round(y));
        },
        async park(x, y) {
          await glide(Math.round(x), Math.round(y));
          events.push({ kind: "park", t: now(), x, y });
        },
        async drag(from, to) {
          const spotOf = (e: DragEnd) =>
            e instanceof Element
              ? aim(e)
              : { x: Math.round(e.x), y: Math.round(e.y) };
          const a = spotOf(from);
          await glide(a.x, a.y);
          const t = now();
          await mark(a.x, a.y);
          const b = spotOf(to);
          await glide(b.x, b.y);
          events.push({ kind: "drag", t, end: now(), from: a, to: b });
        },
        async type(input, text) {
          const b = input.getBoundingClientRect();
          pointer.style.transform = `translate(${Math.round(b.right - 40)}px,${Math.round(b.bottom + 16)}px)`;
          input.focus();
          const t = now();
          await typeKeys(text, (ch) => {
            input.value += ch;
            input.dispatchEvent(new Event("input", { bubbles: true }));
          });
          events.push({ kind: "type", t, end: now(), rect: rectOf(b) });
        },
        async keys(text, put, options) {
          const t = now();
          const before = caret();
          await typeKeys(text, put, options);
          const rect = around(
            [before, caret()].filter((r): r is Rect => r !== undefined),
          );
          events.push({ kind: "keys", t, end: now(), ...(rect && { rect }) });
        },
        async look(target, { padding } = {}) {
          const targets = (
            Array.isArray(target) ? target : [target]
          ) as readonly LookTarget[];
          const rect = around(
            targets
              .map((x) => {
                const b = x instanceof Element ? x.getBoundingClientRect() : x;
                return rectOf({
                  left: Math.max(b.left, 0),
                  top: Math.max(b.top, 0),
                  right: Math.min(b.right, window.innerWidth),
                  bottom: Math.min(b.bottom, window.innerHeight),
                });
              })
              .filter((r) => r.w > 0 && r.h > 0),
          );
          if (!rect) return;
          events.push({
            kind: "look",
            t: now(),
            rect,
            ...(padding !== undefined && { padding }),
          });
          await wait(lookMs);
        },
      };
      page.scratch.docsWalkStopRecording = async () => {
        await cdp.sendCommand("Page.stopScreencast");
        cdp.removeListener("message", onMessage);
        const end = now();
        const origin = frames[0]?.t ?? end;
        return {
          frames: [...frames, { file: "", t: end }],
          camera: {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            events: events.map((e) =>
              "end" in e
                ? { ...e, t: e.t - origin, end: e.end - origin }
                : { ...e, t: e.t - origin },
            ),
          },
        };
      };
      await cdp.sendCommand("Page.startScreencast", {
        format: "png",
        everyNthFrame: 1,
      });
      await wait(opening);
    },
    {
      dir,
      opening: settings.opening * 1000,
      glideMs,
      arrowCss: arrowStyle(transitionMs),
      ringCss: ringStyle({
        border: "hsl(var(--interactive-accent-hsl))",
        fill: "hsla(var(--interactive-accent-hsl),.18)",
      }),
      look: pointerLook,
      typing: settings.typing,
      lookMs: settings.camera ? settings.ease * 1000 : 0,
    },
    { timeoutMs: 30000 },
  );
}

async function zoteroWindow(
  pid: number,
  title: RegExp,
): Promise<{ id: number; layer: number; bounds: string }> {
  const { stdout } = await execFileAsync("osascript", [
    "-l",
    "JavaScript",
    "-e",
    `ObjC.import("CoreGraphics"); const a = ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1, 0)); const out = []; for (let i = 0; i < Number(a.count); i++) { const w = ObjC.deepUnwrap(a.objectAtIndex(i)); if (w.kCGWindowLayer >= 0 && w.kCGWindowLayer < 20) out.push({ id: w.kCGWindowNumber, layer: w.kCGWindowLayer, pid: w.kCGWindowOwnerPID, owner: w.kCGWindowOwnerName, name: w.kCGWindowName || "", b: w.kCGWindowBounds }); } JSON.stringify(out)`,
  ]);
  type Box = { X: number; Y: number; Width: number; Height: number };
  const windows = JSON.parse(stdout) as {
    id: number;
    layer: number;
    pid: number;
    owner: string;
    name: string;
    b: Box;
  }[];
  const at = windows.findIndex((w) => w.pid === pid && title.test(w.name));
  const found = windows[at];
  if (!found)
    throw new Error(
      `no Zotero window on screen titled ${String(title)}: ${JSON.stringify(windows.filter((w) => w.pid === pid))}`,
    );
  const meets = (a: Box, b: Box) =>
    a.X < b.X + b.Width &&
    b.X < a.X + a.Width &&
    a.Y < b.Y + b.Height &&
    b.Y < a.Y + a.Height;
  const over = windows
    .slice(0, at)
    .filter((w) => w.pid !== pid && w.b.Width > 0 && meets(w.b, found.b));
  if (over.length > 0)
    throw new Error(
      `the Zotero window ${String(title)} is behind ${over.map((w) => w.owner).join(", ")}; the clip would record them`,
    );
  const { X, Y, Width, Height } = found.b;
  return {
    id: found.id,
    layer: found.layer,
    bounds: [X, Y, Width, Height].map(Math.round).join(","),
  };
}

async function raisedZoteroWindow(
  pid: number,
  title: RegExp,
): ReturnType<typeof zoteroWindow> {
  for (let tries = 1; ; tries++) {
    try {
      return await zoteroWindow(pid, title);
    } catch (error) {
      if (tries >= 20) throw error;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

async function zoteroPointer(
  zotero: ZoteroRdp,
  { window, element }: { window: string; element: string },
  settings: ClipSettings,
): Promise<void> {
  if (!recordRequested()) return;
  const { transitionMs, glideMs } = pointerGlide(settings);
  const { arrow, ringKeyframes, ringMs, markMs } = pointerLook;
  await zotero.json<boolean>(`(async()=>{const w=${window};const d=w.document;
    const ns='http://www.w3.org/1999/xhtml';const wait=(ms)=>new Promise(r=>w.setTimeout(r,ms));
    let p=d.querySelector('[data-docs-walk-pointer="arrow"]');
    if(!p){p=d.createElementNS(ns,'div');p.setAttribute('data-docs-walk-pointer','arrow');
      p.style.cssText=${JSON.stringify(arrowStyle(transitionMs))}+'transform:translate('+Math.round(w.innerWidth*0.5)+'px,'+Math.round(w.innerHeight*0.25)+'px)';
      p.innerHTML=${JSON.stringify(arrow)};
      d.documentElement.appendChild(p);await wait(300);}
    const e=${element};const b=e.getBoundingClientRect();
    const x=Math.round(b.left+b.width/2),y=Math.round(b.top+b.height/2);
    p.style.transform='translate('+x+'px,'+y+'px)';await wait(${glideMs});
    const r=d.createElementNS(ns,'div');r.setAttribute('data-docs-walk-pointer','ring');
    r.style.cssText='position:fixed;left:'+x+'px;top:'+y+'px;'+${JSON.stringify(ringStyle())};
    d.documentElement.appendChild(r);r.animate(${JSON.stringify(ringKeyframes)},{duration:${ringMs},easing:'ease-out',fill:'forwards'});
    await wait(${markMs});return true;})()`);
}
