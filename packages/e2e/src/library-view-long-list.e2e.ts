import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { MarkdownView } from "obsidian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LibraryView } from "@zotlit/library-view/desktop/library/view.ts";
import {
  buildFixture,
  discardFixture,
  getFixtureLayout,
  LIBRARY_SCOPE_SETTING_KEY,
} from "@zotlit/scripts/fixture";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import { prepareRunWindow } from "./background-throttling.ts";
import { revealQueryView } from "./note-query-view.ts";
import { cli, obRun, obRunUntil } from "./obsidian-cli.ts";
import type { QueryViewElement } from "./page-helpers.ts";
import type { QueryPrintModal } from "./page-query-types.ts";
import { registerRunVaultGuard } from "./run-vault-guard.ts";
import type { DragHost } from "./scroll-drag.ts";
import { dragScrollBar } from "./scroll-drag.ts";
import { expectEditorSide, openEditorAt } from "./vault-editor-side.ts";
import {
  clearVault,
  e2eVaultDir,
  isObsidianReachable,
  vaultScript,
} from "./vault-script.ts";

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const fixture = getFixtureLayout(
  join(workspaceRoot, ".scratch", "e2e-long-list-fixture"),
);
const vaultPath = e2eVaultDir(workspaceRoot, "long-list-vault");
const pluginBundleDir = join(workspaceRoot, "apps", "obsidian", "dist-dev");
const runVaultScript = vaultScript(workspaceRoot, fixture.root);
const reachable = await isObsidianReachable(workspaceRoot);
const STRESS_ITEMS = 4000;
const LISTED = 260;

