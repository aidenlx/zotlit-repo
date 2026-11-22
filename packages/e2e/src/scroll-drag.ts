import type { MarkdownView } from "obsidian";

import { obRun } from "./obsidian-cli.ts";

export type DragHost =
  | { readonly kind: "library" }
  | { readonly kind: "tab"; readonly path: string }
  | { readonly kind: "note"; readonly path: string; readonly root: string };

export type DragLeg = readonly [to: number, ms: number];

export const DRAG_PATH: readonly DragLeg[] = [
  [0.35, 150],
  [0.35, 400],
  [0.7, 1200],
  [0.7, 400],
  [0.4, 200],
  [0.4, 500],
];

export interface DragRecord {
  readonly box: { readonly length: number; readonly height: number };
  readonly thumb: number;
  readonly holds: readonly number[];
  readonly moving: number;
  readonly lengthChanges: { readonly moving: number; readonly resting: number };
  readonly legs: readonly {
    readonly to: number;
    readonly fewest: number;
    readonly most: number;
    readonly frames: number;
    readonly empty: number;
    readonly rows: number;
  }[];
  readonly screen: {
    readonly frames: number;
    readonly empty: number;
    readonly rows: number;
    readonly blankShare: number;
  };
  readonly header: readonly string[];
  readonly rows: { readonly mounted: number; readonly unlike: number };
}

const BOXES =
  '[data-query-layout="papers"], [data-query-layout="list"], .zt-table-scroller';

