import { isDeepStrictEqual } from "node:util";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { Settings } from "@zotlit/plugin-services/core/settings/schema.ts";

import { obRun, obRunUntil, waitFor } from "./obsidian-cli.ts";
import {
  annotationKeys,
  cleanup,
  madeSince,
  rdp,
  registerPairedReaderSession,
  registerPdfUnchangedCase,
  seededMark,
  whileEditingNotLive,
} from "./paired-reader-session.ts";
import {
  ATTACHMENT_ITEM,
  api,
  attachment,
  attachmentPath,
  baseUrl,
  debuggerPort,
  readerHoldsAnnotation,
  registerPairedRun,
  serverID,
  setLocalApi,
  vaultId,
} from "./paired-run-fixture.ts";
import {
  eraseAnnotations,
  freshAnnotationKey,
  heldAnnotationKeys,
  readerAnnotation,
  readerSettled,
  storedAnnotation,
  zoteroFetch,
} from "./paired-zotero.ts";
import {
  armToolOnFirstPage,
  disarmTool,
  raiseWindow,
  recomputedSortIndex,
  reopenPdfView,
} from "./reader-gestures.ts";

describe.skipIf(!baseUrl)("Paired Run", () => {
  registerPairedRun();

  describe.skipIf(!debuggerPort || !vaultId)(
    "ZotLit and Zotero on one Fixture",
    () => {
      registerPairedReaderSession();

      describe("the image tool on the first page", () => {
        afterEach(() =>
          disarmTool(vaultId!, { attachmentPath, tool: "image" }),
        );

        const armOnFirstPage = (at: readonly [number, number]) =>
          armToolOnFirstPage(vaultId!, { attachmentPath, tool: "image", at });

        const drag = (
          [x1, y1]: readonly [number, number],
          [x2, y2]: readonly [number, number],
        ) =>
          obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                x1,
                y1,
                x2,
                y2,
              }: {
                attachmentPath: string;
                x1: number;
                y1: number;
                x2: number;
                y2: number;
              },
            ) => {
              const { fire } = pageHelpers;
              const clientOf = (x: number, y: number) => {
                const overlay = pageHelpers
                  .pdfView(attachmentPath)!
                  .reader!.pageAt(0)!
                  .div.querySelector<SVGSVGElement>(
                    ".zt-pdf-annotation-overlay",
                  );
                const box = overlay!.getBoundingClientRect();
                const view = overlay!.viewBox.baseVal;
                return {
                  x: box.left + ((x - view.x) * box.width) / view.width,
                  y:
                    box.top +
                    ((view.y + view.height - y) * box.height) / view.height,
                };
              };
              const from = clientOf(x1, y1),
                to = clientOf(x2, y2);
              const container =
                pageHelpers.pdfView(attachmentPath)!.containerEl;
              const node = fire("pointerdown", from.x, from.y);
              fire(
                "pointermove",
                (from.x + to.x) / 2,
                (from.y + to.y) / 2,
                container,
              );
              fire("pointermove", to.x, to.y, container);
              const preview =
                container
                  .querySelector<HTMLElement>(".zt-pdf-capture-rect")
                  ?.getAttribute("opacity") ?? null;
              fire("pointerup", to.x, to.y, container);
              fire("click", to.x, to.y, node);
              return { preview };
            },
            { attachmentPath, x1, y1, x2, y2 },
          );

        it("creates an image Annotation from a rectangle dragged on the page", async () => {
          await armOnFirstPage([150, 170]);
          const before = await annotationKeys();

          expect(await drag([80, 220], [220, 120])).toEqual({ preview: "1" });

          const capturedKey = await freshAnnotationKey(rdp, {
            item: ATTACHMENT_ITEM,
            before,
            created: (keys) => cleanup.defer(() => eraseAnnotations(rdp, keys)),
          });

          const stored = (await (
            await zoteroFetch(api, `users/0/items/${capturedKey}`, {
              headers: { "Zotero-Server-ID": serverID },
            })
          ).json()) as {
            data: {
              annotationType: string;
              annotationPosition: string;
              annotationPageLabel: string;
              annotationSortIndex: string;
              annotationComment: string;
            };
          };
          expect(stored.data).toMatchObject({
            annotationType: "image",
            annotationPageLabel: "1",
            annotationComment: "",
          });
          const position = JSON.parse(stored.data.annotationPosition) as {
            pageIndex: number;
            rects: number[][];
          };
          expect(position.pageIndex).toBe(0);
          expect(position.rects, stored.data.annotationPosition).toHaveLength(
            1,
          );
          [80, 120, 220, 220].forEach((value, index) =>
            expect(
              position.rects[0]![index],
              stored.data.annotationPosition,
            ).toBeCloseTo(value, 2),
          );
          expect(stored.data.annotationSortIndex).toBe(
            await recomputedSortIndex(vaultId!, {
              attachmentPath,
              position: stored.data.annotationPosition,
            }),
          );

          expect(
            await waitFor(() => readerHoldsAnnotation(rdp, capturedKey)),
          ).toBe(true);
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                capturedKey,
              }: { attachmentPath: string; capturedKey: string },
            ) => {
              return !!pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(capturedKey)}]`,
                );
            },
            { attachmentPath, capturedKey },
            {
              what: "the captured image Annotation's PDF mark to appear on the page",
            },
          );
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                toolName,
              }: { attachmentPath: string; toolName: "image" },
            ) => {
              return pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelector<HTMLElement>(
                  `[data-zt-tool=${JSON.stringify(toolName)}]`,
                )!
                .getAttribute("aria-pressed");
            },
            { attachmentPath, toolName: "image" },
            {
              ready: (value) => value === "false",
              what: "the image tool's button to report not pressed after one capture",
            },
          );
          await obRunUntil(
            vaultId!,
            async ({ app }, { capturedKey }: { capturedKey: string }) => {
              const card = app.workspace
                .getLeavesOfType("zotero-annotation-view")
                .map(({ view }) =>
                  view.containerEl.querySelector<HTMLElement>(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(capturedKey)}]`,
                  ),
                )
                .find(Boolean);
              const img = card?.querySelector<HTMLElement>("img");
              return (
                !!img &&
                (img as HTMLImageElement).complete &&
                (img as HTMLImageElement).naturalWidth > 0
              );
            },
            { capturedKey },
            {
              what: "the Excerpt Image on the captured Annotation's card to finish decoding",
            },
          );
        }, 120000);

        it("creates nothing from a rectangle released under ten points on a side", async () => {
          await armOnFirstPage([85, 350]);
          const before = await annotationKeys();

          expect(await drag([80, 400], [89, 300])).toEqual({ preview: "0.2" });
          await obRun(
            vaultId!,
            async (
              { zotlit },
              { attachmentPath }: { attachmentPath: string },
            ) => {
              await zotlit.services.bridge
                .runSync(zotlit.services.pdfAnnotationEditor.bindings)
                .find((candidate) => candidate.filePath === attachmentPath)!
                .settled;
            },
            { attachmentPath },
          );

          expect(await annotationKeys()).toEqual(before);
          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                {
                  attachmentPath,
                  toolName,
                }: { attachmentPath: string; toolName: "image" },
              ) => {
                return JSON.stringify({
                  armed: pageHelpers
                    .pdfView(attachmentPath)!
                    .containerEl.querySelector<HTMLElement>(
                      `[data-zt-tool=${JSON.stringify(toolName)}]`,
                    )!
                    .getAttribute("aria-pressed"),
                  preview: !!pageHelpers
                    .pdfView(attachmentPath)!
                    .containerEl.querySelector<HTMLElement>(
                      ".zt-pdf-capture-rect",
                    ),
                });
              },
              { attachmentPath, toolName: "image" },
            ),
          ).toBe(JSON.stringify({ armed: "true", preview: false }));
          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              { attachmentPath }: { attachmentPath: string },
            ) => {
              pageHelpers.pdfView(attachmentPath)!.containerEl.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "Escape",
                  bubbles: true,
                  cancelable: true,
                }),
              );
            },
            { attachmentPath },
          );
          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                {
                  attachmentPath,
                  toolName,
                }: { attachmentPath: string; toolName: "image" },
              ) => {
                return String(
                  pageHelpers
                    .pdfView(attachmentPath)!
                    .containerEl.querySelector<HTMLElement>(
                      `[data-zt-tool=${JSON.stringify(toolName)}]`,
                    )!
                    .getAttribute("aria-pressed"),
                );
              },
              { attachmentPath, toolName: "image" },
            ),
          ).toBe("false");
        }, 120000);
      });

      describe("the ink tool on the first page", () => {
        const CURVE = Array.from({ length: 13 }, (_, index) => {
          const turn = (index / 12) * Math.PI;
          return [
            100 + 50 * (1 - Math.cos(turn)),
            340 + 30 * Math.sin(turn),
          ] as const;
        });

        let held: readonly string[] = [];
        beforeAll(async () => {
          held = await annotationKeys();
        });

        afterEach(async () => {
          const keys = await madeSince(held);
          for (const annotationKey of keys)
            await readerSettled(
              { rdp, attachmentKey: attachment.key, annotationKey },
              { api, serverID, image: true },
            );
          await eraseAnnotations(rdp, keys);
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                keys,
                attachmentPath,
              }: { keys: string[]; attachmentPath: string },
            ) => {
              return keys.every(
                (key) =>
                  !pageHelpers
                    .pdfView(attachmentPath)!
                    .containerEl.querySelector<SVGGraphicsElement>(
                      `.zt-pdf-annotation-mark[data-zotero-annotation-key="${key}"]`,
                    ),
              );
            },
            { keys, attachmentPath },
            { what: "the erased ink marks to be gone from the PDF overlay" },
          );
          await disarmTool(vaultId!, { attachmentPath, tool: "ink" });
        });

        const armInk = (at: readonly [number, number]) =>
          armToolOnFirstPage(vaultId!, { attachmentPath, tool: "ink", at });

        const press = (points: readonly (readonly [number, number])[]) =>
          obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                points,
              }: {
                attachmentPath: string;
                points: readonly (readonly [number, number])[];
              },
            ) => {
              const { fire } = pageHelpers;
              const clientOf = (x: number, y: number) => {
                const overlay = pageHelpers
                  .pdfView(attachmentPath)!
                  .reader!.pageAt(0)!
                  .div.querySelector<SVGSVGElement>(
                    ".zt-pdf-annotation-overlay",
                  );
                const box = overlay!.getBoundingClientRect();
                const view = overlay!.viewBox.baseVal;
                return {
                  x: box.left + ((x - view.x) * box.width) / view.width,
                  y:
                    box.top +
                    ((view.y + view.height - y) * box.height) / view.height,
                };
              };
              const container =
                pageHelpers.pdfView(attachmentPath)!.containerEl;
              const [first, ...rest] = points.map(([x, y]) => clientOf(x, y));
              pageHelpers.scratch.__ztInkNode = fire(
                "pointerdown",
                first!.x,
                first!.y,
              );
              for (const at of rest) fire("pointermove", at.x, at.y, container);
              return String(true);
            },
            { attachmentPath, points },
          );

        const release = ([x, y]: readonly [number, number]) =>
          obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                pointX,
                pointY,
              }: { attachmentPath: string; pointX: number; pointY: number },
            ) => {
              const { fire } = pageHelpers;
              const clientOf = (x: number, y: number) => {
                const overlay = pageHelpers
                  .pdfView(attachmentPath)!
                  .reader!.pageAt(0)!
                  .div.querySelector<SVGSVGElement>(
                    ".zt-pdf-annotation-overlay",
                  );
                const box = overlay!.getBoundingClientRect();
                const view = overlay!.viewBox.baseVal;
                return {
                  x: box.left + ((x - view.x) * box.width) / view.width,
                  y:
                    box.top +
                    ((view.y + view.height - y) * box.height) / view.height,
                };
              };
              const at = clientOf(pointX, pointY);
              const container =
                pageHelpers.pdfView(attachmentPath)!.containerEl;
              fire("pointerup", at.x, at.y, container);
              fire("click", at.x, at.y, pageHelpers.scratch.__ztInkNode);
              delete pageHelpers.scratch.__ztInkNode;
              return JSON.stringify({
                pending: container.querySelectorAll<SVGGraphicsElement>(
                  ".zt-pdf-pending-stroke",
                ).length,
                live: !!pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelector<SVGGraphicsElement>(
                    ".zt-pdf-live-stroke",
                  ),
              });
            },
            { attachmentPath, pointX: x, pointY: y },
          );
        const DISCARDED = JSON.stringify({ pending: 0, live: false });

        const escape = () =>
          obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              { attachmentPath }: { attachmentPath: string },
            ) => {
              pageHelpers.pdfView(attachmentPath)!.containerEl.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "Escape",
                  bubbles: true,
                  cancelable: true,
                }),
              );
              return String(true);
            },
            { attachmentPath },
          );

        const freshKey = (before: readonly string[]) =>
          freshAnnotationKey(rdp, {
            item: ATTACHMENT_ITEM,
            before,
          });

        async function storedInk(key: string) {
          const { data } = (await (
            await zoteroFetch(api, `users/0/items/${key}`, {
              headers: { "Zotero-Server-ID": serverID },
            })
          ).json()) as {
            data: {
              annotationType: string;
              annotationPosition: string;
              annotationPageLabel: string;
              annotationSortIndex: string;
              annotationComment: string;
            };
          };
          return {
            data,
            position: JSON.parse(data.annotationPosition) as {
              pageIndex: number;
              width: number;
              paths: number[][];
            },
          };
        }

        it("creates an ink Annotation from a stroke drawn on the page, and stays armed (I-8)", async () => {
          await armInk([150, 355]);
          const before = await annotationKeys();

          await press(CURVE);
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                pressX,
                pressY,
              }: { attachmentPath: string; pressX: number; pressY: number },
            ) => {
              const clientOf = (x: number, y: number) => {
                const overlay = pageHelpers
                  .pdfView(attachmentPath)!
                  .reader!.pageAt(0)!
                  .div.querySelector<SVGSVGElement>(
                    ".zt-pdf-annotation-overlay",
                  );
                const box = overlay!.getBoundingClientRect();
                const view = overlay!.viewBox.baseVal;
                return {
                  x: box.left + ((x - view.x) * box.width) / view.width,
                  y:
                    box.top +
                    ((view.y + view.height - y) * box.height) / view.height,
                };
              };
              const stroke = pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelector<SVGGraphicsElement>(
                  ".zt-pdf-live-stroke",
                );
              if (!stroke) return "none";
              const [x, y] = stroke
                .getAttribute("d")!
                .split(" ")
                .slice(1, 3)
                .map(Number);
              const at = new DOMPoint(x, y).matrixTransform(
                stroke.getScreenCTM()!,
              );
              const press = clientOf(pressX, pressY);
              return {
                start:
                  Math.abs(at.x - press.x) < 0.5 &&
                  Math.abs(at.y - press.y) < 0.5,
                moved: stroke.getAttribute("d")!.split("L").length > 3,
              };
            },
            { attachmentPath, pressX: CURVE[0]![0], pressY: CURVE[0]![1] },
            {
              ready: (value) =>
                isDeepStrictEqual(value, { start: true, moved: true }),
              what: "the live ink stroke to start at the press and take the moves",
            },
          );
          await release(CURVE.at(-1)!);

          const inkKey = await freshKey(before);
          const { data, position } = await storedInk(inkKey);
          expect(data).toMatchObject({
            annotationType: "ink",
            annotationPageLabel: "1",
            annotationComment: "",
          });
          expect(position.pageIndex).toBe(0);
          expect(position.width).toBe(2);
          expect(position.paths, data.annotationPosition).toHaveLength(1);
          const path = position.paths[0]!;
          const points = Array.from({ length: path.length / 2 }, (_, index) => [
            path[2 * index]!,
            path[2 * index + 1]!,
          ]);
          const [first, last] = [CURVE[0]!, CURVE.at(-1)!];
          expect(points[0]![0]).toBeCloseTo(first[0], 3);
          expect(points[0]![1]).toBeCloseTo(first[1], 3);
          expect(
            Math.hypot(
              points.at(-1)![0]! - last[0],
              points.at(-1)![1]! - last[1],
            ),
          ).toBeLessThan(1);
          for (let index = 1; index < points.length; index++) {
            const [x1, y1] = points[index - 1]!;
            const [x2, y2] = points[index]!;
            expect(
              Math.hypot(x2! - x1!, y2! - y1!),
              `points ${index - 1} and ${index}`,
            ).toBeGreaterThanOrEqual(1);
          }
          const xs = CURVE.map(([x]) => x);
          const ys = CURVE.map(([, y]) => y);
          for (const [x, y] of points) {
            expect(x).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-3);
            expect(x).toBeLessThanOrEqual(Math.max(...xs) + 1e-3);
            expect(y).toBeGreaterThanOrEqual(Math.min(...ys) - 1e-3);
            expect(y).toBeLessThanOrEqual(Math.max(...ys) + 1e-3);
          }
          expect(data.annotationSortIndex).toBe(
            await recomputedSortIndex(vaultId!, {
              attachmentPath,
              position: data.annotationPosition,
            }),
          );

          expect(await waitFor(() => readerHoldsAnnotation(rdp, inkKey))).toBe(
            true,
          );
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                inkKey,
                toolName,
              }: { attachmentPath: string; inkKey: string; toolName: "ink" },
            ) => {
              return {
                mark: !!pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelector<SVGGraphicsElement>(
                    `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(inkKey)}]`,
                  ),
                live: !!pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelector<SVGGraphicsElement>(
                    ".zt-pdf-live-stroke",
                  ),
                armed: pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelector<HTMLElement>(
                    `[data-zt-tool=${JSON.stringify(toolName)}]`,
                  )!
                  .getAttribute("aria-pressed"),
              };
            },
            { attachmentPath, inkKey, toolName: "ink" },
            {
              ready: (value) =>
                isDeepStrictEqual(value, {
                  mark: true,
                  live: false,
                  armed: "true",
                }),
              what: "the ink mark drawn, the live stroke cleared and the ink tool armed",
            },
          );
          await obRunUntil(
            vaultId!,
            async ({ app }, { inkKey }: { inkKey: string }) => {
              const card = app.workspace
                .getLeavesOfType("zotero-annotation-view")
                .map(({ view }) =>
                  view.containerEl.querySelector<HTMLElement>(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(inkKey)}]`,
                  ),
                )
                .find(Boolean);
              const img = card?.querySelector<HTMLElement>("img");
              return (
                !!img &&
                (img as HTMLImageElement).complete &&
                (img as HTMLImageElement).naturalWidth > 0
              );
            },
            { inkKey },
            {
              what: "the Excerpt Image on the ink Annotation's card to finish decoding",
            },
          );
        }, 120000);

        it("stores a tap as one point, which the page draws as a dot", async () => {
          const dot = [90, 380] as const;
          await armInk(dot);
          const before = await annotationKeys();

          await press([dot]);
          await release(dot);

          const dotKey = await freshKey(before);
          const { position } = await storedInk(dotKey);
          expect(position.paths).toHaveLength(1);
          expect(position.paths[0]).toHaveLength(2);
          expect(position.paths[0]![0]).toBeCloseTo(dot[0], 3);
          expect(position.paths[0]![1]).toBeCloseTo(dot[1], 3);
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                dotKey,
              }: { attachmentPath: string; dotKey: string },
            ) => {
              return /^M \S+ \S+ L \S+ \S+$/.test(
                pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelector<SVGGraphicsElement>(
                    `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(dotKey)}]`,
                  )
                  ?.getAttribute("d") ?? "",
              );
            },
            { attachmentPath, dotKey },
            {
              what: "the tap's PDF mark to be a single-point path drawn as a dot",
            },
          );
        }, 120000);

        it("draws at the width picked from the ink seat's menu, and keeps the pick over a reopen of the PDF", async () => {
          const inkMenu = (pick?: number) =>
            obRun(
              vaultId!,
              (
                { page: pageHelpers },
                {
                  attachmentPath,
                  pick,
                }: { attachmentPath: string; pick: number | null },
              ) => {
                pageHelpers.press(
                  pageHelpers
                    .pdfView(attachmentPath)!
                    .containerEl.querySelector<HTMLElement>(
                      '[data-zt-tool="ink-color"]',
                    ),
                  "Ink color",
                );
                const items = [
                  ...document.querySelectorAll<HTMLElement>(".menu .menu-item"),
                ];
                const label = items.findIndex((item) =>
                  item.classList.contains("is-label"),
                );
                const word = (item: HTMLElement) =>
                  item.textContent.trim().split(/\s/)[0];
                const checked = items
                  .slice(label + 1)
                  .find((item) => item.querySelector(".mod-checked"));
                if (pick !== null)
                  pageHelpers.press(
                    items
                      .slice(label + 1)
                      .find((item) => word(item) === String(pick)),
                    `colour ${pick}`,
                  );
                else
                  window.dispatchEvent(
                    new KeyboardEvent("keydown", {
                      key: "Escape",
                      bubbles: true,
                    }),
                  );
                return checked ? word(checked) : "none";
              },
              { attachmentPath, pick: pick ?? null },
            );
          await using restore = new AsyncDisposableStack();
          const [nativeMenus, width] = (
            await obRun(
              vaultId!,
              async ({ app, zotlit }) => {
                return JSON.stringify([
                  app.vault.getConfig("nativeMenus"),
                  zotlit.services.bridge.runSync(
                    zotlit.services.settings.current,
                  )["reader.ink-width"],
                ]);
              },
              undefined,
            ).then((reply) => JSON.parse(reply) as [boolean, number])
          ).map(String);
          restore.defer(async () => {
            await obRun(
              vaultId!,
              async (
                { app, zotlit },
                {
                  width,
                  nativeMenusEnabled,
                }: { width: string | undefined; nativeMenusEnabled: boolean },
              ) => {
                zotlit.services.bridge.runSync(
                  zotlit.services.settings.update({
                    "reader.ink-width": Number(
                      width,
                    ) as Settings["reader.ink-width"],
                  }),
                );
                app.vault.setConfig("nativeMenus", nativeMenusEnabled);
              },
              { width, nativeMenusEnabled: nativeMenus === "true" },
            );
          });
          await obRun(
            vaultId!,
            async ({ app }) => {
              app.vault.setConfig("nativeMenus", false);
            },
            undefined,
          );
          const picked = width === "5" ? 8 : 5;
          await armInk([150, 355]);

          expect(await inkMenu(picked)).toBe(width);

          await reopenPdfView(vaultId!, attachmentPath);
          await armInk([150, 355]);
          expect(await inkMenu()).toBe(String(picked));
          const before = await annotationKeys();
          await press(CURVE);
          await release(CURVE.at(-1)!);

          const inkKey = await freshKey(before);
          expect((await storedInk(inkKey)).position.width).toBe(picked);
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                inkKey,
              }: { attachmentPath: string; inkKey: string },
            ) => {
              const mark = (key: string) =>
                pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelector<SVGGraphicsElement>(
                    `.zt-pdf-annotation-mark[data-zotero-annotation-key="${key}"]`,
                  )
                  ?.getAttribute("stroke-width");
              return [mark(inkKey), mark("4PE492KU")];
            },
            { attachmentPath, inkKey },
            {
              ready: (value) => isDeepStrictEqual(value, [String(picked), "2"]),
              what: "stroke widths of the new ink mark and seed 4PE492KU to match the pick",
            },
          );
        }, 120000);

        it("discards a stroke on Escape and stays armed; a second Escape disarms", async () => {
          await armInk([150, 355]);
          const before = await annotationKeys();

          await press(CURVE.slice(0, 7));
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              { attachmentPath }: { attachmentPath: string },
            ) => {
              return !!pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelector<SVGGraphicsElement>(
                  ".zt-pdf-live-stroke",
                );
            },
            { attachmentPath },
            { what: "the live ink stroke to clear from the PDF page" },
          );
          await escape();
          expect(await release(CURVE[6]!)).toBe(DISCARDED);

          expect(await annotationKeys()).toEqual(before);
          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                {
                  attachmentPath,
                  toolName,
                }: { attachmentPath: string; toolName: "ink" },
              ) => {
                return String(
                  pageHelpers
                    .pdfView(attachmentPath)!
                    .containerEl.querySelector<HTMLElement>(
                      `[data-zt-tool=${JSON.stringify(toolName)}]`,
                    )!
                    .getAttribute("aria-pressed"),
                );
              },
              { attachmentPath, toolName: "ink" },
            ),
          ).toBe("true");
          await escape();
          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                {
                  attachmentPath,
                  toolName,
                }: { attachmentPath: string; toolName: "ink" },
              ) => {
                return String(
                  pageHelpers
                    .pdfView(attachmentPath)!
                    .containerEl.querySelector<HTMLElement>(
                      `[data-zt-tool=${JSON.stringify(toolName)}]`,
                    )!
                    .getAttribute("aria-pressed"),
                );
              },
              { attachmentPath, toolName: "ink" },
            ),
          ).toBe("false");
        }, 120000);

        it("takes touch panning off the page container and shows the crosshair only while armed", async () => {
          await armInk([150, 355]);

          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                { attachmentPath }: { attachmentPath: string },
              ) => {
                return getComputedStyle(
                  pageHelpers.pdfView(attachmentPath)!.reader!.container,
                ).touchAction;
              },
              { attachmentPath },
            ),
          ).toBe("none");
          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                { attachmentPath }: { attachmentPath: string },
              ) => {
                return getComputedStyle(
                  pageHelpers.pdfView(attachmentPath)!.reader!.container,
                ).cursor;
              },
              { attachmentPath },
            ),
          ).toBe("crosshair");
          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                { attachmentPath }: { attachmentPath: string },
              ) => {
                return getComputedStyle(
                  pageHelpers
                    .pdfView(attachmentPath)!
                    .reader!.pageAt(0)!
                    .div.querySelector<HTMLElement>(".textLayer span")!,
                ).cursor;
              },
              { attachmentPath },
            ),
          ).toBe("crosshair");

          await press([[150, 355]]);
          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                { attachmentPath }: { attachmentPath: string },
              ) => {
                return getComputedStyle(
                  pageHelpers.pdfView(attachmentPath)!.containerEl,
                ).cursor;
              },
              { attachmentPath },
            ),
          ).toBe("crosshair");
          await escape();
          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                { attachmentPath }: { attachmentPath: string },
              ) => {
                return getComputedStyle(
                  pageHelpers.pdfView(attachmentPath)!.containerEl,
                ).cursor;
              },
              { attachmentPath },
            ),
          ).not.toBe("crosshair");
          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                toolName,
              }: { attachmentPath: string; toolName: "ink" },
            ) => {
              const { press } = pageHelpers;
              press(
                pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelector<HTMLElement>(
                    `[data-zt-tool=${JSON.stringify(toolName)}]`,
                  ),
                "tool",
              );
            },
            { attachmentPath, toolName: "ink" },
          );
          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                {
                  attachmentPath,
                  toolName,
                }: { attachmentPath: string; toolName: "ink" },
              ) => {
                return String(
                  pageHelpers
                    .pdfView(attachmentPath)!
                    .containerEl.querySelector<HTMLElement>(
                      `[data-zt-tool=${JSON.stringify(toolName)}]`,
                    )!
                    .getAttribute("aria-pressed"),
                );
              },
              { attachmentPath, toolName: "ink" },
            ),
          ).toBe("false");
          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                { attachmentPath }: { attachmentPath: string },
              ) => {
                return getComputedStyle(
                  pageHelpers.pdfView(attachmentPath)!.reader!.container,
                ).touchAction;
              },
              { attachmentPath },
            ),
          ).not.toBe("none");
          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                { attachmentPath }: { attachmentPath: string },
              ) => {
                return getComputedStyle(
                  pageHelpers
                    .pdfView(attachmentPath)!
                    .reader!.pageAt(0)!
                    .div.querySelector<HTMLElement>(".textLayer span")!,
                ).cursor;
              },
              { attachmentPath },
            ),
          ).not.toBe("crosshair");
        }, 120000);

        it("shows each armed tool's cursor over the page, and keeps it through a held capture or click", async () => {
          await armInk([150, 355]);

          const arm = (id: string) =>
            obRun(
              vaultId!,
              (
                { page: pageHelpers },
                { attachmentPath, id }: { attachmentPath: string; id: string },
              ) => {
                const tool = pageHelpers.toolButton(
                  pageHelpers.pdfView(attachmentPath)!,
                  id,
                )!;
                pageHelpers.press(tool, id);
                return tool.getAttribute("aria-pressed");
              },
              { attachmentPath, id },
            );

          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                { attachmentPath }: { attachmentPath: string },
              ) => {
                const page = pageHelpers
                  .pdfView(attachmentPath)!
                  .reader!.pageAt(0)!.div;
                return [
                  page,
                  page.querySelector<HTMLElement>(".textLayer span"),
                ]
                  .map((node) => getComputedStyle(node!).cursor)
                  .join();
              },
              { attachmentPath },
            ),
          ).toBe("crosshair,crosshair");
          expect(await arm("highlight")).toBe("true");
          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                { attachmentPath }: { attachmentPath: string },
              ) => {
                const page = pageHelpers
                  .pdfView(attachmentPath)!
                  .reader!.pageAt(0)!.div;
                return [
                  page,
                  page.querySelector<HTMLElement>(".textLayer span"),
                ]
                  .map((node) => getComputedStyle(node!).cursor)
                  .join();
              },
              { attachmentPath },
            ),
          ).toBe("text,text");
          expect(await arm("underline")).toBe("true");
          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                { attachmentPath }: { attachmentPath: string },
              ) => {
                const page = pageHelpers
                  .pdfView(attachmentPath)!
                  .reader!.pageAt(0)!.div;
                return [
                  page,
                  page.querySelector<HTMLElement>(".textLayer span"),
                ]
                  .map((node) => getComputedStyle(node!).cursor)
                  .join();
              },
              { attachmentPath },
            ),
          ).toBe("text,text");
          expect(await arm("image")).toBe("true");
          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                { attachmentPath }: { attachmentPath: string },
              ) => {
                const page = pageHelpers
                  .pdfView(attachmentPath)!
                  .reader!.pageAt(0)!.div;
                return [
                  page,
                  page.querySelector<HTMLElement>(".textLayer span"),
                ]
                  .map((node) => getComputedStyle(node!).cursor)
                  .join();
              },
              { attachmentPath },
            ),
          ).toBe("crosshair,crosshair");

          await press(CURVE.slice(0, 5));
          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                { attachmentPath }: { attachmentPath: string },
              ) => {
                return !!pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelector<HTMLElement>(
                    ".zt-pdf-capture-rect",
                  );
              },
              { attachmentPath },
            ),
          ).toBe(true);
          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                { attachmentPath }: { attachmentPath: string },
              ) => {
                return getComputedStyle(
                  pageHelpers.pdfView(attachmentPath)!.containerEl,
                ).cursor;
              },
              { attachmentPath },
            ),
          ).toBe("crosshair");
          await escape();
          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                { attachmentPath }: { attachmentPath: string },
              ) => {
                return getComputedStyle(
                  pageHelpers.pdfView(attachmentPath)!.containerEl,
                ).cursor;
              },
              { attachmentPath },
            ),
          ).not.toBe("crosshair");

          expect(await arm("image")).toBe("false");
          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                { attachmentPath }: { attachmentPath: string },
              ) => {
                const page = pageHelpers
                  .pdfView(attachmentPath)!
                  .reader!.pageAt(0)!.div;
                return [
                  page,
                  page.querySelector<HTMLElement>(".textLayer span"),
                ]
                  .map((node) => getComputedStyle(node!).cursor)
                  .join();
              },
              { attachmentPath },
            ),
          ).not.toContain("crosshair");

          for (const [id, cursor] of [
            ["note", "copy"],
            ["text", "text"],
          ] as const) {
            expect(await arm(id)).toBe("true");
            expect(
              await obRun(
                vaultId!,
                async (
                  { page: pageHelpers },
                  { attachmentPath }: { attachmentPath: string },
                ) => {
                  const page = pageHelpers
                    .pdfView(attachmentPath)!
                    .reader!.pageAt(0)!.div;
                  return [
                    page,
                    page.querySelector<HTMLElement>(".textLayer span"),
                  ]
                    .map((node) => getComputedStyle(node!).cursor)
                    .join();
                },
                { attachmentPath },
              ),
            ).toBe(`${cursor},${cursor}`);
            await press(CURVE.slice(0, 1));
            expect(
              await obRun(
                vaultId!,
                async (
                  { page: pageHelpers },
                  { attachmentPath }: { attachmentPath: string },
                ) => {
                  return getComputedStyle(
                    pageHelpers.pdfView(attachmentPath)!.containerEl,
                  ).cursor;
                },
                { attachmentPath },
              ),
            ).toBe(cursor);
            await escape();
            expect(
              await obRun(
                vaultId!,
                async (
                  { page: pageHelpers },
                  { attachmentPath }: { attachmentPath: string },
                ) => {
                  return getComputedStyle(
                    pageHelpers.pdfView(attachmentPath)!.containerEl,
                  ).cursor;
                },
                { attachmentPath },
              ),
            ).not.toBe(cursor);
          }
        }, 120000);

        it("stands down from a toolbar press over a page scrolled under the toolbar", async () => {
          await armInk([150, 355]);
          const before = await annotationKeys();
          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                toolName,
              }: { attachmentPath: string; toolName: "ink" },
            ) => {
              const box = pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelector<HTMLElement>(
                  `[data-zt-tool=${JSON.stringify(toolName)}]`,
                )!
                .getBoundingClientRect();
              const page = pageHelpers
                .pdfView(attachmentPath)!
                .reader!.pageAt(0)!
                .div.getBoundingClientRect();
              pageHelpers.pdfView(
                attachmentPath,
              )!.reader!.container.scrollTop +=
                page.top - (box.top + box.height / 2) + box.height;
            },
            { attachmentPath, toolName: "ink" },
          );

          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                {
                  attachmentPath,
                  toolName,
                }: { attachmentPath: string; toolName: "ink" },
              ) => {
                const { fire } = pageHelpers;
                const node = pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelector<HTMLElement>(
                    `[data-zt-tool=${JSON.stringify(toolName)}]`,
                  );
                const box = node!.getBoundingClientRect();
                const x = box.left + box.width / 2,
                  y = box.top + box.height / 2;
                const page = pageHelpers
                  .pdfView(attachmentPath)!
                  .reader!.pageAt(0)!
                  .div.getBoundingClientRect();
                const container =
                  pageHelpers.pdfView(attachmentPath)!.containerEl;
                fire("pointerdown", x, y, node);
                const underPage = page.top < y && y < page.bottom;
                fire("pointerup", x, y, node);
                fire("click", x, y, node);
                return JSON.stringify({
                  underPage,
                  pending: container.querySelectorAll<SVGGraphicsElement>(
                    ".zt-pdf-pending-stroke",
                  ).length,
                  live: !!pageHelpers
                    .pdfView(attachmentPath)!
                    .containerEl.querySelector<SVGGraphicsElement>(
                      ".zt-pdf-live-stroke",
                    ),
                  armed: node!.getAttribute("aria-pressed"),
                });
              },
              { attachmentPath, toolName: "ink" },
            ),
          ).toBe(
            JSON.stringify({
              underPage: true,
              pending: 0,
              live: false,
              armed: "false",
            }),
          );
          expect(await annotationKeys()).toEqual(before);
        }, 120000);

        it("discards a stroke when a second pointer presses, as a pinch begins", async () => {
          await armInk([150, 355]);
          const before = await annotationKeys();

          await press(CURVE.slice(0, 5));
          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                curvePoints,
              }: {
                attachmentPath: string;
                curvePoints: (readonly [number, number])[];
              },
            ) => {
              const { fire } = pageHelpers;
              const clientOf = (x: number, y: number) => {
                const overlay = pageHelpers
                  .pdfView(attachmentPath)!
                  .reader!.pageAt(0)!
                  .div.querySelector<SVGSVGElement>(
                    ".zt-pdf-annotation-overlay",
                  );
                const box = overlay!.getBoundingClientRect();
                const view = overlay!.viewBox.baseVal;
                return {
                  x: box.left + ((x - view.x) * box.width) / view.width,
                  y:
                    box.top +
                    ((view.y + view.height - y) * box.height) / view.height,
                };
              };
              const container =
                pageHelpers.pdfView(attachmentPath)!.containerEl;
              const second = clientOf(180, 350);
              fire("pointerdown", second.x, second.y, undefined, {
                pointerId: 2,
              });
              for (const [x, y] of curvePoints) {
                const at = clientOf(x, y);
                fire("pointermove", at.x, at.y, container);
                fire(
                  "pointermove",
                  at.x,
                  second.y - (at.y - second.y),
                  container,
                  { pointerId: 2 },
                );
              }
              fire("pointerup", second.x, second.y, container, {
                pointerId: 2,
              });
            },
            { attachmentPath, curvePoints: CURVE.slice(5) },
          );
          expect(await release(CURVE.at(-1)!)).toBe(DISCARDED);

          expect(await annotationKeys()).toEqual(before);
        }, 120000);

        it("creates a new Annotation from a stroke pressed on the seeded ink, and leaves the seed unselected", async () => {
          await armInk([220, 675]);
          const before = await annotationKeys();

          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              { attachmentPath }: { attachmentPath: string },
            ) => {
              const { fire } = pageHelpers;
              const container =
                pageHelpers.pdfView(attachmentPath)!.containerEl;
              const mark = pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelector<SVGGraphicsElement>(
                  '.zt-pdf-annotation-mark[data-zotero-annotation-key="4PE492KU"]',
                );
              const at = (mark! as SVGGeometryElement)
                .getPointAtLength(
                  (mark! as SVGGeometryElement).getTotalLength() / 2,
                )
                .matrixTransform(mark!.getScreenCTM()!);
              pageHelpers.scratch.__ztInkNode = fire("pointerdown", at.x, at.y);
              for (let step = 1; step <= 6; step++)
                fire(
                  "pointermove",
                  at.x + step * 6,
                  at.y + step * 4,
                  container,
                );
              fire("pointerup", at.x + 36, at.y + 24, container);
              fire(
                "click",
                at.x + 36,
                at.y + 24,
                pageHelpers.scratch.__ztInkNode,
              );
              delete pageHelpers.scratch.__ztInkNode;
            },
            { attachmentPath },
          );

          const inkKey = await freshKey(before);
          expect((await storedInk(inkKey)).data.annotationType).toBe("ink");
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                inkKey,
              }: { attachmentPath: string; inkKey: string },
            ) => {
              return !!pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(inkKey)}]`,
                );
            },
            { attachmentPath, inkKey },
            { what: "the seeded ink mark to be drawn on the PDF overlay" },
          );
          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                { attachmentPath }: { attachmentPath: string },
              ) => {
                return pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelectorAll<SVGGraphicsElement>(
                    ".zt-pdf-annotation-mark.is-selected",
                  ).length;
              },
              { attachmentPath },
            ),
          ).toBe(0);
        }, 120000);

        it("draws nothing and writes nothing while editing is not live", async () => {
          await armInk([150, 355]);
          const before = await annotationKeys();

          {
            await using restoreLocalApi = new AsyncDisposableStack();
            restoreLocalApi.defer(async () => {
              await setLocalApi(rdp, true);
            });
            await setLocalApi(rdp, false);
            await obRunUntil(
              vaultId!,
              async (
                { zotlit },
                { attachmentKey }: { attachmentKey: string },
              ) => {
                const { annotationRepository: repository, bridge } =
                  zotlit.services;
                await bridge.runPromise(repository.probe);
                return (() => {
                  const capability = bridge.runSync(
                    repository.capabilityFor(attachmentKey),
                  );
                  return "reason" in capability ? capability.reason : undefined;
                })();
              },
              { attachmentKey: attachment.key },
              {
                ready: (value) => value === "local-api-disabled",
                what: "the attachment's annotation capability to report local-api-disabled",
              },
            );

            await press(CURVE);
            expect(
              await obRun(
                vaultId!,
                async (
                  { page: pageHelpers },
                  { attachmentPath }: { attachmentPath: string },
                ) => {
                  return !!pageHelpers
                    .pdfView(attachmentPath)!
                    .containerEl.querySelector<SVGGraphicsElement>(
                      ".zt-pdf-live-stroke",
                    );
                },
                { attachmentPath },
              ),
            ).toBe(false);
            expect(await release(CURVE.at(-1)!)).toBe(DISCARDED);
          }

          await obRunUntil(
            vaultId!,
            async (
              { zotlit },
              { attachmentKey }: { attachmentKey: string },
            ) => {
              const { annotationRepository: repository, bridge } =
                zotlit.services;
              await bridge.runPromise(repository.probe);
              return bridge.runSync(repository.capabilityFor(attachmentKey))
                .kind;
            },
            { attachmentKey: attachment.key },
            {
              ready: (value) => value === "writable",
              what: "the attachment's annotation capability to report writable",
            },
          );
          expect(await annotationKeys()).toEqual(before);
        }, 120000);
      });

      describe("the note tool on the first page", () => {
        const CLEAR = [150, 250] as const;
        const SEED_NOTE = [577.901, 609.393] as const;

        let held: readonly string[] = [];
        beforeAll(async () => {
          held = await annotationKeys();
        });

        afterEach(async () => {
          await eraseAnnotations(rdp, await madeSince(held));
          await disarmTool(vaultId!, { attachmentPath, tool: "note" });
        });

        const armNote = (at: readonly [number, number]) =>
          armToolOnFirstPage(vaultId!, { attachmentPath, tool: "note", at });

        const click = ([x, y]: readonly [number, number]) =>
          obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                pointX,
                pointY,
              }: { attachmentPath: string; pointX: number; pointY: number },
            ) => {
              const { tap } = pageHelpers;
              const clientOf = (x: number, y: number) => {
                const overlay = pageHelpers
                  .pdfView(attachmentPath)!
                  .reader!.pageAt(0)!
                  .div.querySelector<SVGSVGElement>(
                    ".zt-pdf-annotation-overlay",
                  );
                const box = overlay!.getBoundingClientRect();
                const view = overlay!.viewBox.baseVal;
                return {
                  x: box.left + ((x - view.x) * box.width) / view.width,
                  y:
                    box.top +
                    ((view.y + view.height - y) * box.height) / view.height,
                };
              };
              const at = clientOf(pointX, pointY);
              tap(at.x, at.y);
              return String(true);
            },
            { attachmentPath, pointX: x, pointY: y },
          );

        it("places a note centred on a click, opens its comment, and stands the tool down", async () => {
          await armNote(CLEAR);
          const before = await annotationKeys();

          await click(CLEAR);

          const noteKey = await freshAnnotationKey(rdp, {
            item: ATTACHMENT_ITEM,
            before,
          });
          const data = await storedAnnotation(api, serverID, noteKey);
          expect(data).toMatchObject({
            annotationType: "note",
            annotationColor: "#ffd400",
            annotationPageLabel: "1",
            annotationComment: "",
          });
          const position = JSON.parse(data.annotationPosition) as {
            pageIndex: number;
            rects: number[][];
          };
          expect(position.pageIndex).toBe(0);
          expect(position.rects, data.annotationPosition).toHaveLength(1);
          const [x, y] = CLEAR;
          [x - 11, y - 11, x + 11, y + 11].forEach((value, index) =>
            expect(
              Math.abs(position.rects[0]![index]! - value),
              data.annotationPosition,
            ).toBeLessThan(0.1),
          );
          expect(position.rects[0]![2]! - position.rects[0]![0]!).toBeCloseTo(
            22,
            2,
          );
          expect(position.rects[0]![3]! - position.rects[0]![1]!).toBeCloseTo(
            22,
            2,
          );
          expect(data.annotationSortIndex).toBe(
            await recomputedSortIndex(vaultId!, {
              attachmentPath,
              position: data.annotationPosition,
            }),
          );

          expect(await waitFor(() => readerHoldsAnnotation(rdp, noteKey))).toBe(
            true,
          );
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                noteKey,
                toolId,
              }: { attachmentPath: string; noteKey: string; toolId: "note" },
            ) => {
              const mark = pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(noteKey)}]`,
                );
              const focused = document.activeElement;
              return {
                glyph: !!mark?.classList.contains(
                  "zt-pdf-annotation-note-icon",
                ),
                selected: !!mark?.classList.contains("is-selected"),
                sheet:
                  !!focused?.closest(".popover") &&
                  !!focused?.closest(".cm-content"),
                armed: pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelector<HTMLElement>(
                    `[data-zt-tool=${JSON.stringify(toolId)}]`,
                  )!
                  .getAttribute("aria-pressed"),
              };
            },
            { attachmentPath, noteKey, toolId: "note" },
            {
              ready: (value) =>
                isDeepStrictEqual(value, {
                  glyph: true,
                  selected: true,
                  sheet: true,
                  armed: "false",
                }),
              what: "the new note selected with its comment sheet focused and tool disarmed",
            },
          );
        }, 120000);

        it("selects the seeded note under a click and creates nothing", async () => {
          await armNote(SEED_NOTE);
          const before = await annotationKeys();

          await click(SEED_NOTE);

          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              { attachmentPath }: { attachmentPath: string },
            ) => {
              return [
                ...pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelectorAll<SVGGraphicsElement>(
                    ".zt-pdf-annotation-mark.is-selected",
                  ),
              ].map((mark) => mark.dataset.zoteroAnnotationKey);
            },
            { attachmentPath },
            {
              ready: (value) => isDeepStrictEqual(value, ["C94NJNYG"]),
              what: "only the seeded note C94NJNYG to be selected in the PDF overlay",
            },
          );
          expect(await annotationKeys()).toEqual(before);
        }, 120000);

        it("creates nothing from a click while editing is not live", async () => {
          await armNote(CLEAR);
          const before = await annotationKeys();

          await whileEditingNotLive(async () => {
            await click(CLEAR);
          });

          expect(await annotationKeys()).toEqual(before);
        }, 120000);
      });

      describe("the text tool on the first page", () => {
        const CLEAR = [150, 250] as const;
        const SEED_TEXT = [479.804, 693.607] as const;

        let held: readonly string[] = [];
        beforeAll(async () => {
          held = await annotationKeys();
        });

        afterEach(async () => {
          const erased = await madeSince(held);
          await eraseAnnotations(rdp, erased);
          await disarmTool(vaultId!, { attachmentPath, tool: "text" });
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                erased,
                attachmentPath,
              }: { erased: string[]; attachmentPath: string },
            ) => {
              return erased.some((key) =>
                pageHelpers
                  .pdfView(attachmentPath)
                  ?.containerEl.querySelector<SVGGraphicsElement>(
                    `.zt-pdf-annotation-mark[data-zotero-annotation-key="${key}"]`,
                  ),
              );
            },
            { erased, attachmentPath },
            {
              ready: (value) => value === false,
              what: "the erased marks to leave the PDF overlay before the next click",
            },
          );
        });

        const armText = (at: readonly [number, number]) =>
          armToolOnFirstPage(vaultId!, { attachmentPath, tool: "text", at });

        const click = async ([x, y]: readonly [number, number]) =>
          (await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                pointX,
                pointY,
                toolId,
              }: {
                attachmentPath: string;
                pointX: number;
                pointY: number;
                toolId: "text";
              },
            ) => {
              const { tap } = pageHelpers;
              const clientOf = (x: number, y: number) => {
                const overlay = pageHelpers
                  .pdfView(attachmentPath)!
                  .reader!.pageAt(0)!
                  .div.querySelector<SVGSVGElement>(
                    ".zt-pdf-annotation-overlay",
                  );
                const box = overlay!.getBoundingClientRect();
                const view = overlay!.viewBox.baseVal;
                return {
                  x: box.left + ((x - view.x) * box.width) / view.width,
                  y:
                    box.top +
                    ((view.y + view.height - y) * box.height) / view.height,
                };
              };
              const at = clientOf(pointX, pointY);
              tap(at.x, at.y);
              const area = pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelector<HTMLElement>(".zt-pdf-text-draft");
              return {
                draft: !!area,
                focused: !!area && document.activeElement === area,
                armed: pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelector<HTMLElement>(
                    `[data-zt-tool=${JSON.stringify(toolId)}]`,
                  )!
                  .getAttribute("aria-pressed"),
              };
            },
            { attachmentPath, pointX: x, pointY: y, toolId: "text" },
          )) as { draft: boolean; focused: boolean; armed: string };

        const typeText = (text: string) =>
          obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                text,
              }: { attachmentPath: string; text: string },
            ) => {
              const type = () => {
                const area = pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelector<HTMLElement>(".zt-pdf-text-draft");
                (area! as HTMLInputElement).value = text;
                area!.dispatchEvent(new InputEvent("input", { bubbles: true }));
                return area;
              };
              type();
              return String(true);
            },
            { attachmentPath, text },
          );

        const typeAndEscape = (text: string) =>
          obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                text,
              }: { attachmentPath: string; text: string },
            ) => {
              const type = () => {
                const area = pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelector<HTMLElement>(".zt-pdf-text-draft");
                (area! as HTMLInputElement).value = text;
                area!.dispatchEvent(new InputEvent("input", { bubbles: true }));
                return area;
              };
              type()!.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "Escape",
                  bubbles: true,
                  cancelable: true,
                }),
              );
              return String(true);
            },
            { attachmentPath, text },
          );

        const freshComment = async (before: readonly string[]) => {
          const textKey = await freshAnnotationKey(rdp, {
            item: ATTACHMENT_ITEM,
            before,
          });

          const { annotationType, annotationComment } = await storedAnnotation(
            api,
            serverID,
            textKey,
          );
          return { textKey, annotationType, annotationComment };
        };

        it("creates free text typed on two lines at a click, and stands the tool down at the click", async () => {
          await armText(CLEAR);
          const before = await annotationKeys();

          expect(await click(CLEAR)).toEqual({
            draft: true,
            focused: true,
            armed: "false",
          });
          await typeAndEscape("Two lines\nof text");

          const textKey = await freshAnnotationKey(rdp, {
            item: ATTACHMENT_ITEM,
            before,
          });
          const data = await storedAnnotation(api, serverID, textKey);
          expect(data).toMatchObject({
            annotationType: "text",
            annotationComment: "Two lines\nof text",
          });
          const position = JSON.parse(data.annotationPosition) as {
            pageIndex: number;
            fontSize: number;
            rotation: number;
            rects: number[][];
          };
          expect(position).toMatchObject({
            pageIndex: 0,
            fontSize: 14,
            rotation: 0,
          });
          expect(position.rects, data.annotationPosition).toHaveLength(1);
          const [x, y] = CLEAR;
          const [left, , , top] = position.rects[0]!;
          expect(
            Math.abs(left! - (x - 7)),
            data.annotationPosition,
          ).toBeLessThan(0.1);
          expect(
            Math.abs(top! - (y + 7)),
            data.annotationPosition,
          ).toBeLessThan(0.1);
          expect(data.annotationSortIndex).toBe(
            await recomputedSortIndex(vaultId!, {
              attachmentPath,
              position: data.annotationPosition,
            }),
          );

          let held: { position: string } | null = null;
          expect(
            await waitFor(async () => {
              held = await readerAnnotation({
                rdp,
                attachmentKey: attachment.key,
                annotationKey: textKey,
              });
              return held !== null;
            }),
          ).toBe(true);
          expect(JSON.parse(held!.position)).toEqual(position);

          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                textKey,
              }: { attachmentPath: string; textKey: string },
            ) => {
              const mark = pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(textKey)}]`,
                );
              return {
                lines: mark
                  ? [...mark.children].map((line) => line.textContent)
                  : null,
                draft: !!pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelector<HTMLElement>(".zt-pdf-text-draft"),
              };
            },
            { attachmentPath, textKey },
            {
              ready: (value) =>
                isDeepStrictEqual(value, {
                  lines: ["Two lines", "of text"],
                  draft: false,
                }),
              what: "the typed free text mark to show its two lines and no draft",
            },
          );
        }, 120000);

        it("creates the draft a press elsewhere on the page finishes", async () => {
          await armText(CLEAR);
          const before = await annotationKeys();

          expect((await click(CLEAR)).draft).toBe(true);
          await typeText("Pressed away");
          const [x, y] = CLEAR;
          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                {
                  attachmentPath,
                  pointX,
                  pointY,
                }: { attachmentPath: string; pointX: 150; pointY: number },
              ) => {
                const { fire } = pageHelpers;
                const clientOf = (x: number, y: number) => {
                  const overlay = pageHelpers
                    .pdfView(attachmentPath)!
                    .reader!.pageAt(0)!
                    .div.querySelector<SVGSVGElement>(
                      ".zt-pdf-annotation-overlay",
                    );
                  const box = overlay!.getBoundingClientRect();
                  const view = overlay!.viewBox.baseVal;
                  return {
                    x: box.left + ((x - view.x) * box.width) / view.width,
                    y:
                      box.top +
                      ((view.y + view.height - y) * box.height) / view.height,
                  };
                };
                const at = clientOf(pointX, pointY);
                const node = fire("pointerdown", at.x, at.y);
                const saving = (
                  pageHelpers
                    .pdfView(attachmentPath)!
                    .containerEl.querySelector<HTMLElement>(
                      ".zt-pdf-text-draft",
                    ) as HTMLTextAreaElement
                )?.readOnly;
                fire("pointerup", at.x, at.y, node);
                fire("click", at.x, at.y, node);
                return saving;
              },
              { attachmentPath, pointX: x, pointY: y - 60 },
            ),
          ).toBe(true);

          expect(await freshComment(before)).toMatchObject({
            annotationType: "text",
            annotationComment: "Pressed away",
          });
        }, 120000);

        it("creates the draft its textarea's blur finishes", async () => {
          await armText(CLEAR);
          const before = await annotationKeys();

          expect((await click(CLEAR)).draft).toBe(true);
          await typeText("Blurred");
          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              { attachmentPath }: { attachmentPath: string },
            ) => {
              pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelector<HTMLElement>(".zt-pdf-text-draft")!
                .dispatchEvent(new FocusEvent("blur"));
            },
            { attachmentPath },
          );

          expect(await freshComment(before)).toMatchObject({
            annotationType: "text",
            annotationComment: "Blurred",
          });
        }, 120000);

        it("creates the draft a tool change finishes", async () => {
          await using restore = new AsyncDisposableStack();
          restore.defer(async () => {
            await disarmTool(vaultId!, { attachmentPath, tool: "note" });
          });
          await armText(CLEAR);
          const before = await annotationKeys();

          expect((await click(CLEAR)).draft).toBe(true);
          await typeText("Tool changed");
          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                toolId,
              }: { attachmentPath: string; toolId: "note" },
            ) => {
              const { press } = pageHelpers;
              press(
                pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelector<HTMLElement>(
                    `[data-zt-tool=${JSON.stringify(toolId)}]`,
                  ),
                "Note tool",
              );
            },
            { attachmentPath, toolId: "note" },
          );

          expect(await freshComment(before)).toMatchObject({
            annotationType: "text",
            annotationComment: "Tool changed",
          });
        }, 120000);

        it("creates the draft the PDF view closes on", async () => {
          await armText(CLEAR);
          const before = await annotationKeys();

          expect((await click(CLEAR)).draft).toBe(true);
          await typeText("Closed on");
          await reopenPdfView(vaultId!, attachmentPath);

          expect(await freshComment(before)).toMatchObject({
            annotationType: "text",
            annotationComment: "Closed on",
          });
        }, 120000);

        it("closes the Mark Popup on the saved text with a second Escape", async () => {
          await armText(CLEAR);
          const before = await annotationKeys();

          expect((await click(CLEAR)).draft).toBe(true);
          await typeAndEscape("Escaped");
          const { textKey } = await freshComment(before);

          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                textKey,
              }: { attachmentPath: string; textKey: string },
            ) => {
              const container =
                pageHelpers.pdfView(attachmentPath)!.containerEl;
              const mark = container.querySelector<SVGGraphicsElement>(
                `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(textKey)}]`,
              );
              return {
                selected: !!mark?.classList.contains("is-selected"),
                popup:
                  !!document.querySelector<HTMLElement>(".zt-pdf-mark-popup"),
                draft: !!pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelector<HTMLElement>(".zt-pdf-text-draft"),
                focus: container.contains(document.activeElement),
              };
            },
            { attachmentPath, textKey },
            {
              ready: (value) =>
                isDeepStrictEqual(value, {
                  selected: true,
                  popup: true,
                  draft: false,
                  focus: true,
                }),
              what: "the saved text mark selected under an open Mark Popup",
            },
          );

          await obRun(
            vaultId!,
            async (_context) => {
              document.activeElement!.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "Escape",
                  bubbles: true,
                  cancelable: true,
                }),
              );
            },
            undefined,
          );
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                textKey,
              }: { attachmentPath: string; textKey: string },
            ) => {
              const container =
                pageHelpers.pdfView(attachmentPath)!.containerEl;
              const mark = container.querySelector<SVGGraphicsElement>(
                `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(textKey)}]`,
              );
              return {
                selected: !!mark?.classList.contains("is-selected"),
                popup:
                  !!document.querySelector<HTMLElement>(".zt-pdf-mark-popup"),
                draft: !!pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelector<HTMLElement>(".zt-pdf-text-draft"),
                focus: container.contains(document.activeElement),
              };
            },
            { attachmentPath, textKey },
            {
              ready: (value) =>
                isDeepStrictEqual(value, {
                  selected: false,
                  popup: false,
                  draft: false,
                  focus: true,
                }),
              what: "the Mark Popup to close with the saved text mark deselected",
            },
          );
        }, 120000);

        it("creates nothing from a draft left empty", async () => {
          await armText(CLEAR);
          const before = await annotationKeys();

          expect((await click(CLEAR)).draft).toBe(true);
          await typeAndEscape("");

          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                { attachmentPath }: { attachmentPath: string },
              ) => {
                return !!pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelector<HTMLElement>(".zt-pdf-text-draft");
              },
              { attachmentPath },
            ),
          ).toBe(false);
          expect(await annotationKeys()).toEqual(before);
        }, 120000);

        it("selects the seeded text under a click and creates nothing", async () => {
          await armText([SEED_TEXT[0], 609.393]);
          const before = await annotationKeys();

          expect((await click(SEED_TEXT)).draft).toBe(false);

          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              { attachmentPath }: { attachmentPath: string },
            ) => {
              return [
                ...pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelectorAll<SVGGraphicsElement>(
                    ".zt-pdf-annotation-mark.is-selected",
                  ),
              ].map((mark) => mark.dataset.zoteroAnnotationKey);
            },
            { attachmentPath },
            {
              ready: (value) => isDeepStrictEqual(value, ["HRK7BG32"]),
              what: "only the seeded text HRK7BG32 to be selected in the PDF overlay",
            },
          );
          expect(await annotationKeys()).toEqual(before);
        }, 120000);

        it("creates nothing from a click while editing is not live", async () => {
          await armText(CLEAR);
          const before = await annotationKeys();

          await whileEditingNotLive(async () => {
            expect((await click(CLEAR)).draft).toBe(false);
          });

          expect(await annotationKeys()).toEqual(before);
        }, 120000);

        it("types at the font size picked from the text seat's menu, and keeps the pick over a reopen of the PDF", async () => {
          const textMenu = (pick?: number) =>
            obRun(
              vaultId!,
              (
                { page: pageHelpers },
                {
                  attachmentPath,
                  pick,
                }: { attachmentPath: string; pick: number | null },
              ) => {
                pageHelpers.press(
                  pageHelpers
                    .pdfView(attachmentPath)!
                    .containerEl.querySelector<HTMLElement>(
                      '[data-zt-tool="text-color"]',
                    ),
                  "Text color",
                );
                const items = [
                  ...document.querySelectorAll<HTMLElement>(".menu .menu-item"),
                ];
                const label = items.findIndex((item) =>
                  item.classList.contains("is-label"),
                );
                const word = (item: HTMLElement) =>
                  item.textContent.trim().split(/\s/)[0];
                const checked = items
                  .slice(label + 1)
                  .find((item) => item.querySelector(".mod-checked"));
                if (pick !== null)
                  pageHelpers.press(
                    items
                      .slice(label + 1)
                      .find((item) => word(item) === String(pick)),
                    `colour ${pick}`,
                  );
                return checked ? word(checked) : "none";
              },
              { attachmentPath, pick: pick ?? null },
            );
          const closeMenu = () =>
            obRunUntil(
              vaultId!,
              async (_context) => {
                if (document.querySelector<HTMLElement>(".menu"))
                  document.body.dispatchEvent(
                    new KeyboardEvent("keydown", {
                      key: "Escape",
                      bubbles: true,
                      cancelable: true,
                    }),
                  );
                return document.querySelectorAll<HTMLElement>(".menu").length;
              },
              undefined,
              {
                ready: (value) => value === 0,
                what: "the font size menu to close before the next click",
              },
            );
          await using restore = new AsyncDisposableStack();
          const [nativeMenus, size] = (
            await obRun(
              vaultId!,
              async ({ app, zotlit }) => {
                return JSON.stringify([
                  app.vault.getConfig("nativeMenus"),
                  zotlit.services.bridge.runSync(
                    zotlit.services.settings.current,
                  )["reader.text-font-size"],
                ]);
              },
              undefined,
            ).then((reply) => JSON.parse(reply) as [boolean, number])
          ).map(String);
          restore.defer(async () => {
            await obRun(
              vaultId!,
              async (
                { app, zotlit },
                {
                  size,
                  nativeMenusEnabled,
                }: { size: string | undefined; nativeMenusEnabled: boolean },
              ) => {
                zotlit.services.bridge.runSync(
                  zotlit.services.settings.update({
                    "reader.text-font-size": Number(
                      size,
                    ) as Settings["reader.text-font-size"],
                  }),
                );
                app.vault.setConfig("nativeMenus", nativeMenusEnabled);
              },
              { size, nativeMenusEnabled: nativeMenus === "true" },
            );
          });
          await obRun(
            vaultId!,
            async ({ app }) => {
              app.vault.setConfig("nativeMenus", false);
            },
            undefined,
          );
          const picked = size === "24" ? 18 : 24;
          await armText(CLEAR);

          expect(await textMenu(picked)).toBe(size);

          await reopenPdfView(vaultId!, attachmentPath);
          await armText(CLEAR);
          expect(await textMenu()).toBe(String(picked));
          await closeMenu();
          const before = await annotationKeys();

          expect((await click(CLEAR)).draft).toBe(true);
          await typeAndEscape("Sized");

          const textKey = await freshAnnotationKey(rdp, {
            item: ATTACHMENT_ITEM,
            before,
          });
          const data = await storedAnnotation(api, serverID, textKey);
          expect(
            (JSON.parse(data.annotationPosition) as { fontSize: number })
              .fontSize,
          ).toBe(picked);
        }, 120000);

        it("creates text in the colour picked from the text seat's menu, and draws it that colour darkened five percent", async () => {
          await using restore = new AsyncDisposableStack();
          const [nativeMenus, colors, recent] = await obRun(
            vaultId!,
            async (
              { app, zotlit },
              {
                annotationColorsKey,
                recentColorsKey,
              }: {
                annotationColorsKey: "reader.annotation-colors";
                recentColorsKey: "reader.recent-colors";
              },
            ) => {
              return JSON.stringify([
                app.vault.getConfig("nativeMenus"),
                zotlit.services.bridge.runSync(
                  zotlit.services.settings.current,
                )[annotationColorsKey] ?? null,
                zotlit.services.bridge.runSync(
                  zotlit.services.settings.current,
                )[recentColorsKey] ?? null,
              ]);
            },
            {
              annotationColorsKey: "reader.annotation-colors",
              recentColorsKey: "reader.recent-colors",
            },
          ).then(
            (reply) =>
              JSON.parse(reply) as [
                boolean,
                Settings["reader.annotation-colors"] | null,
                Settings["reader.recent-colors"] | null,
              ],
          );
          restore.defer(async () => {
            await obRun(
              vaultId!,
              async (
                { app, zotlit },
                {
                  colors,
                  recent,
                  nativeMenus,
                }: {
                  colors: {
                    highlight?: string | undefined;
                    note?: string | undefined;
                    image?: string | undefined;
                    ink?: string | undefined;
                    underline?: string | undefined;
                    text?: string | undefined;
                  } | null;
                  recent: string[] | null;
                  nativeMenus: boolean;
                },
              ) => {
                zotlit.services.bridge.runSync(
                  zotlit.services.settings.update({
                    "reader.annotation-colors": colors ?? undefined,
                    "reader.recent-colors": recent ?? undefined,
                  }),
                );
                app.vault.setConfig("nativeMenus", nativeMenus);
              },
              { colors, recent, nativeMenus },
            );
          });
          await obRun(
            vaultId!,
            async ({ app }) => {
              app.vault.setConfig("nativeMenus", false);
            },
            undefined,
          );
          const green = "#5fb236";
          await armText(CLEAR);

          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                {
                  attachmentPath,
                  green,
                }: { attachmentPath: string; green: "#5fb236" },
              ) => {
                const { press } = pageHelpers;
                press(
                  pageHelpers
                    .pdfView(attachmentPath)!
                    .containerEl.querySelector<HTMLElement>(
                      '[data-zt-tool="text-color"]',
                    ),
                  "Text color",
                );
                const item = [
                  ...document.querySelectorAll<HTMLElement>(".menu .menu-item"),
                ].find((one) =>
                  one.querySelector<HTMLElement>(
                    `[style*=${JSON.stringify(green)}]`,
                  ),
                );
                press(item, "Green");
                return !!item;
              },
              { attachmentPath, green },
            ),
          ).toBe(true);
          await obRunUntil(
            vaultId!,
            async (_context) => {
              return document.querySelectorAll<HTMLElement>(".menu").length;
            },
            undefined,
            {
              ready: (value) => value === 0,
              what: "the color menu to close before the text is created",
            },
          );
          const before = await annotationKeys();

          expect((await click(CLEAR)).draft).toBe(true);
          await typeAndEscape("Green");

          const textKey = await freshAnnotationKey(rdp, {
            item: ATTACHMENT_ITEM,
            before,
          });
          expect(
            (await storedAnnotation(api, serverID, textKey)).annotationColor,
          ).toBe(green);
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                textKey,
              }: { attachmentPath: string; textKey: string },
            ) => {
              return pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(textKey)}]`,
                )
                ?.getAttribute("fill");
            },
            { attachmentPath, textKey },
            {
              ready: (value) => value === "#5aa933",
              what: "the saved text mark's fill to darken to #5aa933",
            },
          );
        }, 120000);
      });

      describe("free text on the first page", () => {
        let held: readonly string[] = [];
        beforeAll(async () => {
          held = await annotationKeys();
        });

        afterEach(async () => {
          await eraseAnnotations(rdp, await madeSince(held));
        });

        it("wraps seeded free text to its box width using the display font", async () => {
          await raiseWindow(vaultId!);
          const { position, comment } = seededMark("HRK7BG32", {
            image: false,
          }).seeded;
          if (!("fontSize" in position) || !comment)
            throw new Error("HRK7BG32 is text");
          const [left, , right] = position.rects[0]!;
          const width = right - left;
          const evidence = await obRunUntil(
            vaultId!,
            async ({ page }, { attachmentPath, width, fontSize }) => {
              const view = page.pdfView(attachmentPath);
              if (!view) return null;
              void view.reader!.navigate({ pageIndex: 0 });
              const mark = view.containerEl.querySelector<SVGTextElement>(
                '.zt-pdf-annotation-mark[data-zotero-annotation-key="HRK7BG32"]',
              );
              if (!mark) return null;
              const lines = [...mark.querySelectorAll("tspan")].map((line) => ({
                text: line.textContent,
                width: line.getComputedTextLength(),
              }));
              if (lines.length === 0 || lines.some((line) => line.width === 0))
                return null;

              const document = mark.ownerDocument;
              const family = getComputedStyle(document.body).fontFamily;
              const font = getComputedStyle(mark);
              const canvas = document.createElement("canvas").getContext("2d")!;
              canvas.font = `${fontSize}px ${family}`;
              const earlyBreaks = lines
                .slice(0, -1)
                .filter(({ text }, index) => {
                  const nextWord = lines[index + 1]!.text.split(" ")[0];
                  return (
                    canvas.measureText(`${text} ${nextWord}`).width <= width
                  );
                });
              return {
                lines,
                earlyBreaks,
                fontSize: Number.parseFloat(font.fontSize),
                usesDisplayFont: font.fontFamily === family,
              };
            },
            { attachmentPath, width, fontSize: position.fontSize },
            { ready: (value) => value !== null, what: "the seeded text mark" },
          );
          expect(evidence!.usesDisplayFont).toBe(true);
          expect(evidence!.fontSize).toBe(position.fontSize);
          expect(evidence!.lines.map(({ text }) => text).join(" ")).toBe(
            comment,
          );
          expect(evidence!.earlyBreaks).toEqual([]);
          for (const line of evidence!.lines)
            expect(line.width).toBeLessThanOrEqual(width);
        }, 120000);

        it("draws a two-line text Annotation from Zotero as two lines", async () => {
          await raiseWindow(vaultId!);
          const before = await heldAnnotationKeys(rdp, ATTACHMENT_ITEM);
          const apiKey = await obRun(
            vaultId!,
            async ({ app }) => {
              return JSON.parse(
                app.secretStorage.getSecret(
                  "zotlit-zotero-write-authorization",
                )!,
              ).key;
            },
            undefined,
          );
          const written = await zoteroFetch(api, "users/0/items", {
            method: "POST",
            headers: {
              "Zotero-Server-ID": serverID,
              "Zotero-API-Key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify([
              {
                annotationType: "text",
                itemType: "annotation",
                parentItem: attachment.key,
                annotationComment: "Two\nlines",
                annotationColor: "#ff6666",
                annotationPageLabel: "1",
                annotationSortIndex: "00000|000000|00602",
                annotationPosition: JSON.stringify({
                  pageIndex: 0,
                  fontSize: 14,
                  rotation: 0,
                  rects: [[60, 150, 200, 190]],
                }),
              },
            ]),
          });
          expect(written.status).toBe(200);
          const textKey = await freshAnnotationKey(rdp, {
            item: ATTACHMENT_ITEM,
            before,
          });
          await obRun(
            vaultId!,
            async (
              { zotlit },
              { attachmentKey }: { attachmentKey: string },
            ) => {
              await zotlit.services.bridge.runPromise(
                zotlit.services.annotationRepository.refresh(attachmentKey),
              );
            },
            { attachmentKey: attachment.key },
          );

          let lines: [string, string, number][] = [];
          expect(
            await waitFor(async () => {
              const answer = await obRun(
                vaultId!,
                async (
                  { page: pageHelpers },
                  {
                    attachmentPath,
                    textKey,
                  }: { attachmentPath: string; textKey: string },
                ) => {
                  const view = pageHelpers.pdfView(attachmentPath)!;
                  if (!view) return "no view";
                  void view.reader!.navigate({ pageIndex: 0 });
                  const mark =
                    view.containerEl.querySelector<SVGGraphicsElement>(
                      `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(textKey)}]`,
                    );
                  if (!mark) return "none";
                  return JSON.stringify(
                    [...mark.children].map((line) => [
                      line.textContent,
                      Number(line.getAttribute("y")).toFixed(3),
                      Number(
                        (line as SVGTextContentElement)
                          .getComputedTextLength()
                          .toFixed(3),
                      ),
                    ]),
                  );
                },
                { attachmentPath, textKey },
              );
              if (!answer.startsWith("[")) return false;
              lines = JSON.parse(answer) as typeof lines;
              return lines.length > 0;
            }),
          ).toBe(true);
          expect(lines.map(([line]) => line)).toEqual(["Two", "lines"]);
          expect(Number(lines[1]![1]) - Number(lines[0]![1])).toBeCloseTo(
            16.8,
            3,
          );
        }, 120000);
      });

      registerPdfUnchangedCase();
    },
  );
});