describe.skipIf(!reachable)("Library View long lists", () => {
  let vaultId = "";
  registerRunVaultGuard(() => vaultId, { leftovers: false });

  beforeAll(async () => {
    await clearVault(runVaultScript, vaultPath);
    await mkdir(join(vaultPath, ".obsidian", "plugins", "zotlit"), {
      recursive: true,
    });
    await cp(
      pluginBundleDir,
      join(vaultPath, ".obsidian", "plugins", "zotlit"),
      {
        recursive: true,
      },
    );
    const created = await runVaultScript([
      "create",
      vaultPath,
      "--plugins=zotlit",
    ]);
    vaultId = created.stdout.trim().split("\n")[0]!.trim();
    await prepareRunWindow(vaultId);
    await cli([`vault=${vaultId}`, "plugin:disable", "id=zotlit"]);
    await buildFixture(fixture, {
      stressItemCount: STRESS_ITEMS,
      plugins: [{ id: "zotlit", bundleDir: pluginBundleDir }],
      linkedAttachmentVaultDir: vaultPath,
    });
    await cli([`vault=${vaultId}`, "plugin:enable", "id=zotlit"]);
    await obRunUntil(
      vaultId,
      async ({ zotlit }, { scopeKey }) => {
        const { settings, bridge } = zotlit.services;
        bridge.runSync(
          settings.update({
            "library.document": {
              node: { kind: "library", library: { type: "personal" } },
              facets: [],
              search: "",
              sort: [{ property: "title", direction: "ASC" }],
              cardClosed: true,
            },
            [scopeKey]: { mode: "all" },
          }),
        );
        await bridge.runPromise(settings.flush);
        return true;
      },
      { scopeKey: LIBRARY_SCOPE_SETTING_KEY },
      { what: "the Library View settings" },
    );
  }, 600_000);

  afterAll(async () => {
    await runVaultScript(["remove", vaultPath, "--purge"]);
    await discardFixture(fixture);
  }, 120_000);

  async function openLibrary(layout: "papers" | "table"): Promise<number> {
    return await obRunUntil(
      vaultId,
      async ({ app }, { layout }) => {
        let leaf = app.workspace.getLeavesOfType("zotlit-library")[0];
        if (!leaf) {
          app.commands.executeCommandById("zotlit:open-library-view");
          return 0;
        }
        app.workspace.setActiveLeaf(leaf, { focus: true });
        await app.workspace.revealLeaf(leaf);
        const view = leaf.view as LibraryView;
        const state = view.query.state.getState();
        if (!state.view || !state.file) return 0;
        if (state.view.type !== layout) {
          view.query.document.setViewLayout(
            state.file.views.indexOf(state.view),
            layout,
          );
          return 0;
        }
        const shown = view.contentEl.querySelectorAll("[data-query-item-row]");
        return shown.length > 0 ? (state.results?.rows.length ?? 0) : 0;
      },
      { layout },
      { what: `the Library View in ${layout}`, ready: (n) => n > LISTED },
    );
  }

  const BOX = '[data-query-layout="papers"], .zt-table-scroller';

  const OVERSCAN = 8;

  const mountBound = ({ box, row }: { box: number; row: number }) =>
    Math.ceil(box / row) + 1 + 2 * OVERSCAN + 3;

  function closeLibrary(cleanup: AsyncDisposableStack) {
    cleanup.defer(() =>
      obRun(vaultId, ({ app }) => {
        for (const leaf of app.workspace.getLeavesOfType("zotlit-library"))
          leaf.detach();
      }),
    );
  }

  async function dragToEnd(rowSelector: string) {
    await obRunUntil(
      vaultId,
      async ({ app }, { box, rowSelector }) => {
        const view = app.workspace.getLeavesOfType("zotlit-library")[0]!
          .view as LibraryView;
        const list = view.contentEl.querySelector<HTMLElement>(box)!;
        list.scrollTop = 0;
        const read = () =>
          [
            list.scrollHeight,
            list.querySelectorAll(rowSelector).length,
            ...[...list.querySelectorAll("th[data-query-column]")].map((th) =>
              Math.round(th.getBoundingClientRect().width),
            ),
          ].join(" ");
        const before = read();
        for (let still = 0; still < 5; still++) {
          await new Promise((resolve) =>
            list.win.requestAnimationFrame(resolve),
          );
          if (read() !== before) return false;
        }
        return true;
      },
      { box: BOX, rowSelector },
      { what: "the list's height, rows and columns before the drag" },
    );
    return await obRun(
      vaultId,
      async ({ app }, { rowSelector, box }) => {
        const view = app.workspace.getLeavesOfType("zotlit-library")[0]!
          .view as LibraryView;
        const list = view.contentEl.querySelector<HTMLElement>(box)!;
        const heights = new Set<number>();
        const columns = new Set<string>();
        let mounted = 0;
        let row = Infinity;
        let off = 0;
        const end = list.scrollHeight - list.clientHeight;
        for (let at = 0; at <= end; at += 200) {
          list.scrollTop = at;
          await new Promise((resolve) =>
            list.win.requestAnimationFrame(resolve),
          );
          heights.add(list.scrollHeight);
          columns.add(
            [...list.querySelectorAll("th[data-query-column]")]
              .map((th) => Math.round(th.getBoundingClientRect().width))
              .join(" "),
          );
          mounted = Math.max(
            mounted,
            list.querySelectorAll(rowSelector).length,
          );
          for (const entry of list.querySelectorAll("[data-index]"))
            row = Math.min(row, entry.getBoundingClientRect().height);
          const max = list.scrollHeight - list.clientHeight;
          if (at <= max && Math.abs(list.scrollTop - at) > 1) off++;
        }
        list.scrollTop = list.scrollHeight;
        return {
          mounted,
          box: list.clientHeight,
          row,
          heightMoved: Math.max(...heights) - Math.min(...heights),
          off,
          columnWidths: [...columns],
        };
      },
      { rowSelector, box: BOX },
      { timeoutMs: 120_000 },
    );
  }

  async function shownWhole(key: string, what: string) {
    return await obRunUntil(
      vaultId,
      ({ app }, { key, box }) => {
        const view = app.workspace.getLeavesOfType("zotlit-library")[0]!
          .view as LibraryView;
        const row = view.contentEl.querySelector<HTMLElement>(
          `[data-query-item-row="${key}"]`,
        );
        const list = row?.closest<HTMLElement>(box);
        if (!row || !list)
          return { selected: false, inView: false, focused: false };
        const rowBounds = row.getBoundingClientRect();
        const listBounds = list.getBoundingClientRect();
        return {
          selected: view.selected.key === key,
          inView:
            rowBounds.top >= listBounds.top - 1 &&
            rowBounds.bottom <= listBounds.bottom + 1,
          focused: row.doc.activeElement === row,
        };
      },
      { key, box: BOX },
      {
        what,
        ready: ({ selected, inView, focused }) => selected && inView && focused,
      },
    );
  }

  async function listedKeys() {
    return await obRun(vaultId, ({ app }) =>
      (
        app.workspace.getLeavesOfType("zotlit-library")[0]!.view as LibraryView
      ).query.state
        .getState()
        .results!.rows.map((row) => row.indexedKey),
    );
  }

  async function revealThenStep() {
    const keys = await listedKeys();
    const [far, next] = [keys[250]!, keys[251]!];
    expect(
      await obRun(
        vaultId,
        ({ app }, { far }) =>
          (
            app.workspace.getLeavesOfType("zotlit-library")[0]!
              .view as LibraryView
          ).reveal(far),
        { far },
      ),
    ).toBe("listed");
    await shownWhole(far, "the far paper Show in Library selected");
    await obRun(
      vaultId,
      ({ app }, { box }) => {
        const view = app.workspace.getLeavesOfType("zotlit-library")[0]!
          .view as LibraryView;
        view.contentEl.querySelector<HTMLElement>(box)!.scrollTop = 0;
      },
      { box: BOX },
    );
    await obRunUntil(
      vaultId,
      ({ app }, { far, box }) => {
        const view = app.workspace.getLeavesOfType("zotlit-library")[0]!
          .view as LibraryView;
        const list = view.contentEl.querySelector<HTMLElement>(box)!;
        const first = list.querySelector("[data-index]");
        return (
          list.scrollTop === 0 &&
          first?.getAttribute("data-index") === "0" &&
          list.querySelector(`[data-query-item-row="${far}"]`) !== null
        );
      },
      { far, box: BOX },
      { what: "the selected paper mounted with the list at its top" },
    );
    await obRun(
      vaultId,
      ({ app }, { far }) => {
        const view = app.workspace.getLeavesOfType("zotlit-library")[0]!
          .view as LibraryView;
        view.contentEl
          .querySelector<HTMLElement>(`[data-query-item-row="${far}"]`)!
          .dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "ArrowDown",
              code: "ArrowDown",
              bubbles: true,
            }),
          );
      },
      { far },
    );
    await shownWhole(next, "the paper ↓ selected after the far one");
  }

  it("mounts only the Papers rows near the screen, and the list's height holds as the scroll bar is dragged to the last paper", async () => {
    await using cleanup = new AsyncDisposableStack();
    closeLibrary(cleanup);
    const listed = await openLibrary("papers");
    expect(listed).toBeGreaterThan(LISTED);
    const drag = await dragToEnd("[data-query-papers-row]");
    expect(drag.mounted).toBeLessThanOrEqual(mountBound(drag));
    expect(drag.heightMoved).toBe(0);
    expect(drag.off).toBe(0);
    const keys = await listedKeys();
    await obRunUntil(
      vaultId,
      ({ app }, { last, box }) => {
        const view = app.workspace.getLeavesOfType("zotlit-library")[0]!
          .view as LibraryView;
        const row = view.contentEl.querySelector<HTMLElement>(
          `[data-query-item-row="${last}"]`,
        );
        const list = view.contentEl.querySelector<HTMLElement>(box)!;
        return (
          row !== null &&
          row.getBoundingClientRect().bottom <=
            list.getBoundingClientRect().bottom + 1
        );
      },
      { last: keys.at(-1)!, box: BOX },
      { what: "the last paper at the end of the drag" },
    );
  }, 180_000);

  it("draws a bar on a long Papers list's box for each row, under the rows and the spacers", async () => {
    await using cleanup = new AsyncDisposableStack();
    closeLibrary(cleanup);
    await openLibrary("papers");
    const drawn = await obRun(
      vaultId,
      async ({ app }, { box }) => {
        const view = app.workspace.getLeavesOfType("zotlit-library")[0]!
          .view as LibraryView;
        const list = view.contentEl.querySelector<HTMLElement>(box)!;
        list.scrollTop = 0;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        for (let step = 0; step < 30; step++) {
          list.scrollTop += 100;
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        const rows = list.querySelectorAll<HTMLElement>(
          "[data-query-papers-row]",
        );
        const spacer = list.querySelector<HTMLElement>("[data-query-spacer]");
        return {
          bars: getComputedStyle(list).backgroundImage,
          spacer: spacer ? getComputedStyle(spacer).backgroundImage : null,
          row: getComputedStyle(rows[0]!).backgroundColor,
        };
      },
      { box: BOX },
    );
    expect(drawn.bars).toContain("linear-gradient");
    expect(drawn.spacer).toBe("none");
    expect(drawn.row).toMatch(/^rgb\(/);
  }, 120_000);

  const LARGER_SIZES = {
    "--font-ui-small": "16px",
    "--font-ui-smaller": "14px",
    "--icon-s": "20px",
    "--icon-xs": "20px",
  };

  it.each(
    (["papers", "table"] as const).flatMap((layout) =>
      (["Obsidian's", "a larger theme's"] as const).map(
        (sizes) => [layout, sizes] as const,
      ),
    ),
  )(
    "draws a long %s list's row outlines where its rows draw their parts, at %s sizes",
    async (layout, sizes) => {
      await using cleanup = new AsyncDisposableStack();
      if (sizes === "a larger theme's") {
        await obRun(
          vaultId,
          (_, { vars }) => {
            for (const [name, value] of Object.entries(vars))
              document.body.style.setProperty(name, value);
          },
          { vars: LARGER_SIZES },
        );
        cleanup.defer(() =>
          obRun(
            vaultId,
            (_, { names }) => {
              for (const name of names)
                document.body.style.removeProperty(name);
            },
            { names: Object.keys(LARGER_SIZES) },
          ),
        );
      }
      closeLibrary(cleanup);
      await openLibrary(layout);
      const parts = await obRunUntil(
        vaultId,
        async ({ app }, { box, layout }) => {
          const remote =
            require("@electron/remote") as typeof import("@electron/remote");
          const view = app.workspace.getLeavesOfType("zotlit-library")[0]!
            .view as LibraryView;
          const list = view.contentEl.querySelector<HTMLElement>(box);
          if (!list) return null;
          list.scrollTop = 0;
          const style = getComputedStyle(list);
          const row = Number.parseFloat(
            style.getPropertyValue("--zt-virtual-row"),
          );
          const bounds = list.getBoundingClientRect();
          const origin =
            bounds.top +
            list.clientTop +
            Number.parseFloat(style.paddingTop) +
            (Number.parseFloat(
              list.style.getPropertyValue("--zt-table-header-height"),
            ) || 0);
          const entries = [
            ...list.querySelectorAll<HTMLElement>("[data-index]"),
          ];
          const entry = entries.find((el) => {
            const r = el.getBoundingClientRect();
            const off = (((r.top - origin) % row) + row) % row;
            return (
              Math.abs(r.height - row) < 0.5 &&
              (off < 0.5 || off > row - 0.5) &&
              r.bottom < bounds.bottom &&
              (layout === "table" ||
                el.querySelector("[data-query-papers-meta]") !== null)
            );
          });
          if (!entry) return null;
          const rect = (el: Element) => {
            const r = el.getBoundingClientRect();
            return {
              left: r.left,
              top: r.top,
              right: r.right,
              bottom: r.bottom,
            };
          };
          const at = rect(entry);
          const frame = () =>
            new Promise((resolve) => requestAnimationFrame(resolve));
          for (const el of entries) el.style.visibility = "hidden";
          const contents = remote.getCurrentWebContents();
          const zoom = contents.getZoomFactor();
          const image = await (async () => {
            try {
              await frame();
              await frame();
              return await contents.capturePage({
                x: Math.round(bounds.left * zoom),
                y: Math.round(at.top * zoom),
                width: Math.round((bounds.right - bounds.left) * zoom),
                height: Math.round((at.bottom - at.top + 2) * zoom),
              });
            } finally {
              for (const el of entries) el.style.visibility = "";
            }
          })();
          const size = image.getSize();
          const bmp = image.toBitmap();
          const k = Math.sqrt(bmp.length / 4 / (size.width * size.height));
          const W = Math.round(size.width * k);
          const H = Math.round(size.height * k);
          const scale = W / (bounds.right - bounds.left);
          const lum = (x: number, y: number) => {
            const i = (y * W + x) * 4;
            return (bmp[i]! + bmp[i + 1]! * 2 + bmp[i + 2]!) >> 2;
          };
          const hist = new Uint32Array(256);
          for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++) hist[lum(x, y)]!++;
          let bg = 0;
          for (let i = 1; i < 256; i++) if (hist[i]! > hist[bg]!) bg = i;
          const ink = ({
            left,
            right,
            top,
            bottom,
          }: {
            left: number;
            right: number;
            top: number;
            bottom: number;
          }) => {
            const x0 = Math.max(0, Math.round((left - bounds.left) * scale));
            const x1 = Math.min(W, Math.round((right - bounds.left) * scale));
            const y0 = Math.max(0, Math.round((top - at.top) * scale));
            const y1 = Math.min(H, Math.round((bottom - at.top) * scale));
            let found = null as null | {
              left: number;
              top: number;
              right: number;
              bottom: number;
            };
            for (let y = y0; y < y1; y++)
              for (let x = x0; x < x1; x++) {
                if (Math.abs(lum(x, y) - bg) < 8) continue;
                found ??= { left: x, top: y, right: x + 1, bottom: y + 1 };
                found.left = Math.min(found.left, x);
                found.top = Math.min(found.top, y);
                found.right = Math.max(found.right, x + 1);
                found.bottom = Math.max(found.bottom, y + 1);
              }
            return (
              found && {
                left: found.left / scale + bounds.left,
                top: found.top / scale + at.top,
                right: found.right / scale + bounds.left,
                bottom: found.bottom / scale + at.top,
              }
            );
          };
          const middle = (r: { top: number; bottom: number }) =>
            (r.top + r.bottom) / 2;
          const end = bounds.left + list.clientLeft + list.clientWidth;
          const line = ink({
            left: end - 40,
            right: end - 20,
            top: at.bottom - 6,
            bottom: at.bottom,
          });
          const border = Number.parseFloat(
            getComputedStyle(entry).borderBottomWidth,
          );
          const under = line && {
            outline: { top: line.top },
            row: { top: at.bottom - border },
          };
          if (layout === "table") {
            const gutter = rect(list.querySelector("thead th")!);
            const cell = entry.querySelector("td:nth-child(2)")!;
            const padding = Number.parseFloat(
              getComputedStyle(cell).paddingLeft,
            );
            const bar = ink({
              left: gutter.right - 2,
              right: gutter.right + 60,
              top: at.top + 2,
              bottom: at.bottom - 3,
            });
            return {
              row,
              gutter: gutter.right,
              parts: {
                bar: bar && {
                  outline: { left: bar.left, middle: middle(bar) },
                  row: { left: rect(cell).left + padding, middle: middle(at) },
                },
                line: under,
              },
            };
          }
          const icon = entry.querySelector("[data-query-papers-icon]")!;
          const shape = rect(icon.querySelector("svg") ?? icon);
          const title = rect(entry.querySelector("[data-query-papers-title]")!);
          const meta = rect(entry.querySelector("[data-query-papers-meta]")!);
          const iconInk = ink({
            left: shape.left - 3,
            right: shape.right + 2,
            top: at.top + 2,
            bottom: at.bottom - 3,
          });
          const titleInk = ink({
            left: title.left - 3,
            right: title.left + 40,
            top: at.top + 2,
            bottom: title.bottom,
          });
          const metaInk = ink({
            left: meta.left - 3,
            right: meta.left + 40,
            top: meta.top,
            bottom: at.bottom - 3,
          });
          return {
            row,
            gutter: null,
            parts: {
              icon: iconInk && { outline: iconInk, row: shape },
              title: titleInk && {
                outline: { left: titleInk.left, middle: middle(titleInk) },
                row: { left: title.left, middle: middle(title) },
              },
              meta: metaInk && {
                outline: { left: metaInk.left, middle: middle(metaInk) },
                row: { left: meta.left, middle: middle(meta) },
              },
              line: under,
            },
          };
        },
        { box: BOX, layout },
        {
          what: `a ${layout} row at an outline's top, and its outline`,
          ready: (parts) => parts !== null,
        },
      );
      console.log(`outlines ${layout} ${sizes}: ${JSON.stringify(parts)}`);
      type Pair = {
        outline: Record<string, number>;
        row: Record<string, number>;
      } | null;
      const near = Object.fromEntries(
        Object.entries<Pair | undefined>(parts!.parts).map(([part, pair]) => [
          part,
          pair != null &&
            Object.entries(pair.outline).every(
              ([key, value]) => Math.abs(value - pair.row[key]!) <= 1,
            ),
        ]),
      );
      expect(near).toEqual(
        layout === "table"
          ? { bar: true, line: true }
          : { icon: true, title: true, meta: true, line: true },
      );
    },
    120_000,
  );

  it("brings a far paper into view from Show in Library, and ↓ steps on from it after the Papers list scrolled away", async () => {
    await using cleanup = new AsyncDisposableStack();
    closeLibrary(cleanup);
    await openLibrary("papers");
    await revealThenStep();
  }, 120_000);

  it("mounts only the Table rows near the screen, and brings a far paper into view from Show in Library", async () => {
    await using cleanup = new AsyncDisposableStack();
    closeLibrary(cleanup);
    await openLibrary("table");
    const drag = await dragToEnd('tr[data-query-table-row="item"]');
    expect(drag.mounted).toBeLessThanOrEqual(mountBound(drag));
    expect(drag.heightMoved).toBe(0);
    expect(drag.off).toBe(0);
    expect(drag.columnWidths).toHaveLength(1);
    const [first, ...later] = drag.columnWidths[0]!.split(" ").map(Number);
    expect(first).toBe(300);
    expect(new Set(later)).toEqual(new Set([150]));
    const wide = await obRun(
      vaultId,
      async ({ app }, { box }) => {
        const view = app.workspace.getLeavesOfType("zotlit-library")[0]!
          .view as LibraryView;
        const list = view.contentEl.querySelector<HTMLElement>(box)!;
        const widths = () =>
          [...list.querySelectorAll("th[data-query-column]")]
            .map((th) => Math.round(th.getBoundingClientRect().width))
            .join(" ");
        const { width, flex } = list.style;
        try {
          list.style.flex = "none";
          list.style.width = `${list.scrollWidth + 600}px`;
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const table = list.querySelector("table")!;
          return {
            widths: widths(),
            fills: Math.abs(table.offsetWidth - list.clientWidth) <= 1,
          };
        } finally {
          Object.assign(list.style, { width, flex });
        }
      },
      { box: BOX },
    );
    expect(wide).toEqual({ widths: drag.columnWidths[0], fills: true });
    await revealThenStep();
  }, 180_000);

  it("draws the Table's scroll bar beside its header, so a press on the bar never reaches a column", async () => {
    await using cleanup = new AsyncDisposableStack();
    closeLibrary(cleanup);
    await openLibrary("table");
    const pressed = await obRunUntil(
      vaultId,
      async ({ app, page }, { box }) => {
        const view = app.workspace.getLeavesOfType("zotlit-library")[0]!
          .view as LibraryView;
        const list = view.contentEl.querySelector<HTMLElement>(box)!;
        const head = list.querySelector("thead")!;
        list.scrollTop = list.scrollHeight / 2;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const bar = list.offsetWidth - list.clientWidth;
        const target = new Promise<EventTarget | null>((resolve) =>
          list.win.addEventListener("pointerdown", (e) => resolve(e.target), {
            capture: true,
            once: true,
          }),
        );
        await page.trusted(list.win).click(list, {
          x: list.offsetWidth - bar / 2,
          y: head.offsetHeight / 2,
        });
        const at = await target;
        return {
          bar,
          onHeader: at instanceof Node && head.contains(at),
          onBox: at === list,
        };
      },
      { box: BOX },
      {
        what: "a press in the Table's scroll bar column at the header",
        ready: (result) => result !== null,
      },
    );
    expect(pressed.bar).toBeGreaterThan(0);
    expect(pressed).toMatchObject({ onHeader: false, onBox: true });
  }, 120_000);

  it("keeps mounting the Papers rows near the screen, and brings a far paper into view, after the Library View moves into a pop-out", async () => {
    await using cleanup = new AsyncDisposableStack();
    closeLibrary(cleanup);
    await openLibrary("papers");
    await obRun(vaultId, ({ app }) => {
      const leaf = app.workspace.getLeavesOfType("zotlit-library")[0]!;
      app.workspace.moveLeafToPopout(leaf);
    });
    await obRunUntil(
      vaultId,
      ({ app }) => {
        const view = app.workspace.getLeavesOfType("zotlit-library")[0]
          ?.view as LibraryView | undefined;
        return (
          view !== undefined &&
          view.contentEl.win !== window &&
          view.contentEl.querySelector("[data-query-papers-row]") !== null
        );
      },
      undefined,
      { what: "the Library View's rows in the pop-out" },
    );
    const drag = await dragToEnd("[data-query-papers-row]");
    expect(drag.mounted).toBeLessThanOrEqual(mountBound(drag));
    expect(drag.heightMoved).toBe(0);
    expect(drag.off).toBe(0);
    await revealThenStep();
  }, 180_000);

  const EMBED_BOX =
    '[data-query-layout="papers"], [data-query-layout="list"], .zt-table-scroller';

  const ROWS = {
    papers: "[data-query-papers-row]",
    table: 'tr[data-query-table-row="item"]',
    list: "[data-query-row]",
  } as const;

  const NOTE_MODES = ["preview", "source"] as const;

  const MODE_ROOT = {
    preview: ".markdown-preview-view",
    source: ".markdown-source-view",
  } as const;

  it.each(
    (["papers", "table", "list"] as const).flatMap((layout) =>
      NOTE_MODES.map((mode) => [layout, mode] as const),
    ),
  )(
    "caps a long %s embed's height in %s, holds its length as it scrolls, mounts the rows near the screen, and Export to PDF prints every row",
    async (layout, mode) => {
      const queryPath = `Long ${layout}.zotquery`;
      const notePath = `Long ${layout}.md`;
      const pdfPath = join(fixture.root, `long-${layout}-${mode}.pdf`);
      await using cleanup = new AsyncDisposableStack();
      cleanup.defer(() =>
        obRun(
          vaultId,
          async ({ app }, { queryPath, notePath }) => {
            for (const leaf of app.workspace.getLeavesOfType("markdown"))
              if ((leaf.view as MarkdownView).file?.path === notePath)
                leaf.detach();
            for (const path of [notePath, queryPath]) {
              const file = app.vault.getFileByPath(path);
              if (file) await app.vault.delete(file);
            }
          },
          { queryPath, notePath },
        ),
      );
      await obRun(
        vaultId,
        async ({ app }, { layout, queryPath, notePath, mode }) => {
          await app.vault.create(
            queryPath,
            [
              "views:",
              `  - type: ${layout}`,
              "    name: All",
              "    from: items",
              '    filters: library == "personal"',
              "",
            ].join("\n"),
          );
          await app.vault.create(
            notePath,
            ["# Long list", "", `![[${queryPath}]]`, "", "The end.", ""].join(
              "\n",
            ),
          );
          const leaf = app.workspace.getLeaf("tab");
          await leaf.openFile(app.vault.getFileByPath(notePath)!, {
            state: { mode },
          });
          app.workspace.setActiveLeaf(leaf, { focus: true });
        },
        { layout, queryPath, notePath, mode },
      );
      const view = await revealQueryView(vaultId, notePath, {
        embed: queryPath,
      });
      const lengths = await obRun(
        vaultId,
        async ({ page }, { view, box }) => {
          const el = await page.revealQueryView(view);
          const list = el.querySelector<HTMLElement>(box)!;
          list.scrollTop = 0;
          for (let still = 0, last = -1, tries = 0; still < 5; tries++) {
            if (tries > 120) throw new Error("The embed's length never held");
            await new Promise((resolve) => requestAnimationFrame(resolve));
            still = list.scrollHeight === last ? still + 1 : 0;
            last = list.scrollHeight;
          }
          const seen = new Set<number>();
          for (let step = 0; step < 60; step++) {
            list.scrollTop += list.clientHeight;
            await new Promise((resolve) => requestAnimationFrame(resolve));
            seen.add(list.scrollHeight);
          }
          list.scrollTop = 0;
          return [...seen];
        },
        { view, box: EMBED_BOX },
        { timeoutMs: 60_000 },
      );
      expect(Math.max(...lengths) - Math.min(...lengths)).toBe(0);
      const capped = await obRunUntil(
        vaultId,
        async ({ page }, { view, box }) => {
          const el = await page.revealQueryView(view);
          const list = el.querySelector<HTMLElement>(box);
          if (!list) return null;
          list.scrollTop = 5000;
          return {
            height: el.getBoundingClientRect().height,
            scrolls: list.scrollHeight > list.clientHeight,
            scrolled: list.scrollTop,
          };
        },
        { view, box: EMBED_BOX },
        {
          what: "the embed scrolled 5,000 px down its own box",
          ready: (state) => state !== null && state.scrolled === 5000,
        },
      );
      expect(capped!.height).toBeLessThanOrEqual(501);
      expect(capped!.scrolls).toBe(true);
      const scrolled = await obRunUntil(
        vaultId,
        ({ app }, { notePath, rowSelector, box, root }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find((l) => (l.view as MarkdownView).file?.path === notePath)!;
          const scroller =
            leaf.view.containerEl.querySelector<HTMLElement>(root)!;
          const host =
            scroller.querySelector<QueryViewElement>(".zt-query-view");
          const bounds = host
            ?.querySelector<HTMLElement>(box)
            ?.getBoundingClientRect();
          const rows = [
            ...(host?.querySelectorAll<HTMLElement>(rowSelector) ?? []),
          ];
          if (!bounds)
            return { listed: 0, mounted: 0, shown: 0, box: 0, row: 0 };
          const heights = [
            ...(host
              ?.querySelector(box)
              ?.querySelectorAll<HTMLElement>("[data-index]") ?? []),
          ].map((el) => el.getBoundingClientRect().height);
          return {
            listed:
              host?.zotlitQueryView?.state.getState().results?.rows.length ?? 0,
            mounted: rows.length,
            box: bounds.height,
            row: Math.min(...heights),
            shown: rows.filter((row) => {
              const rowBounds = row.getBoundingClientRect();
              return (
                rowBounds.bottom > bounds.top && rowBounds.top < bounds.bottom
              );
            }).length,
          };
        },
        {
          notePath,
          rowSelector: ROWS[layout],
          box: EMBED_BOX,
          root: MODE_ROOT[mode],
        },
        {
          ready: ({ shown }) => shown > 0,
          what: `${layout} rows in view 5,000 px into the embed`,
        },
      );
      expect(scrolled.mounted).toBeLessThanOrEqual(mountBound(scrolled));

      const printed = await obRun(
        vaultId,
        async ({ app }, { notePath, pdfPath, rowSelector, box }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find((l) => (l.view as MarkdownView).file?.path === notePath)!;
          const modalProto = Object.getPrototypeOf(
            Object.getPrototypeOf(Object.getPrototypeOf(app.setting)),
          ) as Pick<QueryPrintModal, "open">;
          const open = modalProto.open;
          const capture: { modal: QueryPrintModal | null } = { modal: null };
          modalProto.open = new Proxy(open, {
            apply(target, receiver: QueryPrintModal, args) {
              capture.modal = receiver;
              return Reflect.apply(target, receiver, args);
            },
          });
          try {
            (leaf.view as unknown as { printToPdf(): void }).printToPdf();
          } finally {
            modalProto.open = open;
          }
          const modal = capture.modal!;
          modal.close();
          let rows = -1;
          let clipped = true;
          const print = modal.print.bind(modal);
          modal.print = async (el, component, includeName) => {
            const out = await print(el, component, includeName);
            rows = el.querySelectorAll(rowSelector).length;
            clipped = [...el.querySelectorAll<HTMLElement>(box)].some(
              (list) => list.scrollHeight > list.clientHeight + 1,
            );
            return out;
          };
          await modal.printToPdf({
            filepath: pdfPath,
            includeName: true,
            pageSize: "A4",
            landscape: false,
            marginsType: 0,
            scaleFactor: 100,
            scale: 1,
            open: false,
          });
          return { rows, clipped };
        },
        { notePath, pdfPath, rowSelector: ROWS[layout], box: EMBED_BOX },
        { timeoutMs: 180_000 },
      );
      expect(scrolled.listed).toBeGreaterThan(LISTED);
      expect(printed).toEqual({ rows: scrolled.listed, clipped: false });
    },
    240_000,
  );

  async function createFiles(
    cleanup: AsyncDisposableStack,
    files: Record<string, string>,
  ) {
    const paths = Object.keys(files);
    cleanup.defer(() =>
      obRun(
        vaultId,
        async ({ app }, { paths }) => {
          for (const leaf of app.workspace.getLeavesOfType("markdown"))
            if (paths.includes((leaf.view as MarkdownView).file?.path ?? ""))
              leaf.detach();
          for (const leaf of app.workspace.getLeavesOfType("zotlit-query-file"))
            if (paths.includes((leaf.view as MarkdownView).file?.path ?? ""))
              leaf.detach();
          for (const path of paths) {
            const file = app.vault.getFileByPath(path);
            if (file) await app.vault.delete(file);
          }
        },
        { paths },
      ),
    );
    await obRun(
      vaultId,
      async ({ app }, { files }) => {
        for (const [path, text] of Object.entries(files))
          await app.vault.create(path, text);
      },
      { files },
    );
  }

  it("keeps the List's height as the scroll bar is dragged while its rows wrap, and after Indent properties makes them taller", async () => {
    const path = "Long indent.zotquery";
    const view = (indent: boolean) =>
      [
        "formulas:",
        '  long: \'if(date.year % 3 == 0, title + " " + title + " " + title, title)\'',
        "views:",
        "  - type: list",
        "    name: All",
        "    from: items",
        '    filters: library == "personal"',
        "    order:",
        "      - formula.long",
        "      - date",
        "      - itemType",
        ...(indent ? ["    indentProperties: true"] : []),
        "",
      ].join("\n");
    await using cleanup = new AsyncDisposableStack();
    await createFiles(cleanup, { [path]: view(false) });
    await obRun(
      vaultId,
      async ({ app }, { path }) => {
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(app.vault.getFileByPath(path)!);
        app.workspace.setActiveLeaf(leaf, { focus: true });
      },
      { path },
    );
    const drawn = (indent: boolean) =>
      obRunUntil(
        vaultId,
        ({ app }, { path, indent }) => {
          const leaf = app.workspace
            .getLeavesOfType("zotlit-query-file")
            .find((l) => (l.view as MarkdownView).file?.path === path);
          const row = leaf?.view.containerEl.querySelector(
            '[data-query-layout="list"] li[data-query-row]',
          );
          const indented = [...(row?.children ?? [])].some((child) =>
            child.className.includes("zt:block"),
          );
          return row != null && indented === indent;
        },
        { path, indent },
        {
          what: `the List drawn with Indent properties ${indent ? "on" : "off"}`,
        },
      );
    const drag = (width?: number) =>
      obRun(
        vaultId,
        async ({ app }, { path, width }) => {
          const leaf = app.workspace
            .getLeavesOfType("zotlit-query-file")
            .find((l) => (l.view as MarkdownView).file?.path === path)!;
          const list = leaf.view.containerEl.querySelector<HTMLElement>(
            '[data-query-layout="list"]',
          )!;
          const style = { width: list.style.width, flex: list.style.flex };
          if (width !== undefined)
            Object.assign(list.style, { width: `${width}px`, flex: "none" });
          try {
            list.scrollTop = 0;
            for (let still = 0, last = -1, tries = 0; still < 5; tries++) {
              if (tries > 120) throw new Error("The List's height never held");
              await new Promise((resolve) => requestAnimationFrame(resolve));
              still = list.scrollHeight === last ? still + 1 : 0;
              last = list.scrollHeight;
            }
            const start = list.scrollHeight;
            const heights = new Set<number>();
            let mounted = 0;
            let row = Infinity;
            const end = list.scrollHeight - list.clientHeight;
            for (let at = 0; at <= end; at += 200) {
              list.scrollTop = at;
              await new Promise((resolve) => requestAnimationFrame(resolve));
              heights.add(list.scrollHeight);
              mounted = Math.max(
                mounted,
                list.querySelectorAll("li[data-query-row]").length,
              );
              for (const entry of list.querySelectorAll("[data-index]"))
                row = Math.min(row, entry.getBoundingClientRect().height);
            }
            return {
              start,
              mounted,
              box: list.clientHeight,
              row,
              heightMoved: Math.max(...heights) - Math.min(...heights),
            };
          } finally {
            Object.assign(list.style, style);
          }
        },
        { path, width },
        { timeoutMs: 120_000 },
      );
    await drawn(false);
    const inline = await drag();
    const wrapped = await drag(180);
    expect(wrapped.start).toBeGreaterThan(inline.start * 1.5);
    expect(wrapped.heightMoved).toBe(0);
    await obRun(
      vaultId,
      async ({ app }, { path, text }) => {
        await app.vault.modify(app.vault.getFileByPath(path)!, text);
      },
      { path, text: view(true) },
    );
    await drawn(true);
    const indented = await drag();
    expect(inline.mounted).toBeLessThanOrEqual(mountBound(inline));
    expect(indented.mounted).toBeLessThanOrEqual(mountBound(indented));
    expect(indented.start).toBeGreaterThan(inline.start * 1.3);
    expect(indented.heightMoved).toBe(0);
  }, 180_000);

  const wrappingList = (indent: boolean) =>
    [
      "formulas:",
      '  long: \'if(date.year % 3 == 0, title + " " + title + " " + title, title)\'',
      "views:",
      "  - type: list",
      "    name: All",
      "    from: items",
      '    filters: library == "personal"',
      "    order:",
      "      - formula.long",
      "      - date",
      "      - itemType",
      ...(indent ? ["    indentProperties: true"] : []),
      "",
    ].join("\n");

  it("keeps a long List's rows in place as a scroll ends, where rows above the screen drew taller than their text foretold", async () => {
    const path = "Scroll end.zotquery";
    await using cleanup = new AsyncDisposableStack();
    await createFiles(cleanup, { [path]: wrappingList(false) });
    await obRun(
      vaultId,
      async ({ app }, { path }) => {
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(app.vault.getFileByPath(path)!);
        app.workspace.setActiveLeaf(leaf, { focus: true });
      },
      { path },
    );
    const settled = await obRunUntil(
      vaultId,
      async ({ app }, { path }) => {
        const list = app.workspace
          .getLeavesOfType("zotlit-query-file")
          .find((l) => (l.view as MarkdownView).file?.path === path)
          ?.view.containerEl.querySelector<HTMLElement>(
            '[data-query-layout="list"]',
          );
        if (!list || list.scrollHeight < list.clientHeight + 1000) return null;
        const frame = () =>
          new Promise((resolve) => requestAnimationFrame(resolve));
        for (let still = 0, last = -1; still < 5;) {
          await frame();
          if (list.scrollHeight !== last && last !== -1) return null;
          still++;
          last = list.scrollHeight;
        }
        const style = list.doc.createElement("style");
        style.dataset.e2eScrollEnd = "";
        style.textContent =
          '[data-query-layout="list"] li[data-query-row] { letter-spacing: 0.08em; }';
        list.doc.head.append(style);
        try {
          const tops = () => {
            const top = list.getBoundingClientRect().top;
            return new Map(
              [...list.querySelectorAll<HTMLElement>("li[data-index]")].map(
                (el) => [
                  el.dataset.index!,
                  el.getBoundingClientRect().top - top,
                ],
              ),
            );
          };
          list.scrollTop = 0;
          await frame();
          for (let step = 0; step < 30; step++) {
            list.scrollTop += 150;
            await frame();
          }
          const last = tops();
          const length = list.scrollHeight;
          let moved = 0;
          let grew = false;
          for (let frames = 0, after = 0; after < 3 && frames < 240; frames++) {
            await frame();
            for (const [index, top] of tops()) {
              const was = last.get(index);
              if (was !== undefined)
                moved = Math.max(moved, Math.abs(top - was));
            }
            if (list.scrollHeight !== length) grew = true;
            if (grew) after++;
          }
          return { grew, moved: Math.round(moved * 10) / 10 };
        } finally {
          style.remove();
        }
      },
      { path },
      {
        what: "the List scrolled and at rest",
        ready: (result) => result !== null,
      },
    );
    console.log(`scroll end: ${JSON.stringify(settled)}`);
    expect({ grew: settled!.grew, still: settled!.moved <= 1 }).toEqual({
      grew: true,
      still: true,
    });
  }, 120_000);

  it.each(
    (["embed", "Query Block"] as const).flatMap((kind) =>
      NOTE_MODES.map((mode) => [kind, mode] as const),
    ),
  )(
    "runs a long %s in %s only once it shows: not in the hidden mode nor in a folded callout, which holds its room and runs as it unfolds",
    async (kind, mode) => {
      const queryPath = "Long fold.zotquery";
      const notePath = "Long fold.md";
      const file = [
        "views:",
        "  - type: papers",
        "    name: All",
        "    from: items",
        '    filters: library == "personal"',
      ];
      const view =
        kind === "embed"
          ? [`![[${queryPath}]]`]
          : ["```zotquery", ...file, "```"];
      await using cleanup = new AsyncDisposableStack();
      await createFiles(cleanup, {
        [queryPath]: [...file, ""].join("\n"),
        [notePath]: [
          "# Folded",
          "",
          ...view,
          "",
          "> [!note]- Long list",
          ...view.map((line) => `> ${line}`),
          "",
          "The end.",
          "",
        ].join("\n"),
      });
      await obRun(
        vaultId,
        async ({ app }, { notePath, mode }) => {
          const leaf = app.workspace.getLeaf("tab");
          await leaf.openFile(app.vault.getFileByPath(notePath)!, {
            state: { mode },
          });
          app.workspace.setActiveLeaf(leaf, { focus: true });
        },
        { notePath, mode },
      );
      const state = (
        what: string,
        ready: (s: { shown: Embed[]; hidden: Embed[] }) => boolean,
      ) =>
        obRunUntil(
          vaultId,
          ({ app }, { notePath, root }) => {
            const leaf = app.workspace
              .getLeavesOfType("markdown")
              .find((l) => (l.view as MarkdownView).file?.path === notePath)!;
            const scroller =
              leaf.view.containerEl.querySelector<HTMLElement>(root)!;
            const bounds = scroller.getBoundingClientRect();
            const read = (host: QueryViewElement) => {
              const rows = [
                ...host.querySelectorAll<HTMLElement>(
                  "[data-query-papers-row]",
                ),
              ];
              const heights = [
                ...host.querySelectorAll<HTMLElement>("[data-index]"),
              ]
                .map((el) => el.getBoundingClientRect().height)
                .filter((height) => height > 0);
              return {
                phase:
                  host.zotlitQueryView?.state.getState().phase ?? "waiting",
                waiting: host.hasAttribute("data-query-waiting"),
                reserve: getComputedStyle(host).minHeight,
                height: host.getBoundingClientRect().height,
                folded: host.closest(".callout.is-collapsed") !== null,
                listed:
                  host.zotlitQueryView?.state.getState().results?.rows.length ??
                  0,
                mounted: rows.length,
                box:
                  host.querySelector<HTMLElement>(
                    '[data-query-layout="papers"]',
                  )?.clientHeight ?? 0,
                row: heights.length > 0 ? Math.min(...heights) : 0,
                shown: rows.filter((row) => {
                  const rowBounds = row.getBoundingClientRect();
                  return (
                    rowBounds.height > 0 &&
                    rowBounds.bottom > bounds.top &&
                    rowBounds.top < bounds.bottom
                  );
                }).length,
              };
            };
            const hosts = [
              ...leaf.view.containerEl.querySelectorAll<QueryViewElement>(
                ".zt-query-note",
              ),
            ];
            return {
              shown: hosts.filter((h) => scroller.contains(h)).map(read),
              hidden: hosts.filter((h) => !scroller.contains(h)).map(read),
            };
          },
          { notePath, root: MODE_ROOT[mode] },
          { what, ready: (s) => s.shown.length === 2 && ready(s) },
        );
      type Embed = {
        phase: string;
        waiting: boolean;
        reserve: string;
        height: number;
        folded: boolean;
        listed: number;
        mounted: number;
        box: number;
        row: number;
        shown: number;
      };
      const loaded = await state(`the first ${kind}'s rows`, ({ shown }) => {
        const [first] = shown;
        return first!.shown > 0;
      });
      const [top, folded] = loaded.shown;
      expect(top!.listed).toBeGreaterThan(LISTED);
      expect(top).toMatchObject({ waiting: false, reserve: "0px" });
      expect(top!.height).toBeLessThanOrEqual(501);
      expect(folded).toMatchObject({
        folded: true,
        phase: "waiting",
        waiting: true,
        reserve: "500px",
        listed: 0,
      });
      for (const hidden of loaded.hidden)
        expect(hidden).toMatchObject({
          phase: "waiting",
          waiting: true,
          listed: 0,
        });
      await obRun(
        vaultId,
        ({ app }, { notePath, root }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find((l) => (l.view as MarkdownView).file?.path === notePath)!;
          const callout = leaf.view.containerEl.querySelector<HTMLElement>(
            `${root} .callout`,
          )!;
          callout.querySelector<HTMLElement>(".callout-fold")!.click();
          callout.scrollIntoView({ block: "start" });
        },
        { notePath, root: MODE_ROOT[mode] },
      );
      const open = await state(
        `the folded ${kind}'s rows in view once the callout unfolds`,
        ({ shown }) => {
          const [, unfolded] = shown;
          return !unfolded!.folded && unfolded!.shown > 0;
        },
      );
      const [, unfolded] = open.shown;
      expect(unfolded).toMatchObject({
        phase: "ready",
        waiting: false,
        reserve: "0px",
      });
      expect(unfolded!.height).toBeLessThanOrEqual(501);
      expect(unfolded!.listed).toBeGreaterThan(LISTED);
      expect(unfolded!.mounted).toBeLessThanOrEqual(mountBound(unfolded!));
    },
    180_000,
  );

  it.each(NOTE_MODES)(
    "keeps a short Query Block in %s at its height on every frame as the note builds it again",
    async (mode) => {
      const notePath = "Short block.md";
      await using cleanup = new AsyncDisposableStack();
      await createFiles(cleanup, {
        [notePath]: [
          "# Short",
          "",
          "```zotquery",
          "views:",
          "  - type: papers",
          "    name: All",
          "    from: items",
          '    filters: library == "personal"',
          "    limit: 3",
          "```",
          "",
          "The end.",
          "",
        ].join("\n"),
      });
      await obRun(
        vaultId,
        async ({ app }, { notePath, mode }) => {
          const leaf = app.workspace.getLeaf("tab");
          await leaf.openFile(app.vault.getFileByPath(notePath)!, {
            state: { mode },
          });
          app.workspace.setActiveLeaf(leaf, { focus: true });
        },
        { notePath, mode },
      );
      await obRunUntil(
        vaultId,
        ({ app }, { notePath, root }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find((l) => (l.view as MarkdownView).file?.path === notePath)!;
          const host = leaf.view.containerEl.querySelector<QueryViewElement>(
            `${root} .zt-query-note`,
          );
          return (
            host?.zotlitQueryView?.state.getState().phase === "ready" &&
            host.querySelectorAll("[data-query-papers-row]").length === 3
          );
        },
        { notePath, root: MODE_ROOT[mode] },
        { what: "the block's three rows" },
      );
      const { runs, rebuilt } = await obRun(
        vaultId,
        async ({ app }, { notePath, mode }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find((l) => (l.view as MarkdownView).file?.path === notePath)!;
          const view = leaf.view as MarkdownView;
          const frame = () =>
            new Promise((resolve) => requestAnimationFrame(resolve));
          const shown = () =>
            [
              ...view.containerEl.querySelectorAll<QueryViewElement>(
                ".zt-query-note",
              ),
            ].find((host) => host.isShown());
          const sample = async (frames = 60) => {
            const heights: (number | null)[] = [];
            for (let i = 0; i < frames; i++) {
              const host = shown();
              heights.push(host ? host.getBoundingClientRect().height : null);
              await frame();
            }
            return heights;
          };
          const setMode = (next: "preview" | "source") =>
            leaf.setViewState({
              ...leaf.getViewState(),
              state: { ...leaf.getViewState().state, mode: next },
            });
          const runs: Record<string, (number | null)[]> = {};
          const rebuilt: Record<string, boolean> = {};
          let last = shown();
          const note = (run: string) => {
            rebuilt[run] = shown() !== last;
            last = shown();
          };
          const rebuild = async (pass: string) => {
            if (mode === "source") {
              view.editor.setCursor({ line: 3, ch: 0 });
              for (let i = 0; i < 10; i++) await frame();
              view.editor.setCursor({ line: 11, ch: 0 });
              runs[`cursor${pass}`] = await sample();
              note(`cursor${pass}`);
            } else {
              await setMode("source");
              runs[`source${pass}`] = await sample();
              note(`source${pass}`);
              await setMode("preview");
              runs[`preview${pass}`] = await sample();
              note(`preview${pass}`);
            }
          };
          await rebuild("");
          shown()!.zotlitQueryView!.document.editView({ limit: 2 });
          runs.edit = await sample();
          note("edit");
          await rebuild(" after the edit");
          return { runs, rebuilt };
        },
        { notePath, mode },
        { timeoutMs: 60_000 },
      );
      const passes = mode === "source" ? ["cursor"] : ["source", "preview"];
      expect(rebuilt).toEqual(
        Object.fromEntries([
          ...passes.map((pass) => [pass, true]),
          ["edit", false],
          ...passes.map((pass) => [`${pass} after the edit`, true]),
        ]),
      );
      const near = (a: number | null, b: number) =>
        a !== null && Math.abs(a - b) <= 1;
      const { edit, ...again } = runs;
      for (const [run, heights] of Object.entries(again)) {
        const settled = heights.at(-1)!;
        expect(settled, run).toBeGreaterThan(0);
        expect(
          heights.map((height) => near(height, settled)),
          `${run}: ${JSON.stringify(heights)}`,
        ).not.toContain(false);
      }
      const before = runs[passes.at(-1)!]!.at(-1)!;
      const after = edit!.at(-1)!;
      expect(after).toBeLessThan(before - 1);
      expect(
        edit!.map((height) => near(height, before) || near(height, after)),
        `edit: ${JSON.stringify(edit)}`,
      ).not.toContain(false);
    },
    120_000,
  );

  it.each(NOTE_MODES)(
    "hides the rows a Table embed in a callout in %s scrolls under its header, in the callout's tint",
    async (mode) => {
      const queryPath = "Long callout table.zotquery";
      const notePath = "Long callout table.md";
      await using cleanup = new AsyncDisposableStack();
      await createFiles(cleanup, {
        [queryPath]: [
          "views:",
          "  - type: table",
          "    name: All",
          "    from: items",
          '    filters: library == "personal"',
          "",
        ].join("\n"),
        [notePath]: [
          "# Callout",
          "",
          "> [!note] A table",
          `> ![[${queryPath}]]`,
          "",
        ].join("\n"),
      });
      await obRun(
        vaultId,
        async ({ app }, { notePath, mode }) => {
          const leaf = app.workspace.getLeaf("tab");
          await leaf.openFile(app.vault.getFileByPath(notePath)!, {
            state: { mode },
          });
          app.workspace.setActiveLeaf(leaf, { focus: true });
        },
        { notePath, mode },
      );
      const header = await obRunUntil(
        vaultId,
        ({ app }, { notePath, root }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find((l) => (l.view as MarkdownView).file?.path === notePath)!;
          const table = leaf.view.containerEl.querySelector<HTMLTableElement>(
            `${root} .callout [data-query-table]`,
          );
          const cell = table?.tHead?.rows[0]?.cells[1];
          if (!table || !cell || !table.tBodies.length) return null;
          table.closest<HTMLElement>(".zt-table-scroller")!.scrollTop = 600;
          const style = getComputedStyle(cell);
          return {
            scrolled:
              table.closest<HTMLElement>(".zt-table-scroller")!.scrollTop,
            color: style.backgroundColor,
            tint: style.backgroundImage,
          };
        },
        { notePath, root: MODE_ROOT[mode] },
        {
          what: "the callout's Table scrolled under its header",
          ready: (h) => h !== null && h.scrolled > 0,
        },
      );
      expect(header!.color).toMatch(/^rgb\(/);
      expect(header!.tint).toContain("linear-gradient");
    },
    120_000,
  );

  const NOTE_SCROLLER = {
    preview: ".markdown-preview-view",
    source: ".markdown-source-view .cm-scroller",
  } as const;

  const FAR_BOX = `${EMBED_BOX}, [data-query-layout="cards"]`;
  const FAR_ROWS = { ...ROWS, cards: '[role="listitem"]' } as const;

  it.each(
    (
      [
        ["papers", "long"],
        ["papers", "short"],
        ["table", "long"],
        ["table", "short"],
        ["list", "long"],
        ["list", "short"],
        ["cards", "short"],
      ] as const
    ).flatMap((view) => NOTE_MODES.map((mode) => [...view, mode] as const)),
  )(
    "keeps a %s embed's place, %s, in %s as the note scrolls far away and back",
    async (layout, size, mode) => {
      const queryPath = `Far ${layout} ${size}.zotquery`;
      const notePath = `Far ${layout} ${size}.md`;
      const paragraph = (n: number) =>
        `Paragraph ${n}. The reader scrolls past this text on the way to the end of the note, and back again to the list of papers.`;
      await using cleanup = new AsyncDisposableStack();
      await createFiles(cleanup, {
        [queryPath]: [
          "views:",
          `  - type: ${layout}`,
          "    name: All",
          "    from: items",
          '    filters: library == "personal"',
          ...(layout === "table"
            ? [
                "    order:",
                "      - title",
                "      - date",
                "      - itemType",
                "      - publicationTitle",
                "      - DOI",
                "      - url",
                "      - dateAdded",
                "      - dateModified",
                "      - abstractNote",
              ]
            : []),
          ...(size === "short" ? ["    limit: 40"] : []),
          "",
        ].join("\n"),
        [notePath]: [
          "# Far embed",
          "",
          ...Array.from({ length: 150 }, (_, n) => [paragraph(n), ""]).flat(),
          `![[${queryPath}]]`,
          "",
          ...Array.from({ length: 400 }, (_, n) => [
            paragraph(150 + n),
            "",
          ]).flat(),
          "The end.",
          "",
        ].join("\n"),
      });
      await obRun(
        vaultId,
        async ({ app }, { notePath, mode }) => {
          const leaf = app.workspace.getLeaf("tab");
          await leaf.openFile(app.vault.getFileByPath(notePath)!, {
            state: { mode },
          });
          app.workspace.setActiveLeaf(leaf, { focus: true });
          if (mode === "source")
            (leaf.view as MarkdownView).editor.setCursor({ line: 0, ch: 0 });
        },
        { notePath, mode },
      );
      await revealQueryView(vaultId, notePath, { embed: queryPath });
      const deep = await obRunUntil(
        vaultId,
        async ({ app }, { notePath, root, box, rowSelector }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find((l) => (l.view as MarkdownView).file?.path === notePath)!;
          const list = leaf.view.containerEl
            .querySelector(root)
            ?.querySelector(".zt-query-note")
            ?.querySelector<HTMLElement>(box);
          if (!list) return { top: 0, left: 0, shown: 0 };
          const target = Math.round(
            Math.min(20_000, (list.scrollHeight - list.clientHeight) * 0.6),
          );
          const across = Math.round((list.scrollWidth - list.clientWidth) / 2);
          if (
            Math.abs(list.scrollTop - target) > 1 ||
            Math.abs(list.scrollLeft - across) > 1
          )
            list.scrollTo({ top: target, left: across, behavior: "instant" });
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const bounds = list.getBoundingClientRect();
          const shown = [
            ...list.querySelectorAll<HTMLElement>(rowSelector),
          ].filter((row) => {
            const r = row.getBoundingClientRect();
            return (
              r.height > 0 && r.bottom > bounds.top && r.top < bounds.bottom
            );
          }).length;
          return { top: list.scrollTop, left: list.scrollLeft, shown };
        },
        {
          notePath,
          root: MODE_ROOT[mode],
          box: FAR_BOX,
          rowSelector: FAR_ROWS[layout],
        },
        {
          what: `the ${layout} embed's box scrolled far down its rows`,
          ready: ({ top, left, shown }) =>
            top >= (size === "long" ? 5000 : 300) &&
            (layout !== "table" || left > 0) &&
            shown > 0,
        },
      );
      const back = await obRun(
        vaultId,
        async ({ app }, { notePath, root, scroller, box, rowSelector }) => {
          const leaf = app.workspace
            .getLeavesOfType("markdown")
            .find((l) => (l.view as MarkdownView).file?.path === notePath)!;
          const note =
            leaf.view.containerEl.querySelector<HTMLElement>(scroller)!;
          const host = leaf.view.containerEl
            .querySelector(root)!
            .querySelector<HTMLElement>(".zt-query-note")!;
          const scrolled = host.querySelector<HTMLElement>(box)!;
          const frame = () =>
            new Promise((resolve) => requestAnimationFrame(resolve));
          const saved = note.scrollTop;
          const start = performance.now();
          let gone = false;
          while (performance.now() - start < 4000) {
            note.scrollTop = note.scrollHeight;
            await frame();
            if (!gone && !host.isConnected) {
              gone = true;
              scrolled.dispatchEvent(new Event("scroll"));
            }
            if (gone && performance.now() - start > 600) break;
          }
          note.scrollTop = saved;
          const shownAt = performance.now();
          let state = { connected: false, top: 0, left: 0, shown: 0 };
          while (performance.now() - shownAt < 3000) {
            await frame();
            const list = leaf.view.containerEl
              .querySelector(root)
              ?.querySelector(".zt-query-note")
              ?.querySelector<HTMLElement>(box);
            if (!list) continue;
            const bounds = list.getBoundingClientRect();
            const shown = [
              ...list.querySelectorAll<HTMLElement>(rowSelector),
            ].filter((row) => {
              const r = row.getBoundingClientRect();
              return (
                r.height > 0 && r.bottom > bounds.top && r.top < bounds.bottom
              );
            }).length;
            state = {
              connected: host.isConnected,
              top: list.scrollTop,
              left: list.scrollLeft,
              shown,
            };
            if (shown > 0 && performance.now() - shownAt > 500) break;
          }
          return { gone, ...state };
        },
        {
          notePath,
          root: MODE_ROOT[mode],
          scroller: NOTE_SCROLLER[mode],
          box: FAR_BOX,
          rowSelector: FAR_ROWS[layout],
        },
        { timeoutMs: 60_000 },
      );
      expect(back.gone).toBe(true);
      expect(back.connected).toBe(true);
      expect(Math.abs(back.top - deep.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.left - deep.left)).toBeLessThanOrEqual(1);
      expect(back.shown).toBeGreaterThan(0);
    },
    120_000,
  );

  it.each(["tab", ...NOTE_MODES] as const)(
    "keeps each header cell of a long grouped Table in place in a %s as the scroll bar is dragged, whatever rows are mounted",
    async (place) => {
      const queryPath = `Grouped table ${place}.zotquery`;
      const notePath = `Grouped table ${place}.md`;
      await using cleanup = new AsyncDisposableStack();
      await createFiles(cleanup, {
        [queryPath]: [
          "views:",
          "  - type: table",
          "    name: All",
          "    from: items",
          '    filters: library == "personal"',
          "    groupBy:",
          "      property: itemType",
          "      direction: ASC",
          "",
        ].join("\n"),
        [notePath]: ["# Grouped table", "", `![[${queryPath}]]`, ""].join("\n"),
      });
      await obRun(
        vaultId,
        async ({ app }, { queryPath, notePath, place }) => {
          const leaf = app.workspace.getLeaf("tab");
          if (place === "tab")
            await leaf.openFile(app.vault.getFileByPath(queryPath)!);
          else
            await leaf.openFile(app.vault.getFileByPath(notePath)!, {
              state: { mode: place },
            });
          app.workspace.setActiveLeaf(leaf, { focus: true });
        },
        { queryPath, notePath, place },
      );
      if (place !== "tab")
        await revealQueryView(vaultId, notePath, { embed: queryPath });
      const geometry = await obRunUntil(
        vaultId,
        async ({ app }, { queryPath, notePath, root }) => {
          const leaf = app.workspace
            .getLeavesOfType(root === null ? "zotlit-query-file" : "markdown")
            .find(
              (l) =>
                (l.view as MarkdownView).file?.path ===
                (root === null ? queryPath : notePath),
            );
          const scope =
            root === null
              ? leaf?.view.containerEl
              : leaf?.view.containerEl.querySelector(root);
          const box = scope?.querySelector<HTMLElement>(".zt-table-scroller");
          if (!box?.querySelector("thead th[data-query-column]")) return null;
          const frame = () =>
            new Promise((resolve) => requestAnimationFrame(resolve));
          const topOf = () =>
            Math.round(
              box.querySelector("thead th")!.getBoundingClientRect().top -
                box.getBoundingClientRect().top,
            );
          const cells = (top = topOf()) => {
            const bounds = box.getBoundingClientRect();
            return [
              `top ${top}`,
              ...[...box.querySelectorAll("thead tr > th")].map((th) => {
                const r = th.getBoundingClientRect();
                return `${Math.round(r.left - bounds.left)}+${Math.round(r.width)}`;
              }),
            ].join(" ");
          };
          const seen = new Set<string>();
          const sample = () => seen.add(cells());
          const bare = () => {
            const rows = [
              ...box.querySelectorAll<HTMLElement>("tbody[data-index]"),
            ];
            const top = topOf();
            for (const row of rows) row.style.display = "none";
            seen.add(cells(top));
            for (const row of rows) row.style.display = "";
          };
          box.addEventListener("scroll", sample);
          try {
            box.scrollTop = 0;
            await frame();
            const end = box.scrollHeight - box.clientHeight;
            for (const step of [box.clientHeight * 3, 200])
              for (let at = 0; at <= end; at += step) {
                box.scrollTop = at;
                sample();
                await frame();
                sample();
                if (step > 200) bare();
              }
          } finally {
            box.removeEventListener("scroll", sample);
          }
          return { cells: [...seen], end: box.scrollTop };
        },
        {
          queryPath,
          notePath,
          root: place === "tab" ? null : MODE_ROOT[place],
        },
        {
          what: `the grouped Table in a ${place} dragged to its end`,
          ready: (result) => result !== null,
        },
      );
      expect(geometry).toMatchObject({ cells: [expect.any(String)] });
    },
    120_000,
  );

  it("opens a vault cell's editor up from a long Table's last row and down from a middle row, inside the box, with no row moved", async () => {
    const path = "Long vault cells.zotquery";
    const note =
      "Foundational essay on the memex and associative trails; argues for machines that extend human memory.";
    await using cleanup = new AsyncDisposableStack();
    await createFiles(cleanup, {
      [path]: [
        "views:",
        "  - type: table",
        "    name: All",
        "    from: items",
        '    filters: library == "personal"',
        "    sort:",
        "      - property: title",
        "        direction: ASC",
        "    order:",
        "      - title",
        "      - vault.note",
        "      - vault.summary",
        "",
      ].join("\n"),
    });
    await obRun(
      vaultId,
      async ({ app }, { path }) => {
        const leaf = app.workspace.getLeaf("tab");
        await leaf.openFile(app.vault.getFileByPath(path)!);
        app.workspace.setActiveLeaf(leaf, { focus: true });
      },
      { path },
    );
    const [middle, last] = await obRunUntil(
      vaultId,
      async ({ app }) => {
        const view = app.workspace.getLeavesOfType("zotlit-query-file")[0]
          ?.view as import("@zotlit/query-views/desktop/query-view/file-view.ts").QueryFileView;
        if (!view) return [];
        await view.query.settled;
        const keys =
          view.query.state.getState().results?.rows.map((r) => r.indexedKey) ??
          [];
        const box =
          view.contentEl.querySelector<HTMLElement>(".zt-table-scroller");
        if (!box || keys.length <= 100) return [];
        box.scrollTop = box.scrollHeight / 2;
        await new Promise((resolve) => setTimeout(resolve, 300));
        const under =
          box.getBoundingClientRect().top +
          box.querySelector("thead")!.offsetHeight;
        const row = [
          ...box.querySelectorAll<HTMLElement>(
            'tr[data-query-table-row="item"]',
          ),
        ].find((row) => row.getBoundingClientRect().top >= under);
        return row ? [row.getAttribute("data-query-key")!, keys.at(-1)!] : [];
      },
      undefined,
      {
        what: "the long Table scrolled half way",
        ready: (keys) => keys.length === 2,
      },
    );
    await createFiles(
      cleanup,
      Object.fromEntries(
        [middle!, last!].map((key) => [
          `Editor side ${key}.md`,
          `---\nzotero-key: ${key}\nnote: ${note}\n---\n`,
        ]),
      ),
    );
    await obRunUntil(
      vaultId,
      ({ zotlit }, { keys }) =>
        keys.every(
          (key) =>
            zotlit.services.bridge.runSync(
              zotlit.services.noteIndex.getNotesByItemKey(key),
            ).length > 0,
        ),
      { keys: [middle!, last!] },
      { what: "the notes of the two papers in the note index" },
    );
    await obRunUntil(
      vaultId,
      ({ app }, { middle, note }) =>
        (
          app.workspace.getLeavesOfType("zotlit-query-file")[0]!
            .view as import("obsidian").ItemView
        ).contentEl
          .querySelector(
            `[data-query-key="${middle}"] [data-query-vault-name="note"]`,
          )
          ?.textContent?.includes(note) ?? false,
      { middle: middle!, note },
      { what: "the middle paper's note in its vault cell" },
    );
    expectEditorSide(
      await openEditorAt(vaultId, { key: middle!, name: "note", place: "top" }),
      false,
    );
    expectEditorSide(
      await openEditorAt(vaultId, { key: last!, name: "note", place: "end" }),
      true,
    );
    const typed = await openEditorAt(vaultId, {
      key: last!,
      name: "summary",
      place: "end",
      lines: 3,
    });
    expectEditorSide(typed, true);
    expect(typed.caret, "the caret shown at the end of the text").toBe(true);
  }, 180_000);

  const DRAG_CASES = (["papers", "table", "list"] as const).flatMap((layout) =>
    (layout === "list"
      ? (["tab", ...NOTE_MODES] as const)
      : (["library", "tab", ...NOTE_MODES] as const)
    ).map((place) => [layout, place] as const),
  );

  it.each(DRAG_CASES)(
    "keeps a long %s list's scroll bar thumb under the pointer in the %s through a drag with holds and a reverse, and shows rows or outlines on every frame",
    async (layout, place) => {
      await using cleanup = new AsyncDisposableStack();
      let host: DragHost;
      if (place === "library") {
        closeLibrary(cleanup);
        await openLibrary(layout as "papers" | "table");
        host = { kind: "library" };
      } else {
        const queryPath = `Drag ${layout} ${place}.zotquery`;
        const notePath = `Drag ${layout} ${place}.md`;
        await createFiles(cleanup, {
          [queryPath]: [
            "views:",
            `  - type: ${layout}`,
            "    name: All",
            "    from: items",
            '    filters: library == "personal"',
            "    groupBy:",
            "      property: itemType",
            "      direction: ASC",
            "",
          ].join("\n"),
          [notePath]: ["# Drag", "", `![[${queryPath}]]`, ""].join("\n"),
        });
        await obRun(
          vaultId,
          async ({ app }, { queryPath, notePath, place }) => {
            const leaf = app.workspace.getLeaf("tab");
            if (place === "tab")
              await leaf.openFile(app.vault.getFileByPath(queryPath)!);
            else
              await leaf.openFile(app.vault.getFileByPath(notePath)!, {
                state: { mode: place },
              });
            app.workspace.setActiveLeaf(leaf, { focus: true });
          },
          { queryPath, notePath, place },
        );
        if (place !== "tab")
          await revealQueryView(vaultId, notePath, { embed: queryPath });
        await obRunUntil(
          vaultId,
          ({ app }, { path, type, root, rows }) => {
            const leaf = app.workspace
              .getLeavesOfType(type)
              .find((l) => (l.view as MarkdownView).file?.path === path);
            const scope =
              root === null
                ? leaf?.view.containerEl
                : leaf?.view.containerEl.querySelector(root);
            return scope?.querySelector(rows) != null;
          },
          {
            path: place === "tab" ? queryPath : notePath,
            type: place === "tab" ? "zotlit-query-file" : "markdown",
            root: place === "tab" ? null : MODE_ROOT[place],
            rows: ROWS[layout],
          },
          { what: `the ${layout} rows in the ${place}` },
        );
        host =
          place === "tab"
            ? { kind: "tab", path: queryPath }
            : { kind: "note", path: notePath, root: MODE_ROOT[place] };
      }
      const drag = await dragScrollBar(vaultId, host);
      console.log(`drag ${layout} ${place}: ${JSON.stringify(drag)}`);
      expect(drag.screen.frames).toBeGreaterThan(10);
      expect({
        unlike: place === "library" || drag.rows.unlike > 0,
        lengthChanges: drag.lengthChanges.moving,
        holds: drag.holds.map((off) => Math.abs(off) <= 3),
        headers: drag.header.length,
        empty: drag.screen.empty,
      }).toEqual({
        unlike: true,
        lengthChanges: 0,
        holds: [true, true, true],
        headers: layout === "table" ? 1 : 0,
        empty: 0,
      });
    },
    120_000,
  );
});