export async function dragScrollBar(
  vaultId: string,
  host: DragHost,
  path: readonly DragLeg[] = DRAG_PATH,
): Promise<DragRecord> {
  const json = await obRun(
    vaultId,
    async ({ app }, { host, boxes, path }) => {
      const remote =
        require("@electron/remote") as typeof import("@electron/remote");
      const scope = (() => {
        if (host.kind === "library")
          return app.workspace.getLeavesOfType("zotlit-library")[0]?.view
            .containerEl;
        const leaf = app.workspace
          .getLeavesOfType(
            host.kind === "tab" ? "zotlit-query-file" : "markdown",
          )
          .find((l) => (l.view as MarkdownView).file?.path === host.path);
        const el = leaf?.view.containerEl;
        return host.kind === "note" ? el?.querySelector(host.root) : el;
      })();
      const box = [...(scope?.querySelectorAll<HTMLElement>(boxes) ?? [])].find(
        (el) => el.isShown() && el.scrollHeight > el.clientHeight + 1000,
      );
      if (!box) throw new Error(`No long list in ${JSON.stringify(host)}`);
      const win = box.win;
      const doc = box.doc;
      const frame = () =>
        new Promise((resolve) => win.requestAnimationFrame(resolve));
      if (host.kind === "note") box.scrollIntoView({ block: "center" });
      box.scrollTop = 0;
      for (let still = 0, last = -1, tries = 0; still < 5; tries++) {
        if (tries > 120) throw new Error("The list's length never held");
        await frame();
        still = box.scrollHeight === last ? still + 1 : 0;
        last = box.scrollHeight;
      }
      const contents = remote.getCurrentWebContents();
      const zoom = contents.getZoomFactor();
      const trackTop =
        Number.parseFloat(
          box.style.getPropertyValue("--zt-table-header-height"),
        ) || 0;
      const geometry = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        const bar = el.offsetWidth - el.clientWidth;
        const track = el.clientHeight - trackTop;
        const grab = 8;
        return {
          rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
          track,
          bar,
          x: Math.round((r.right - (bar > 0 ? bar / 2 : 5)) * zoom),
          top: (r.top + trackTop + grab) * zoom,
          span: (track - 2 * grab) * zoom,
        };
      };
      const driver = async (g: {
        wcId: number;
        x: number;
        top: number;
        span: number;
        path: readonly (readonly [number, number])[];
        innerWidth: number;
        crop: { x: number; y: number; width: number; height: number } | null;
        now: number;
      }) => {
        const { webContents } = (
          process as unknown as { mainModule: NodeJS.Module }
        ).mainModule.require("electron") as typeof import("electron");
        const w = webContents.fromId(g.wcId)!;
        const skew = performance.timeOrigin + performance.now() - g.now;
        const clock = () => performance.timeOrigin + performance.now() - skew;
        const nap = (ms: number) =>
          new Promise((resolve) => setTimeout(resolve, ms));
        const sends: [number, number, number][] = [];
        const shots: [number, number, number][] = [];
        const BANDS = 24;
        const TEXT = 48;
        if (g.crop)
          w.beginFrameSubscription(false, (image) => {
            const t = clock();
            const k = image.getSize().width / g.innerWidth;
            const crop = g.crop!;
            const part = image
              .crop({
                x: Math.round(crop.x * k),
                y: Math.round(crop.y * k),
                width: Math.round(crop.width * k),
                height: Math.round(crop.height * k),
              })
              .resize({ width: 300, quality: "good" });
            const size = part.getSize();
            const bmp = part.toBitmap();
            const W = Math.round(
              Math.sqrt((bmp.length / 4) * (size.width / size.height)),
            );
            const H = Math.floor(bmp.length / 4 / W);
            const lum = (x: number, y: number) => {
              const i = (y * W + x) * 4;
              return (bmp[i]! + bmp[i + 1]! * 2 + bmp[i + 2]!) >> 2;
            };
            const hist = new Uint32Array(256);
            for (let y = 0; y < H; y += 3)
              for (let x = 0; x < W; x += 3) hist[lum(x, y)]!++;
            let bg = 0;
            for (let i = 1; i < 256; i++) if (hist[i]! > hist[bg]!) bg = i;
            let blank = 0;
            let text = 0;
            for (let y = 0; y < H; y++) {
              let line = 0;
              for (let x = 0; x < W; x++)
                if (Math.abs(lum(x, y) - bg) > TEXT) line++;
              if (line < W / 2) text += line;
            }
            for (let b = 0; b < BANDS; b++) {
              let n = 0;
              let ink = 0;
              const ya = Math.floor((H * b) / BANDS);
              const yb = Math.floor((H * (b + 1)) / BANDS);
              for (let y = ya; y < yb; y++)
                for (let x = 0; x < W; x += 2) {
                  n++;
                  if (Math.abs(lum(x, y) - bg) > 4) ink++;
                }
              if (ink / Math.max(1, n) < 0.002) blank++;
            }
            shots.push([t, blank / BANDS, text >= 20 ? 1 : 0]);
          });
        const send = (
          type: "mouseMove" | "mouseDown" | "mouseUp",
          y: number,
        ) => {
          w.sendInputEvent({
            type,
            x: g.x,
            y: Math.round(y),
            button: "left",
            clickCount: 1,
          });
          sends.push([
            clock(),
            Math.round(y),
            type === "mouseMove" ? 0 : type === "mouseDown" ? 1 : 2,
          ]);
        };
        try {
          for (let i = 0; i < 3; i++) {
            send("mouseMove", g.top - 2 + i);
            await nap(40);
          }
          send("mouseDown", g.top);
          await nap(60);
          let at = 0;
          for (const [to, ms] of g.path) {
            const t0 = clock();
            const from = at;
            sends.push([t0, Math.round(g.top + g.span * from), 3]);
            await new Promise<void>((resolve) => {
              const step = () => {
                const p = Math.min(1, (clock() - t0) / ms);
                const eased = p * p * (3 - 2 * p);
                if (to !== from)
                  send(
                    "mouseMove",
                    g.top + g.span * (from + (to - from) * eased),
                  );
                if (p < 1) setTimeout(step, 4);
                else resolve();
              };
              step();
            });
            at = to;
          }
          send("mouseUp", g.top + g.span * at);
        } finally {
          if (g.crop) w.endFrameSubscription();
        }
        return JSON.stringify({ sends, shots });
      };
      const drive = (
        remote.getGlobal("eval") as (code: string) => typeof driver
      )(`(${driver.toString()})`);
      const showBar = async (el: HTMLElement) => {
        el.scrollTop = 2;
        await frame();
        el.scrollTop = 0;
        await frame();
      };

      const plain = box.cloneNode(false) as HTMLElement;
      plain.removeAttribute("data-query-layout");
      const r0 = box.getBoundingClientRect();
      Object.assign(plain.style, {
        position: "fixed",
        left: `${r0.left}px`,
        top: `${r0.top}px`,
        width: `${box.offsetWidth}px`,
        height: `${box.offsetHeight}px`,
        zIndex: "10000",
        background: "var(--background-primary)",
      });
      const fill = doc.createElement("div");
      fill.style.height = `${box.scrollHeight}px`;
      plain.append(fill);
      doc.body.append(plain);
      let thumb = 0;
      try {
        fill.style.height = `${box.scrollHeight - (plain.scrollHeight - box.scrollHeight)}px`;
        await showBar(plain);
        const g = geometry(plain);
        const sent = JSON.parse(
          await drive({
            wcId: contents.id,
            x: g.x,
            top: g.top,
            span: g.span,
            path: [
              [0.5, 300],
              [0.5, 300],
            ],
            innerWidth: win.innerWidth,
            now: performance.timeOrigin + performance.now(),
            crop: null,
          }),
        ) as { sends: [number, number, number][] };
        const down = sent.sends.find((s) => s[2] === 1)!;
        const up = sent.sends.find((s) => s[2] === 2)!;
        const dy = (up[1] - down[1]) / zoom;
        const max = plain.scrollHeight - plain.clientHeight;
        thumb = g.track - (dy * max) / plain.scrollTop;
      } finally {
        plain.remove();
      }

      await showBar(box);
      const g = geometry(box);
      const samples: [number, number, number, number][] = [];
      const header = new Set<string>();
      const cells = () => {
        const head = box.querySelector("thead");
        const first = head?.querySelector("th");
        if (!head || !first) return;
        const bounds = box.getBoundingClientRect();
        header.add(
          [
            `top ${Math.round(first.getBoundingClientRect().top - bounds.top)}`,
            ...[...head.querySelectorAll("tr > th")].map((th) => {
              const r = th.getBoundingClientRect();
              return `${Math.round(r.left - bounds.left)}+${Math.round(r.width)}`;
            }),
          ].join(" "),
        );
      };
      let running = true;
      const tick = () => {
        if (!running) return;
        samples.push([
          performance.timeOrigin + performance.now(),
          box.scrollTop,
          box.scrollHeight,
          box.querySelectorAll("[data-index]").length,
        ]);
        cells();
        win.requestAnimationFrame(tick);
      };
      box.addEventListener("scroll", cells);
      win.requestAnimationFrame(tick);
      const crop = {
        x: g.rect.left,
        y: g.rect.top + trackTop,
        width: Math.max(1, g.rect.right - g.rect.left - Math.max(g.bar, 16)),
        height: Math.max(1, g.rect.bottom - g.rect.top - trackTop),
      };
      let run: {
        sends: [number, number, number][];
        shots: [number, number, number][];
      };
      try {
        run = JSON.parse(
          await drive({
            wcId: contents.id,
            x: g.x,
            top: g.top,
            span: g.span,
            path,
            innerWidth: win.innerWidth,
            now: performance.timeOrigin + performance.now(),
            crop,
          }),
        );
      } finally {
        running = false;
        box.removeEventListener("scroll", cells);
      }
      const { shots } = run;
      const starts = run.sends.filter((s) => s[2] === 3).map((s) => s[0]);
      const sends = run.sends.filter((s) => s[2] !== 3);
      const down = sends.find((s) => s[2] === 1)!;
      const up = sends.find((s) => s[2] === 2)!;
      const moves = sends.filter((s) => s[2] === 0).map((s) => s[0]);
      const moving = (t: number) => moves.some((m) => m <= t && t - m < 50);
      const pointerAt = (t: number) => {
        let y = sends[0]![1];
        for (const s of sends) {
          if (s[0] > t) break;
          y = s[1];
        }
        return y / zoom;
      };
      const offset = ([t, top, length]: readonly number[]) => {
        const max = length! - box.clientHeight;
        return (
          (top! / max) * (g.track - thumb) - (pointerAt(t!) - down[1] / zoom)
        );
      };
      const during = samples.filter(([t]) => t >= down[0] && t <= up[0]);
      const lengthChanges = { moving: 0, resting: 0 };
      for (let i = 1; i < during.length; i++)
        if (during[i]![2] !== during[i - 1]![2])
          lengthChanges[moving(during[i]![0]) ? "moving" : "resting"]++;
      const holds: number[] = [];
      const EMPTY = 0.9;
      const legs: DragRecord["legs"][number][] = [];
      let at = 0;
      for (const [leg, [to]] of path.entries()) {
        const start = starts[leg]!;
        const end = starts[leg + 1] ?? up[0];
        const frames = during.filter(([t]) => t >= start && t < end);
        const mounted = frames.map((s) => s[3]);
        const screens = shots.filter(([t]) => t >= start && t < end);
        legs.push({
          to,
          fewest: Math.min(...mounted),
          most: Math.max(...mounted),
          frames: screens.length,
          empty: screens.filter(([, blank]) => blank >= EMPTY).length,
          rows: screens.filter(([, , rows]) => rows === 1).length,
        });
        if (to === at) {
          const last = during.filter(([t]) => t <= end - 20).at(-1);
          if (last) holds.push(Math.round(offset(last) * 10) / 10);
        }
        at = to;
      }
      const movingOffsets = during
        .filter(([t]) => moving(t))
        .map((s) => Math.abs(offset(s)));
      const shown = shots.filter(([t]) => t >= starts[0]! && t <= up[0]);
      box.scrollTop = 0;
      const drawn = () =>
        box.querySelector("[data-index]")?.getAttribute("data-index") === "0"
          ? [...box.querySelectorAll<HTMLElement>("[data-index]")]
              .map((el) => el.getBoundingClientRect().height)
              .join(" ")
          : null;
      for (let still = 0, last = drawn(), tries = 0; still < 3; tries++) {
        if (tries > 120) throw new Error("The rows at the top never held");
        await frame();
        const now = drawn();
        still = now !== null && now === last ? still + 1 : 0;
        last = now;
      }
      const row = Number.parseFloat(
        getComputedStyle(box).getPropertyValue("--zt-virtual-row"),
      );
      const heights = [
        ...box.querySelectorAll<HTMLElement>("[data-index]"),
      ].map((el) => el.getBoundingClientRect().height);
      return JSON.stringify({
        box: { length: box.scrollHeight, height: box.clientHeight },
        thumb: Math.round(thumb * 10) / 10,
        holds,
        moving: Math.round(Math.max(0, ...movingOffsets) * 10) / 10,
        lengthChanges,
        legs,
        screen: {
          frames: shown.length,
          empty: shown.filter(([, blank]) => blank >= EMPTY).length,
          rows: shown.filter(([, , rows]) => rows === 1).length,
          blankShare:
            Math.round(Math.max(0, ...shown.map(([, blank]) => blank)) * 100) /
            100,
        },
        header: [...header],
        rows: {
          mounted: heights.length,
          unlike: heights.filter((h) => Math.abs(h - row) >= 1).length,
        },
      } satisfies DragRecord);
    },
    { host, boxes: BOXES, path },
    { timeoutMs: 60_000 },
  );
  return JSON.parse(json) as DragRecord;
}
