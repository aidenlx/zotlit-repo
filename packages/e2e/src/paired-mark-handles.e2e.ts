import { isDeepStrictEqual } from "node:util";
import type { FileView } from "obsidian";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { ATTACHMENTS } from "@zotlit/scripts/fixture";

import { obRun, obRunUntil, waitFor } from "./obsidian-cli.ts";
import type { PagePdfReaderView } from "./page-notes-types.ts";
import {
  pressKey,
  rdp,
  readerTabID,
  redoKey,
  registerPairedReaderSession,
  registerPdfUnchangedCase,
  seededMark,
  setReaderTabID,
  stepSettled,
  undoKey,
} from "./paired-reader-session.ts";
import {
  ATTACHMENT_ITEM,
  api,
  attachment,
  attachmentPath,
  baseUrl,
  closeZoteroReader,
  debuggerPort,
  isZoteroReaderOpen,
  m,
  openZoteroReader,
  registerPairedRun,
  restoreAnnotationComment,
  serverID,
  setLocalApi,
  vaultId,
} from "./paired-run-fixture.ts";
import { eraseAnnotations } from "./paired-zotero.ts";
import {
  expectEditorKeepsSelections,
  raiseWindow,
  recomputedSortIndex,
  reopenPdfView,
  watchExcerptPixels,
} from "./reader-gestures.ts";
import { READER_VIEW_TYPE } from "./reader-handle.ts";

describe.skipIf(!baseUrl)("Paired Run", () => {
  registerPairedRun();

  describe.skipIf(!debuggerPort || !vaultId)(
    "ZotLit and Zotero on one Fixture",
    () => {
      registerPairedReaderSession();

      async function dragPointer(
        from: { x: number; y: number },
        to: { x: number; y: number },
      ): Promise<void> {
        await obRun(
          vaultId!,
          async (
            { page: pageHelpers },
            {
              attachmentPath,
              x,
              y,
              midX,
              midY,
              toX,
              toY,
            }: {
              attachmentPath: string;
              x: number;
              y: number;
              midX: number;
              midY: number;
              toX: number;
              toY: number;
            },
          ) => {
            const { fire } = pageHelpers;
            const container = pageHelpers.pdfView(attachmentPath)!.containerEl;
            fire("pointerdown", x, y);
            fire("pointermove", midX, midY, container);
            fire("pointermove", toX, toY, container);
            fire("pointerup", toX, toY, container);
            fire("click", toX, toY, container);
          },
          {
            attachmentPath,
            x: from.x,
            y: from.y,
            midX: (from.x + to.x) / 2,
            midY: (from.y + to.y) / 2,
            toX: to.x,
            toY: to.y,
          },
        );
      }

      const rectIs = (
        position: string,
        expected: readonly number[],
        tolerance = 5e-4,
      ) => {
        const [rect] = (JSON.parse(position) as { rects: number[][] }).rects;
        return (
          rect?.length === 4 &&
          rect.every(
            (value, index) => Math.abs(value - expected[index]!) < tolerance,
          )
        );
      };

      it("saves a Geometry Edit on the seeded image through one repository write", async () => {
        const imageKey = "FDRFQ7C2";
        const image = seededMark(imageKey, { image: true });
        await using revert = new AsyncDisposableStack();
        revert.defer(image.restore);

        const edited = {
          pageIndex: 1,
          rects: [[48.75, 395.509, 610, 703.723] as const],
        };
        const outcome = await obRun(
          vaultId!,
          async (
            { zotlit },
            {
              attachmentPath,
              position,
              imageKey,
            }: {
              attachmentPath: string;
              position: {
                pageIndex: number;
                rects: (readonly [48.75, 395.509, 610, 703.723])[];
              };
              imageKey: "FDRFQ7C2";
            },
          ) => {
            const s = zotlit.services;
            const binding = s.bridge
              .runSync(s.pdfAnnotationEditor.bindings)
              .find((b) => b.filePath === attachmentPath);
            const announced: string[] = [];
            const off = s.bridge.subscribe(
              s.annotationRepository.excerptPixelsChanged,
              ({ record }) => announced.push(record.key),
            );
            try {
              const sortIndex = await binding!.sortIndex(position);
              const state = await s.bridge.runPromise(
                s.annotationRepository.patchGeometry(
                  imageKey,
                  { position, sortIndex: sortIndex! },
                  "pointer",
                ),
              );
              return { sortIndex, state: { kind: state.kind }, announced };
            } finally {
              off();
            }
          },
          { attachmentPath, position: edited, imageKey },
        );
        expect(outcome.state.kind).toBe("idle");
        expect(outcome.announced).toEqual([imageKey]);

        const stored = await image.stored();
        expect(JSON.parse(stored.data.annotationPosition)).toEqual(edited);
        expect(stored.data.annotationSortIndex).toBe(outcome.sortIndex);
        expect(stored.data.annotationSortIndex).toMatch(
          /^\d{5}\|\d{6}\|\d{5}$/,
        );
        expect(stored.data.annotationSortIndex).not.toBe(
          image.seed.annotationSortIndex,
        );

        expect(
          await waitFor(
            async () =>
              (await image.held())?.position === JSON.stringify(edited),
          ),
        ).toBe(true);

        await obRun(
          vaultId!,
          async (
            { app, page },
            { attachmentPath }: { attachmentPath: string },
          ) => {
            const leaf = app.workspace
              .getLeavesOfType(page.reader.viewType)
              .find(
                ({ view }) => (view as FileView).file?.path === attachmentPath,
              );
            await (leaf!.view as PagePdfReaderView).reader?.navigate({
              pageIndex: 1,
            });
          },
          { attachmentPath },
        );
        await obRunUntil(
          vaultId!,
          async ({ app, page }, { imageKey }: { imageKey: "FDRFQ7C2" }) => {
            const mark = app.workspace
              .getLeavesOfType(page.reader.viewType)
              .map(({ view }) =>
                view.containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(imageKey)}]`,
                ),
              )
              .find(Boolean);
            return mark
              ? [
                  mark.getAttribute("width"),
                  Number(mark.getAttribute("height")).toFixed(3),
                ].join(" ")
              : "none";
          },
          { imageKey },
          {
            ready: (value) => value === "561.25 308.214",
            what: "the seeded image mark FDRFQ7C2 to show its saved width and height",
          },
        );
      }, 120000);

      describe("Mark Handles on the seeded image", () => {
        const imageKey = "FDRFQ7C2";
        const image = seededMark(imageKey, { image: true });

        async function selectImage(): Promise<{
          x: number;
          y: number;
          perX: number;
          perY: number;
        }> {
          await image.settled();
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                imageKey,
              }: { attachmentPath: string; imageKey: "FDRFQ7C2" },
            ) => {
              const view = pageHelpers.pdfView(attachmentPath)!;
              if (!view) return "no view";
              void view.reader!.navigate({ pageIndex: 1 });
              const rect = pageHelpers
                .pdfView(attachmentPath)
                ?.containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(imageKey)}]`,
                )
                ?.getBoundingClientRect();
              return !!rect && rect.width > 0;
            },
            { attachmentPath, imageKey },
            { what: "the seeded image's PDF mark to be laid out on page 2" },
          );
          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                imageKey,
              }: { attachmentPath: string; imageKey: "FDRFQ7C2" },
            ) => {
              const { tap } = pageHelpers;
              const mark = pageHelpers
                .pdfView(attachmentPath)
                ?.containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(imageKey)}]`,
                );
              if (mark!.classList.contains("is-selected")) return "selected";
              const rect = mark!.getBoundingClientRect();
              const x = rect.left + rect.width / 2,
                y = rect.top + rect.height / 2;
              tap(x, y);
              return "clicked";
            },
            { attachmentPath, imageKey },
          );
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              { attachmentPath }: { attachmentPath: string },
            ) => {
              return pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelectorAll<HTMLElement>(
                  ".zt-pdf-annotation-handle",
                ).length;
            },
            { attachmentPath },
            {
              ready: (value) => value === 8,
              what: "the eight Mark Handles to render on the seeded image",
            },
          );

          let last = "";
          expect(
            await waitFor(async () => {
              const next = await obRun(
                vaultId!,
                async (
                  { page: pageHelpers },
                  {
                    attachmentPath,
                    imageKey,
                  }: { attachmentPath: string; imageKey: "FDRFQ7C2" },
                ) => {
                  const view = pageHelpers.pdfView(attachmentPath)!;
                  const node = view.containerEl.querySelector<HTMLElement>(
                    '.zt-pdf-annotation-handle[data-zt-grip="br"]',
                  );
                  node!.scrollIntoView({ block: "nearest", inline: "nearest" });
                  const handle = node!.getBoundingClientRect();
                  const x = handle.left + handle.width / 2,
                    y = handle.top + handle.height / 2;
                  const overlay = pageHelpers
                    .pdfView(attachmentPath)
                    ?.containerEl.querySelector<SVGGraphicsElement>(
                      `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(imageKey)}]`,
                    )!.ownerSVGElement;
                  return JSON.stringify({
                    x,
                    y,
                    perX:
                      overlay!.getBoundingClientRect().width /
                      overlay!.viewBox.baseVal.width,
                    perY:
                      overlay!.getBoundingClientRect().height /
                      overlay!.viewBox.baseVal.height,
                    onTop: document.elementFromPoint(x, y) === node,
                  });
                },
                { attachmentPath, imageKey },
              );
              const still =
                next === last && (JSON.parse(next) as { onTop: boolean }).onTop;
              last = next;
              return still;
            }),
            last,
          ).toBe(true);
          return JSON.parse(last) as {
            x: number;
            y: number;
            perX: number;
            perY: number;
          };
        }

        const conflictShown = async () =>
          (await obRun(
            vaultId!,
            async ({ app }, { imageKey }: { imageKey: "FDRFQ7C2" }) => {
              const panel = app.workspace
                .getLeavesOfType("zotero-annotation-view")
                .map(({ view }) =>
                  view.containerEl.querySelector<HTMLElement>(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(imageKey)}]`,
                  ),
                )
                .find(Boolean)
                ?.querySelector<HTMLElement>(".zt-annot-conflict");
              if (!panel || panel.getBoundingClientRect().width === 0)
                return "none";
              return String(
                panel.textContent.includes(
                  "The annotation's position changed in Zotero.",
                ) &&
                  [...panel.querySelectorAll<HTMLElement>("button")].some(
                    (node) => node.textContent === "Apply again",
                  ),
              );
            },
            { imageKey },
          )) === "true";

        beforeAll(async () => {
          await closeZoteroReader(rdp, readerTabID);
          setReaderTabID(await openZoteroReader(rdp));
          await image.restore();
          await raiseWindow(vaultId!);
        });

        afterEach(image.restore);

        it("keeps the popup's comment editor open through a selection and a menu pick inside it", async () => {
          await selectImage();
          await obRunUntil(
            vaultId!,
            async (
              _context,
              { placeholderText }: { placeholderText: string },
            ) => {
              const popup =
                document.querySelector<HTMLElement>(".zt-pdf-mark-popup");
              return (
                popup?.querySelector<HTMLElement>(".zt-annot-comment-field")
                  ?.textContent === placeholderText &&
                !popup.querySelector<HTMLElement>('[data-zt-verb="comment"]')
              );
            },
            { placeholderText: m.annot_view_card_comment_placeholder() },
            {
              what: "the Mark Popup comment field to show its placeholder and no comment verb",
            },
          );
          await obRun(
            vaultId!,
            async ({ page: pageHelpers }) => {
              const { press } = pageHelpers;
              getSelection()!.removeAllRanges();
              press(
                document.querySelector<HTMLElement>(
                  ".zt-pdf-mark-popup .zt-annot-comment-field",
                ),
                "comment field",
              );
            },
            undefined,
          );
          await obRunUntil(
            vaultId!,
            async ({ page: pageHelpers }) => {
              return !!pageHelpers.popupEditor();
            },
            undefined,
            { what: "the Mark Popup comment editor to open on a click" },
          );
          const key = await obRun(
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
          try {
            await expectEditorKeepsSelections(vaultId!);
          } finally {
            await obRun(
              vaultId!,
              async ({ page: pageHelpers }) => {
                const { fire } = pageHelpers;
                const box = document
                  .querySelector<HTMLElement>(".workspace-ribbon")!
                  .getBoundingClientRect();
                fire("pointerdown", box.left + 2, box.top + 2);
              },
              undefined,
            );
            let closeFailure: unknown;
            try {
              await obRunUntil(
                vaultId!,
                async ({ page: pageHelpers }) => {
                  return !!pageHelpers.popupEditor();
                },
                undefined,
                {
                  ready: (value) => value === false,
                  what: "the Mark Popup comment editor to close",
                },
              );
            } catch (error) {
              closeFailure = error;
            }
            await image.settled();
            await restoreAnnotationComment(api, {
              serverID,
              key,
              annotationKey: imageKey,
              comment: "",
            });
            if (closeFailure)
              // oxlint-disable-next-line no-unsafe-finally -- the close failure must surface after the comment is restored
              throw closeFailure instanceof Error
                ? closeFailure
                : new Error("The Mark Popup comment editor failed to close", {
                    cause: closeFailure,
                  });
          }
        });

        it("resizes the image from its bottom-right handle and saves on release", async () => {
          const handle = await selectImage();
          const { version } = await image.stored();
          await using pixels = await watchExcerptPixels(vaultId!);
          const to = {
            x: handle.x + 20 * handle.perX,
            y: handle.y + 30 * handle.perY,
          };
          const pressed = await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                x,
                y,
                attachmentPath,
                midpointX,
                midpointY,
                targetX,
                targetY,
              }: {
                x: number;
                y: number;
                attachmentPath: string;
                midpointX: number;
                midpointY: number;
                targetX: number;
                targetY: number;
              },
            ) => {
              const { fire } = pageHelpers;
              const node = fire("pointerdown", x, y);
              const container =
                pageHelpers.pdfView(attachmentPath)!.containerEl;
              fire("pointermove", midpointX, midpointY, container);
              fire("pointermove", targetX, targetY, container);
              return {
                grip: (node as HTMLElement | SVGElement).dataset.ztGrip,
                popup:
                  !!document.querySelector<HTMLElement>(".zt-pdf-mark-popup"),
              };
            },
            {
              x: handle.x,
              y: handle.y,
              attachmentPath,
              midpointX: (handle.x + to.x) / 2,
              midpointY: (handle.y + to.y) / 2,
              targetX: to.x,
              targetY: to.y,
            },
          );
          expect(pressed).toEqual({ grip: "br", popup: false });
          expect((await image.stored()).version).toBe(version);

          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                x,
                y,
              }: { attachmentPath: string; x: number; y: number },
            ) => {
              const { fire } = pageHelpers;
              const container =
                pageHelpers.pdfView(attachmentPath)!.containerEl;
              fire("pointerup", x, y, container);
              fire("click", x, y, container);
            },
            { attachmentPath, x: to.x, y: to.y },
          );

          const expected = [48.75, 365.509, 590, 743.723];
          expect(
            await waitFor(async () =>
              rectIs(
                (await image.stored()).data.annotationPosition,
                expected,
                0.005,
              ),
            ),
          ).toBe(true);
          await image.settled();
          const stored = await image.stored();
          const position = JSON.parse(stored.data.annotationPosition) as {
            pageIndex: number;
            rects: number[][];
          };
          expect(position.pageIndex).toBe(1);
          expect(position.rects, stored.data.annotationPosition).toHaveLength(
            1,
          );
          position.rects[0]!.forEach((value, index) =>
            expect(value, stored.data.annotationPosition).toBeCloseTo(
              expected[index]!,
              2,
            ),
          );
          expect(stored.data.annotationSortIndex).toBe(
            await recomputedSortIndex(vaultId!, {
              attachmentPath,
              position: stored.data.annotationPosition,
            }),
          );

          expect(
            await waitFor(
              async () =>
                (await image.held())?.position ===
                stored.data.annotationPosition,
            ),
          ).toBe(true);

          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                imageKey,
                expectedWidth,
              }: {
                attachmentPath: string;
                imageKey: "FDRFQ7C2";
                expectedWidth: string;
              },
            ) => {
              return (
                Math.abs(
                  Number(
                    pageHelpers
                      .pdfView(attachmentPath)
                      ?.containerEl.querySelector<SVGGraphicsElement>(
                        `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(imageKey)}]`,
                      )
                      ?.getAttribute("width"),
                  ) - Number(expectedWidth),
                ) < 0.001
              );
            },
            {
              attachmentPath,
              imageKey,
              expectedWidth: (
                position.rects[0]![2]! - position.rects[0]![0]!
              ).toFixed(3),
            },
            {
              what: "the seeded image's PDF mark width to match the resized width",
            },
          );
          await expect
            .poll(() => pixels.keys(), { timeout: 10_000 })
            .toContain(imageKey);
        }, 120000);

        it("puts the image's geometry back for the undo key, and drags it out again for redo", async () => {
          await reopenPdfView(vaultId!, attachmentPath);
          const handle = await selectImage();
          await dragPointer(handle, {
            x: handle.x + 20 * handle.perX,
            y: handle.y + 30 * handle.perY,
          });
          expect(
            await waitFor(
              async () =>
                !isDeepStrictEqual(
                  JSON.parse((await image.stored()).data.annotationPosition),
                  image.seeded.position,
                ),
            ),
          ).toBe(true);
          await image.settled();
          const dragged = (await image.stored()).data;

          expect(await undoKey()).toEqual({ handled: true });
          await stepSettled();

          expect(
            await waitFor(
              async () =>
                (await image.stored()).data.annotationPosition ===
                image.seed.annotationPosition,
            ),
          ).toBe(true);
          await image.settled();
          expect((await image.stored()).data.annotationSortIndex).toBe(
            image.seed.annotationSortIndex,
          );
          expect(
            await waitFor(
              async () =>
                (await image.held())?.position ===
                image.seed.annotationPosition,
            ),
          ).toBe(true);
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                imageKey,
              }: { attachmentPath: string; imageKey: "FDRFQ7C2" },
            ) => {
              return !!pageHelpers
                .pdfView(attachmentPath)
                ?.containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(imageKey)}]`,
                )
                ?.classList.contains("is-selected");
            },
            { attachmentPath, imageKey },
            {
              what: "the seeded image mark FDRFQ7C2 to be selected after the undo or redo",
            },
          );

          expect(await redoKey()).toEqual({ handled: true });
          await stepSettled();

          expect(
            await waitFor(
              async () =>
                (await image.stored()).data.annotationPosition ===
                dragged.annotationPosition,
            ),
          ).toBe(true);
          expect((await image.stored()).data.annotationSortIndex).toBe(
            dragged.annotationSortIndex,
          );
        }, 120000);

        it("writes nothing for a handle released where it was pressed", async () => {
          const handle = await selectImage();
          const { version } = await image.stored();

          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                x,
                y,
                attachmentPath,
              }: { x: number; y: number; attachmentPath: string },
            ) => {
              const { fire } = pageHelpers;
              const node = fire("pointerdown", x, y);
              fire(
                "pointerup",
                x,
                y,
                pageHelpers.pdfView(attachmentPath)!.containerEl,
              );
              fire("click", x, y, node);
            },
            { x: handle.x, y: handle.y, attachmentPath },
          );

          await image.settled();
          const stored = await image.stored();
          expect(stored.version).toBe(version);
          expect(stored.data.annotationPosition).toBe(
            image.seed.annotationPosition,
          );
          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                {
                  attachmentPath,
                  imageKey,
                }: { attachmentPath: string; imageKey: "FDRFQ7C2" },
              ) => {
                return String(
                  pageHelpers
                    .pdfView(attachmentPath)
                    ?.containerEl.querySelector<SVGGraphicsElement>(
                      `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(imageKey)}]`,
                    )!
                    .classList.contains("is-selected"),
                );
              },
              { attachmentPath, imageKey },
            ),
          ).toBe("true");
        }, 120000);

        it("draws no handle and writes nothing while editing is not live", async () => {
          const before = await selectImage();
          const { version } = await image.stored();
          await using restoreLocalApi = new AsyncDisposableStack();
          restoreLocalApi.defer(async () => {
            await setLocalApi(rdp, true);
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
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              { attachmentPath }: { attachmentPath: string },
            ) => {
              return pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelectorAll<HTMLElement>(
                  ".zt-pdf-annotation-handle",
                ).length;
            },
            { attachmentPath },
            {
              ready: (value) => value === 0,
              what: "the Mark Handles on the seeded image to be removed",
            },
          );

          const to = {
            x: before.x + 20 * before.perX,
            y: before.y + 30 * before.perY,
          };
          const outcome = await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                imageKey,
                x,
                y,
                targetX,
                targetY,
              }: {
                attachmentPath: string;
                imageKey: "FDRFQ7C2";
                x: number;
                y: number;
                targetX: number;
                targetY: number;
              },
            ) => {
              const { fire } = pageHelpers;
              const width = pageHelpers
                .pdfView(attachmentPath)
                ?.containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(imageKey)}]`,
                )!
                .getAttribute("width");
              const node = fire("pointerdown", x, y);
              const container =
                pageHelpers.pdfView(attachmentPath)!.containerEl;
              fire("pointermove", targetX, targetY, container);
              fire("pointerup", targetX, targetY, container);
              return {
                width: String(
                  Number(
                    pageHelpers
                      .pdfView(attachmentPath)
                      ?.containerEl.querySelector<SVGGraphicsElement>(
                        `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(imageKey)}]`,
                      )!
                      .getAttribute("width"),
                  ) === Number(width),
                ),
                body:
                  (node as HTMLElement | SVGElement).dataset?.ztGrip === "body",
              };
            },
            {
              attachmentPath,
              imageKey,
              x: before.x,
              y: before.y,
              targetX: to.x,
              targetY: to.y,
            },
          );
          expect(outcome).toEqual({ width: "true", body: false });

          await restoreLocalApi.disposeAsync();
          expect((await image.stored()).version).toBe(version);
        }, 120000);

        it("widens the image by five points for Shift+ArrowRight", async () => {
          await selectImage();
          const { version } = await image.stored();

          expect(await pressKey("ArrowRight", { shiftKey: true })).toEqual({
            prevented: true,
          });

          const expected = [48.75, 395.509, 575, 743.723];
          let stored = await image.stored();
          expect(
            await waitFor(async () => {
              stored = await image.stored();
              return (
                rectIs(stored.data.annotationPosition, expected) &&
                stored.version > version
              );
            }),
          ).toBe(true);
          expect(stored.version).toBeGreaterThan(version);
          expect(stored.data.annotationSortIndex).toBe(
            await recomputedSortIndex(vaultId!, {
              attachmentPath,
              position: stored.data.annotationPosition,
            }),
          );

          expect(
            await waitFor(
              async () =>
                (await image.held())?.position ===
                stored.data.annotationPosition,
            ),
          ).toBe(true);
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                imageKey,
              }: { attachmentPath: string; imageKey: "FDRFQ7C2" },
            ) => {
              return (
                Math.abs(
                  Number(
                    pageHelpers
                      .pdfView(attachmentPath)
                      ?.containerEl.querySelector<SVGGraphicsElement>(
                        `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(imageKey)}]`,
                      )
                      ?.getAttribute("width"),
                  ) - 526.25,
                ) < 0.001
              );
            },
            { attachmentPath, imageKey },
            {
              what: "the image mark FDRFQ7C2 to widen to 526.25 wide in the PDF view",
            },
          );
        }, 120000);

        it("nudges the image five points down for Alt+ArrowDown, with the Sort Index of its new top", async () => {
          await selectImage();

          expect(await pressKey("ArrowDown", { altKey: true })).toEqual({
            prevented: true,
          });

          const expected = [48.75, 390.509, 570, 738.723];
          expect(
            await waitFor(async () =>
              rectIs((await image.stored()).data.annotationPosition, expected),
            ),
          ).toBe(true);
          const stored = await image.stored();
          expect(stored.data.annotationSortIndex).not.toBe(
            image.seed.annotationSortIndex,
          );
          expect(stored.data.annotationSortIndex).toBe(
            await recomputedSortIndex(vaultId!, {
              attachmentPath,
              position: stored.data.annotationPosition,
            }),
          );
        }, 120000);

        it("lands a conflicted Geometry Edit against Zotero's fresh version when applied again", async () => {
          await using teardown = new AsyncDisposableStack();
          teardown.defer(async () => {
            await obRun(
              vaultId!,
              async ({ zotlit }, { imageKey }: { imageKey: "FDRFQ7C2" }) => {
                const { annotationRepository: repository, bridge } =
                  zotlit.services;
                if (
                  bridge.runSync(repository.mutationFor(imageKey)).kind ===
                  "conflict"
                )
                  bridge.runSync(repository.discardConflict(imageKey));
              },
              { imageKey },
            );
          });
          const handle = await selectImage();
          const to = { x: handle.x + 20 * handle.perX, y: handle.y };
          const attempted = [48.75, 395.509, 590, 743.723];
          const pressed = await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                x,
                y,
                targetX,
                targetY,
                attachmentPath,
              }: {
                x: number;
                y: number;
                targetX: number;
                targetY: number;
                attachmentPath: string;
              },
            ) => {
              const { fire } = pageHelpers;
              const node = fire("pointerdown", x, y);
              fire(
                "pointermove",
                targetX,
                targetY,
                pageHelpers.pdfView(attachmentPath)!.containerEl,
              );
              return {
                grip: (node as HTMLElement | SVGElement).dataset.ztGrip,
              };
            },
            {
              x: handle.x,
              y: handle.y,
              targetX: to.x,
              targetY: to.y,
              attachmentPath,
            },
          );
          expect(pressed).toEqual({ grip: "br" });

          const fresh = [60, 395.509, 570, 743.723];
          await rdp.json<boolean>(`(async () => {
            const attachment = ${ATTACHMENT_ITEM};
            const item = Zotero.Items.getByLibraryAndKey(
              attachment.libraryID,
              ${JSON.stringify(imageKey)},
            );
            item.annotationPosition = JSON.stringify({ pageIndex: 1, rects: [${JSON.stringify(fresh)}] });
            await item.saveTx();
            return true;
          })()`);
          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                x,
                y,
              }: { attachmentPath: string; x: number; y: number },
            ) => {
              const { fire } = pageHelpers;
              const container =
                pageHelpers.pdfView(attachmentPath)!.containerEl;
              fire("pointerup", x, y, container);
              fire("click", x, y, container);
            },
            { attachmentPath, x: to.x, y: to.y },
          );
          const changed = await image.stored();
          expect(rectIs(changed.data.annotationPosition, fresh)).toBe(true);

          expect(await waitFor(conflictShown)).toBe(true);
          expect(
            rectIs((await image.stored()).data.annotationPosition, fresh),
          ).toBe(true);

          let landed = false;
          for (let attempt = 0; attempt < 3 && !landed; attempt++) {
            await image.settled();
            const before = (await image.stored()).version;
            expect(
              await obRun(
                vaultId!,
                async (
                  { app, page: pageHelpers },
                  { imageKey }: { imageKey: "FDRFQ7C2" },
                ) => {
                  const { press } = pageHelpers;
                  const button = [
                    ...(app.workspace
                      .getLeavesOfType("zotero-annotation-view")
                      .map(({ view }) =>
                        view.containerEl.querySelector<HTMLElement>(
                          `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(imageKey)}]`,
                        ),
                      )
                      .find(Boolean)
                      ?.querySelectorAll<HTMLElement>(
                        ".zt-annot-conflict button",
                      ) ?? []),
                  ].find(
                    (node) =>
                      node.getBoundingClientRect().width > 0 &&
                      node.textContent === "Apply again",
                  );
                  if (!button) return "no button";
                  press(button, "Apply again");
                  return "applied";
                },
                { imageKey },
              ),
            ).toBe("applied");
            expect(
              await waitFor(async () => {
                const stored = await image.stored();
                if (stored.version <= before) return false;
                landed = rectIs(stored.data.annotationPosition, attempted);
                return landed || (await conflictShown());
              }),
            ).toBe(true);
          }
          expect(landed).toBe(true);
          expect(await waitFor(async () => !(await conflictShown()))).toBe(
            true,
          );
          expect((await image.stored()).version).toBeGreaterThan(
            changed.version,
          );
        }, 180000);
      });

      it("keeps the create popup's comment sheet open through a selection and a menu pick inside it", async () => {
        await raiseWindow(vaultId!);

        await obRunUntil(
          vaultId!,
          async (
            { page: pageHelpers },
            { attachmentPath }: { attachmentPath: string },
          ) => {
            const view = pageHelpers.pdfView(attachmentPath)!;
            if (!view) return "no view";
            void view.reader!.navigate({ pageIndex: 0 });
            return (
              (pageHelpers
                .pdfView(attachmentPath)
                ?.containerEl.querySelector<HTMLElement>(
                  '.page[data-page-number="1"] .textLayer',
                )?.textContent.length ?? 0) > 0
            );
          },
          { attachmentPath },
          { what: "the PDF text layer on page 1 to render text" },
        );
        await obRun(
          vaultId!,
          async (
            { page: pageHelpers },
            { attachmentPath }: { attachmentPath: string },
          ) => {
            const { fire } = pageHelpers;
            const walker = document.createTreeWalker(
              pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelector<HTMLElement>(
                  '.page[data-page-number="1"] .textLayer',
                )!,
              NodeFilter.SHOW_TEXT,
            );
            let node: Node | null;
            while (
              (node = walker.nextNode()) &&
              !(
                (node as Text).data.length > 12 &&
                node.parentElement!.getBoundingClientRect().height > 0
              )
            );
            const range = document.createRange();
            range.setStart(node!, 0);
            range.setEnd(node!, 8);
            const box = range.getBoundingClientRect();
            const x = box.left + 2,
              y = box.top + box.height / 2;
            const pressed = fire("pointerdown", x, y);
            getSelection()!.removeAllRanges();
            getSelection()!.addRange(range);
            fire("pointerup", x, y, pressed);
          },
          { attachmentPath },
        );
        await obRunUntil(
          vaultId!,
          async (_context) => {
            return !!document.querySelector<HTMLElement>(
              '.zt-pdf-mark-popup [data-zt-verb="highlight"]',
            );
          },
          undefined,
          { what: "the highlight button in the create popup to appear" },
        );
        await obRun(
          vaultId!,
          async ({ page: pageHelpers }) => {
            const { press } = pageHelpers;
            press(
              document.querySelector<HTMLElement>(
                '.zt-pdf-mark-popup [data-zt-verb="comment"]',
              ),
              "Comment",
            );
          },
          undefined,
        );
        await obRunUntil(
          vaultId!,
          async ({ page: pageHelpers }) => {
            return !!pageHelpers.popupEditor();
          },
          undefined,
          { what: "the popup comment editor to open" },
        );
        try {
          await expectEditorKeepsSelections(vaultId!);
        } finally {
          await obRun(
            vaultId!,
            async ({ page: pageHelpers }) => {
              const { fire } = pageHelpers;
              const box = document
                .querySelector<HTMLElement>(".workspace-ribbon")!
                .getBoundingClientRect();
              fire("pointerdown", box.left + 2, box.top + 2);
            },
            undefined,
          );
        }
        await obRunUntil(
          vaultId!,
          async (_context) => {
            return !!document.querySelector<HTMLElement>(".zt-pdf-mark-popup");
          },
          undefined,
          {
            ready: (value) => value === false,
            what: "the create popup to close",
          },
        );
      });

      it("selects a line of a PDF whose text sits inside a Form XObject, and the highlight it creates takes Zotero's Page Label and Sort Index (E-1, I-8)", async () => {
        const form = ATTACHMENTS.find(({ key }) => key === "FRMXPDF2")!;
        const formPath = form.path!;
        const formKey = form.key;
        await using local = new AsyncDisposableStack();
        const formItem = `Zotero.Items.getByLibraryAndKey(
          Zotero.Libraries.userLibraryID,
          ${JSON.stringify(formKey)},
        )`;
        local.defer(async () => {
          await rdp.json(`(async () => {
            const item = ${formItem};
            for (const reader of Zotero.Reader._readers.filter(
              (candidate) => candidate.itemID === item.id,
            ))
              reader.close();
            for (const annotation of item.getAnnotations())
              await annotation.eraseTx();
            return "erased";
          })()`);
        });
        local.defer(async () => {
          await obRun(
            vaultId!,
            ({ app, page }, { formPath }: { formPath: string }) => {
              for (const leaf of app.workspace.getLeavesOfType(
                page.reader.viewType,
              ))
                if ((leaf.view as FileView).file?.path === formPath)
                  leaf.detach();
            },
            { formPath },
          );
        });

        expect(
          await obRun(
            vaultId!,
            async ({ zotlit, page: pageHelpers }, { formKey }) => {
              const s = zotlit.services;
              await pageHelpers.until(
                "the Attachment index to resolve the Form XObject PDF",
                () =>
                  s.bridge.runSync(s.attachmentResolver.lookup(formKey))
                    .kind === "resolved",
                30000,
              );
              return await s.bridge.runPromise(
                s.targetOpener.open(
                  { kind: "attachment", attachmentKey: formKey },
                  "tab",
                ),
              );
            },
            { formKey },
            { timeoutMs: 60_000 },
          ),
        ).toEqual({ kind: "reader" });
        await raiseWindow(vaultId!);
        await obRunUntil(
          vaultId!,
          async (
            { zotlit, page: pageHelpers },
            { formPath, formKey }: { formPath: string; formKey: string },
          ) => {
            const view = pageHelpers.pdfView(formPath);
            if (!view) return false;
            const binding = zotlit.services.bridge.runSync(
              zotlit.services.pdfAnnotationEditor.bindingFor(view),
            );
            return (
              binding?.session?.target?.attachmentKey === formKey &&
              (view.containerEl.querySelector<HTMLElement>(
                '.page[data-page-number="1"] .textLayer',
              )?.textContent.length ?? 0) > 0
            );
          },
          { formPath, formKey },
          {
            what: "the Form XObject PDF's binding and its page 1 text layer",
          },
        );

        const selected = await obRun(
          vaultId!,
          async ({ page: pageHelpers }, { formPath }: { formPath: string }) => {
            const { fire, trusted, until } = pageHelpers;
            const walker = document.createTreeWalker(
              pageHelpers
                .pdfView(formPath)!
                .containerEl.querySelector<HTMLElement>(
                  '.page[data-page-number="1"] .textLayer',
                )!,
              NodeFilter.SHOW_TEXT,
            );
            let node: Node | null;
            let seen = 0;
            while ((node = walker.nextNode()))
              if (
                (node as Text).data.trim().length > 10 &&
                node.parentElement!.getBoundingClientRect().height > 0 &&
                seen++ === 4
              )
                break;
            const range = document.createRange();
            range.selectNodeContents(node!);
            const box = range.getBoundingClientRect();
            const x = box.left + 2,
              y = box.top + box.height / 2;
            const pressed = fire("pointerdown", x, y);
            getSelection()!.removeAllRanges();
            getSelection()!.addRange(range);
            fire("pointerup", x, y, pressed);
            const highlight = await until(
              "the create popup's Highlight",
              () =>
                document.querySelector<HTMLElement>(
                  '.zt-pdf-mark-popup [data-zt-verb="highlight"]',
                ),
              5000,
            );
            await trusted(window).click(highlight);
            return (node as Text).data;
          },
          { formPath },
        );

        const createdOf = () =>
          rdp.json<
            {
              type: string;
              text: string;
              sortIndex: string;
              pageLabel: string;
              position: string;
            }[]
          >(`(() =>
            ${formItem}.getAnnotations().map((annotation) => ({
              type: annotation.annotationType,
              text: annotation.annotationText,
              sortIndex: annotation.annotationSortIndex,
              pageLabel: annotation.annotationPageLabel,
              position: annotation.annotationPosition,
            }))
          )()`);
        expect(await waitFor(async () => (await createdOf()).length > 0)).toBe(
          true,
        );
        const [created, ...more] = await createdOf();
        const zotero = await rdp.json<{
          sortIndex: string;
          pageLabel: string;
          chars: number;
        }>(`(async () => {
          const item = ${formItem};
          const reader = await Zotero.Reader.open(item.id);
          await reader._initPromise;
          let view = null;
          for (let i = 0; i < 200 && !view; i++) {
            view = reader._internalReader?._primaryView ?? null;
            if (!view) await Zotero.Promise.delay(50);
          }
          await view.initializedPromise;
          const position = JSON.parse(${JSON.stringify(created!.position)});
          await view._ensureBasicPageData(position.pageIndex);
          const meta = view.getAnnotationMeta(
            Components.utils.cloneInto(position, reader._iframeWindow),
          );
          const chars = view._pdfPages[position.pageIndex].chars.length;
          reader.close();
          return { sortIndex: meta.sortIndex, pageLabel: meta.pageLabel, chars };
        })()`);
        expect(more).toEqual([]);
        expect(created!.type).toBe("highlight");
        expect(created!.text.replaceAll(/\s/g, "")).toBe(
          selected.replaceAll(/\s/g, ""),
        );
        expect(zotero.chars).toBeGreaterThan(0);
        expect(Number(created!.sortIndex.split("|")[1])).toBeGreaterThan(0);
        expect({
          sortIndex: created!.sortIndex,
          pageLabel: created!.pageLabel,
        }).toEqual({
          sortIndex: zotero.sortIndex,
          pageLabel: zotero.pageLabel,
        });
      });

      it("hides the Mark Popup of a new highlight when a new tab covers the PDF, and shows it again when the PDF's tab comes back", async () => {
        await raiseWindow(vaultId!);
        await obRunUntil(
          vaultId!,
          async (
            { page: pageHelpers },
            { attachmentPath }: { attachmentPath: string },
          ) => {
            const view = pageHelpers.pdfView(attachmentPath)!;
            if (!view) return "no view";
            void view.reader!.navigate({ pageIndex: 0 });
            return (
              (pageHelpers
                .pdfView(attachmentPath)
                ?.containerEl.querySelector<HTMLElement>(
                  '.page[data-page-number="1"] .textLayer',
                )?.textContent.length ?? 0) > 0
            );
          },
          { attachmentPath },
          { what: "the PDF text layer on page 1 to render text" },
        );
        const marks = () =>
          obRun(
            vaultId!,
            (
              { page: pageHelpers },
              { attachmentPath }: { attachmentPath: string },
            ) =>
              [
                ...pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelectorAll<HTMLElement>(
                    ".zt-pdf-annotation-mark[data-zotero-annotation-key]",
                  ),
              ].map((n) => n.dataset.zoteroAnnotationKey!),
            { attachmentPath },
          );
        const before = new Set(await marks());
        await using local = new AsyncDisposableStack();
        local.defer(async () => {
          await eraseAnnotations(
            rdp,
            (await marks()).filter((key) => !before.has(key)),
          );
        });
        await obRun(
          vaultId!,
          async (
            { page: pageHelpers },
            { attachmentPath }: { attachmentPath: string },
          ) => {
            const { fire, trusted, until } = pageHelpers;
            const walker = document.createTreeWalker(
              pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelector<HTMLElement>(
                  '.page[data-page-number="1"] .textLayer',
                )!,
              NodeFilter.SHOW_TEXT,
            );
            let node: Node | null;
            let seen = 0;
            while ((node = walker.nextNode()))
              if (
                (node as Text).data.length > 12 &&
                node.parentElement!.getBoundingClientRect().height > 0 &&
                seen++ === 3
              )
                break;
            const range = document.createRange();
            range.setStart(node!, 0);
            range.setEnd(node!, 8);
            const box = range.getBoundingClientRect();
            const x = box.left + 2,
              y = box.top + box.height / 2;
            const pressed = fire("pointerdown", x, y);
            getSelection()!.removeAllRanges();
            getSelection()!.addRange(range);
            fire("pointerup", x, y, pressed);
            const highlight = await until(
              "the create popup's Highlight",
              () =>
                document.querySelector<HTMLElement>(
                  '.zt-pdf-mark-popup [data-zt-verb="highlight"]',
                ),
              5000,
            );
            await trusted(window).click(highlight);
          },
          { attachmentPath },
        );
        await obRunUntil(
          vaultId!,
          async (
            { zotlit },
            { attachmentPath }: { attachmentPath: string },
          ) => {
            const services = zotlit.services;
            await Promise.all(
              services.bridge
                .runSync(services.pdfAnnotationEditor.bindings)
                .filter((binding) => binding.filePath === attachmentPath)
                .map((binding) => binding.settled),
            );
            const popup =
              document.querySelector<HTMLElement>(".zt-pdf-mark-popup");
            return (
              (popup?.checkVisibility() ?? false) &&
              !!popup!.querySelector('[data-zt-verb="delete"]')
            );
          },
          { attachmentPath },
          { what: "the new highlight's Mark Popup" },
        );
        await waitFor(async () =>
          (await marks()).some((key) => !before.has(key)),
        );
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await obRun(vaultId!, async ({ page: pageHelpers }) => {
          await pageHelpers
            .trusted(window)
            .key("T", [process.platform === "darwin" ? "meta" : "control"]);
        });
        local.defer(async () => {
          await obRun(vaultId!, ({ app }) => {
            for (const leaf of app.workspace.getLeavesOfType("empty"))
              leaf.detach();
          });
        });
        expect(
          await obRun(vaultId!, async ({ app }) => {
            await new Promise((resolve) => setTimeout(resolve, 500));
            return {
              shown:
                document
                  .querySelector<HTMLElement>(".zt-pdf-mark-popup")
                  ?.checkVisibility() ?? false,
              tab:
                app.workspace.getMostRecentLeaf()?.view.getViewType() ?? null,
            };
          }),
        ).toEqual({ shown: false, tab: "empty" });
        await obRun(
          vaultId!,
          ({ app, page }, { attachmentPath }: { attachmentPath: string }) => {
            app.workspace.setActiveLeaf(
              app.workspace
                .getLeavesOfType(page.reader.viewType)
                .find(
                  (leaf) =>
                    (leaf.view as FileView).file?.path === attachmentPath,
                )!,
              { focus: true },
            );
          },
          { attachmentPath },
        );
        expect(
          await obRunUntil(
            vaultId!,
            ({ app }) => ({
              shown:
                document
                  .querySelector<HTMLElement>(".zt-pdf-mark-popup")
                  ?.checkVisibility() ?? false,
              tab:
                app.workspace.getMostRecentLeaf()?.view.getViewType() ?? null,
            }),
            undefined,
            {
              what: "the Mark Popup back over the highlight",
              ready: (value) => value.shown,
            },
          ),
        ).toEqual({ shown: true, tab: READER_VIEW_TYPE });
        await obRun(vaultId!, async ({ page: pageHelpers }) => {
          await pageHelpers.trusted(window).key("Escape");
        });
        await obRunUntil(
          vaultId!,
          ({ app }) => ({
            shown:
              document
                .querySelector<HTMLElement>(".zt-pdf-mark-popup")
                ?.checkVisibility() ?? false,
            tab: app.workspace.getMostRecentLeaf()?.view.getViewType() ?? null,
          }),
          undefined,
          {
            what: "the Mark Popup to close on Escape",
            ready: (value) => !value.shown,
          },
        );
      }, 120000);

      it("keeps a comment typed in the create popup while a new tab covers the PDF", async () => {
        await raiseWindow(vaultId!);
        await obRunUntil(
          vaultId!,
          async (
            { page: pageHelpers },
            { attachmentPath }: { attachmentPath: string },
          ) => {
            const view = pageHelpers.pdfView(attachmentPath)!;
            if (!view) return "no view";
            void view.reader!.navigate({ pageIndex: 0 });
            return (
              (pageHelpers
                .pdfView(attachmentPath)
                ?.containerEl.querySelector<HTMLElement>(
                  '.page[data-page-number="1"] .textLayer',
                )?.textContent.length ?? 0) > 0
            );
          },
          { attachmentPath },
          { what: "the PDF text layer on page 1 to render text" },
        );
        await using local = new AsyncDisposableStack();
        local.defer(async () => {
          await obRun(vaultId!, async ({ app, page: pageHelpers }) => {
            for (const leaf of app.workspace.getLeavesOfType("empty"))
              leaf.detach();
            await pageHelpers.trusted(window).key("Escape");
            await pageHelpers.trusted(window).key("Escape");
          });
        });
        await obRun(
          vaultId!,
          async (
            { page: pageHelpers },
            { attachmentPath }: { attachmentPath: string },
          ) => {
            const { fire, trusted, until } = pageHelpers;
            const walker = document.createTreeWalker(
              pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelector<HTMLElement>(
                  '.page[data-page-number="1"] .textLayer',
                )!,
              NodeFilter.SHOW_TEXT,
            );
            let node: Node | null;
            let seen = 0;
            while ((node = walker.nextNode()))
              if (
                (node as Text).data.length > 12 &&
                node.parentElement!.getBoundingClientRect().height > 0 &&
                seen++ === 7
              )
                break;
            const range = document.createRange();
            range.setStart(node!, 0);
            range.setEnd(node!, 8);
            const box = range.getBoundingClientRect();
            const x = box.left + 2,
              y = box.top + box.height / 2;
            const pressed = fire("pointerdown", x, y);
            getSelection()!.removeAllRanges();
            getSelection()!.addRange(range);
            fire("pointerup", x, y, pressed);
            await trusted(window).click(
              await until(
                "the create popup's Add comment",
                () =>
                  document.querySelector<HTMLElement>(
                    '.zt-pdf-mark-popup [data-zt-verb="comment"]',
                  ),
                5000,
              ),
            );
            (
              await until("the comment editor", pageHelpers.popupEditor, 5000)
            ).focus();
            (
              require("@electron/remote") as {
                getCurrentWebContents(): { insertText(text: string): void };
              }
            )
              .getCurrentWebContents()
              .insertText("Read before the seminar");
          },
          { attachmentPath },
        );
        await obRun(vaultId!, async ({ page: pageHelpers }) => {
          await pageHelpers
            .trusted(window)
            .key("T", [process.platform === "darwin" ? "meta" : "control"]);
        });
        expect(
          await obRunUntil(
            vaultId!,
            ({ app }) => ({
              shown:
                document
                  .querySelector<HTMLElement>(".zt-pdf-mark-popup")
                  ?.checkVisibility() ?? false,
              tab:
                app.workspace.getMostRecentLeaf()?.view.getViewType() ?? null,
            }),
            undefined,
            {
              what: "the create popup to hide behind the new tab",
              ready: (value) => value.tab === "empty" && !value.shown,
            },
          ),
        ).toEqual({ shown: false, tab: "empty" });
        await obRun(
          vaultId!,
          ({ app, page }, { attachmentPath }: { attachmentPath: string }) => {
            app.workspace.setActiveLeaf(
              app.workspace
                .getLeavesOfType(page.reader.viewType)
                .find(
                  (leaf) =>
                    (leaf.view as FileView).file?.path === attachmentPath,
                )!,
              { focus: true },
            );
          },
          { attachmentPath },
        );
        expect(
          await obRunUntil(
            vaultId!,
            ({ page: pageHelpers }) => ({
              shown:
                document
                  .querySelector<HTMLElement>(".zt-pdf-mark-popup")
                  ?.checkVisibility() ?? false,
              comment: pageHelpers.popupEditor()?.textContent ?? null,
            }),
            undefined,
            {
              what: "the create popup back with its comment",
              ready: (value) => value.shown,
            },
          ),
        ).toEqual({ shown: true, comment: "Read before the seminar" });
      }, 120000);

      describe("Mark Handles on the seeded ink", () => {
        const inkKey = "4PE492KU";
        const ink = seededMark(inkKey, { image: true });

        interface InkPosition {
          pageIndex: number;
          width: number;
          paths: number[][];
        }
        const seedPosition = ink.seeded.position as InkPosition;

        async function selectInk(): Promise<{
          body: { x: number; y: number };
          corner: { x: number; y: number };
          perX: number;
          perY: number;
        }> {
          await ink.settled();
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                inkKey,
              }: { attachmentPath: string; inkKey: "4PE492KU" },
            ) => {
              const view = pageHelpers.pdfView(attachmentPath)!;
              if (!view) return "no view";
              void view.reader!.navigate({ pageIndex: 0 });
              const mark = pageHelpers
                .pdfView(attachmentPath)
                ?.containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(inkKey)}]`,
                );
              if (!mark) return "no mark";
              mark.scrollIntoView({ block: "center", inline: "center" });
              return mark.getBoundingClientRect().width > 0;
            },
            { attachmentPath, inkKey },
            { what: "the ink mark 4PE492KU to render in the PDF view" },
          );
          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                inkKey,
              }: { attachmentPath: string; inkKey: "4PE492KU" },
            ) => {
              const { tap } = pageHelpers;
              const mark = pageHelpers
                .pdfView(attachmentPath)
                ?.containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(inkKey)}]`,
                );
              if (mark!.classList.contains("is-selected")) return "selected";
              const rect = mark!.getBoundingClientRect();
              const x = rect.left + rect.width / 2,
                y = rect.top + rect.height / 2;
              tap(x, y);
              return "clicked";
            },
            { attachmentPath, inkKey },
          );
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              { attachmentPath }: { attachmentPath: string },
            ) => {
              return pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelectorAll<HTMLElement>(
                  ".zt-pdf-annotation-handle",
                ).length;
            },
            { attachmentPath },
            {
              ready: (value) => value === 4,
              what: "the four handles on the seeded ink mark to appear",
            },
          );

          let last = "";
          expect(
            await waitFor(async () => {
              const next = await obRun(
                vaultId!,
                async (
                  { page: pageHelpers },
                  {
                    attachmentPath,
                    inkKey,
                  }: { attachmentPath: string; inkKey: "4PE492KU" },
                ) => {
                  const view = pageHelpers.pdfView(attachmentPath)!;
                  const handle = view.containerEl
                    .querySelector<HTMLElement>(
                      '.zt-pdf-annotation-handle[data-zt-grip="br"]',
                    )!
                    .getBoundingClientRect();
                  const box = pageHelpers
                    .pdfView(attachmentPath)
                    ?.containerEl.querySelector<SVGGraphicsElement>(
                      `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(inkKey)}]`,
                    )!
                    .getBoundingClientRect();
                  const overlay = pageHelpers
                    .pdfView(attachmentPath)
                    ?.containerEl.querySelector<SVGGraphicsElement>(
                      `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(inkKey)}]`,
                    )!.ownerSVGElement;
                  return JSON.stringify({
                    body: {
                      x: box!.left + box!.width / 2,
                      y: box!.top + box!.height / 2,
                    },
                    corner: {
                      x: handle.left + handle.width / 2,
                      y: handle.top + handle.height / 2,
                    },
                    perX:
                      overlay!.getBoundingClientRect().width /
                      overlay!.viewBox.baseVal.width,
                    perY:
                      overlay!.getBoundingClientRect().height /
                      overlay!.viewBox.baseVal.height,
                  });
                },
                { attachmentPath, inkKey },
              );
              const still = next === last;
              last = next;
              return still;
            }),
            last,
          ).toBe(true);
          return JSON.parse(last) as Awaited<ReturnType<typeof selectInk>>;
        }

        async function savedInk(
          pixels: Awaited<ReturnType<typeof watchExcerptPixels>>,
        ): Promise<InkPosition> {
          expect(
            await waitFor(
              async () =>
                !isDeepStrictEqual(
                  JSON.parse((await ink.stored()).data.annotationPosition),
                  ink.seeded.position,
                ),
            ),
          ).toBe(true);
          await ink.settled();
          const stored = await ink.stored();
          expect(stored.data.annotationSortIndex).toBe(
            await recomputedSortIndex(vaultId!, {
              attachmentPath,
              position: stored.data.annotationPosition,
            }),
          );
          expect((await ink.held())?.position).toBe(
            stored.data.annotationPosition,
          );
          await expect
            .poll(() => pixels.keys(), { timeout: 10_000 })
            .toContain(inkKey);
          return JSON.parse(stored.data.annotationPosition) as InkPosition;
        }

        function expectPoints(
          position: InkPosition,
          expected: (x: number, y: number) => [number, number],
        ): void {
          expect(position.paths).toHaveLength(seedPosition.paths.length);
          seedPosition.paths.forEach((stroke, index) => {
            const moved = position.paths[index]!;
            expect(moved).toHaveLength(stroke.length);
            for (let at = 0; at < stroke.length; at += 2) {
              const [x, y] = expected(stroke[at]!, stroke[at + 1]!);
              expect(
                Math.abs(moved[at]! - x),
                `x of point ${at / 2}`,
              ).toBeLessThan(0.01);
              expect(
                Math.abs(moved[at + 1]! - y),
                `y of point ${at / 2}`,
              ).toBeLessThan(0.01);
            }
          });
        }

        beforeAll(async () => {
          await closeZoteroReader(rdp, readerTabID);
          setReaderTabID(await openZoteroReader(rdp));
          await ink.restore();
          await raiseWindow(vaultId!);
        });

        afterEach(ink.restore);

        it("moves every point of the ink by its body's drag, the width kept", async () => {
          const { body, perX, perY } = await selectInk();
          await using pixels = await watchExcerptPixels(vaultId!);
          await dragPointer(body, { x: body.x + 40, y: body.y + 20 });
          const dx = 40 / perX;
          const dy = -20 / perY;

          const position = await savedInk(pixels);
          expect(position.pageIndex).toBe(seedPosition.pageIndex);
          expect(position.width).toBe(seedPosition.width);
          expectPoints(position, (x, y) => [x + dx, y + dy]);
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                inkKey,
                pathStartX,
              }: {
                attachmentPath: string;
                inkKey: "4PE492KU";
                pathStartX: number | undefined;
              },
            ) => {
              return pageHelpers
                .pdfView(attachmentPath)
                ?.containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(inkKey)}]`,
                )
                ?.getAttribute("d")!
                .startsWith(`M ${pathStartX} `);
            },
            { attachmentPath, inkKey, pathStartX: position.paths[0]![0] },
            {
              what: "the ink mark 4PE492KU path to start at the dragged x position",
            },
          );
        }, 120000);

        it("takes a click on the stroke and none inside the empty middle of the ink", async () => {
          await ink.settled();
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                inkKey,
              }: { attachmentPath: string; inkKey: "4PE492KU" },
            ) => {
              const view = pageHelpers.pdfView(attachmentPath)!;
              if (!view) return "no view";
              void view.reader!.navigate({ pageIndex: 0 });
              const mark = pageHelpers
                .pdfView(attachmentPath)
                ?.containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(inkKey)}]`,
                );
              if (!mark) return "no mark";
              mark.scrollIntoView({ block: "center", inline: "center" });
              return mark.getBoundingClientRect().width > 0;
            },
            { attachmentPath, inkKey },
            { what: "the ink mark 4PE492KU to render with a non-empty box" },
          );

          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                inkKey,
              }: { attachmentPath: string; inkKey: "4PE492KU" },
            ) => {
              const { tap } = pageHelpers;
              const mark = pageHelpers
                .pdfView(attachmentPath)
                ?.containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(inkKey)}]`,
                );
              const at = (mark! as SVGGeometryElement)
                .getPointAtLength(
                  (mark! as SVGGeometryElement).getTotalLength() / 2,
                )
                .matrixTransform(mark!.getScreenCTM()!);
              tap(at.x, at.y);
            },
            { attachmentPath, inkKey },
          );
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                inkKey,
              }: { attachmentPath: string; inkKey: "4PE492KU" },
            ) => {
              return pageHelpers
                .pdfView(attachmentPath)
                ?.containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(inkKey)}]`,
                )
                ?.classList.contains("is-selected");
            },
            { attachmentPath, inkKey },
            {
              what: "the ink mark 4PE492KU to be selected after a stroke click",
            },
          );

          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                inkKey,
              }: { attachmentPath: string; inkKey: "4PE492KU" },
            ) => {
              const { tap } = pageHelpers;
              const box = pageHelpers
                .pdfView(attachmentPath)
                ?.containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(inkKey)}]`,
                )!
                .getBoundingClientRect();
              const x = box!.left + box!.width * 0.2,
                y = box!.top + box!.height * 0.1;
              tap(x, y);
            },
            { attachmentPath, inkKey },
          );
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                inkKey,
              }: { attachmentPath: string; inkKey: "4PE492KU" },
            ) => {
              return pageHelpers
                .pdfView(attachmentPath)
                ?.containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(inkKey)}]`,
                )
                ?.classList.contains("is-selected");
            },
            { attachmentPath, inkKey },
            {
              ready: (value) => value === false,
              what: "the ink mark 4PE492KU to be deselected",
            },
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

        it("scales the ink from its bottom-right corner with its proportions and its pen", async () => {
          const { corner, perX } = await selectInk();
          await using pixels = await watchExcerptPixels(vaultId!);
          await dragPointer(corner, { x: corner.x + 30, y: corner.y + 10 });
          const points = seedPosition.paths.flat();
          const xs = points.filter((_, index) => index % 2 === 0);
          const ys = points.filter((_, index) => index % 2 === 1);
          const left = Math.min(...xs);
          const top = Math.max(...ys);
          const width = Math.max(...xs) - left;
          const scale = (width + 30 / perX) / width;

          const position = await savedInk(pixels);
          expectPoints(position, (x, y) => [
            left + (x - left) * scale,
            top - (top - y) * scale,
          ]);
          expect(position.width).toBeCloseTo(seedPosition.width * scale, 2);
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                inkKey,
              }: { attachmentPath: string; inkKey: "4PE492KU" },
            ) => {
              return pageHelpers
                .pdfView(attachmentPath)
                ?.containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(inkKey)}]`,
                )
                ?.getAttribute("stroke-width");
            },
            { attachmentPath, inkKey },
            {
              ready: (value) => value === String(position.width),
              what: "the ink mark 4PE492KU stroke width to match the scaled pen width",
            },
          );
        }, 120000);
      });

      describe("Mark Handles on the seeded note and free text", () => {
        const noteKey = "C94NJNYG";
        const textKey = "HRK7BG32";
        const note = seededMark(noteKey, { image: false });
        const text = seededMark(textKey, { image: false });

        interface TextPosition {
          pageIndex: number;
          fontSize: number;
          rotation: number;
          rects: number[][];
        }
        const rectOf = ({
          seeded: { position },
        }: ReturnType<typeof seededMark>) => {
          if (!("rects" in position))
            throw new Error("The seeded mark has no rect");
          return position.rects[0]!;
        };
        const noteRect = rectOf(note);
        const textSeed = text.seeded.position;
        if (!("fontSize" in textSeed)) throw new Error("HRK7BG32 is text");
        const [x1, y1, x2, y2] = rectOf(text);
        const LINE = 1.2 * textSeed.fontSize;

        async function select(
          mark: ReturnType<typeof seededMark>,
          handles: number,
        ): Promise<{
          body: { x: number; y: number };
          handles: Record<string, { x: number; y: number }>;
          perX: number;
          perY: number;
        }> {
          const key = mark.seeded.key;
          const [left, bottom, right, top] = rectOf(mark);
          const [cx, cy] = [(left + right) / 2, (bottom + top) / 2];
          await mark.settled();
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              { attachmentPath, key }: { attachmentPath: string; key: string },
            ) => {
              const view = pageHelpers.pdfView(attachmentPath)!;
              if (!view) return "no view";
              void view.reader!.navigate({ pageIndex: 0 });
              const mark = pageHelpers
                .pdfView(attachmentPath)
                ?.containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(key)}]`,
                );
              if (!mark) return "no mark";
              mark.scrollIntoView({ block: "center", inline: "center" });
              return mark.getBoundingClientRect().width > 0;
            },
            { attachmentPath, key },
            {
              what: "the seeded note or free text mark to render in the PDF view",
            },
          );
          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                key,
                cx,
                cy,
              }: {
                attachmentPath: string;
                key: string;
                cx: number;
                cy: number;
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
              if (
                pageHelpers
                  .pdfView(attachmentPath)
                  ?.containerEl.querySelector<SVGGraphicsElement>(
                    `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(key)}]`,
                  )!
                  .classList.contains("is-selected")
              )
                return "selected";
              const at = clientOf(cx, cy);
              tap(at.x, at.y);
              return "clicked";
            },
            { attachmentPath, key, cx, cy },
          );
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              { attachmentPath, key }: { attachmentPath: string; key: string },
            ) => {
              return pageHelpers
                .pdfView(attachmentPath)
                ?.containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(key)}]`,
                )!
                .classList.contains("is-selected");
            },
            { attachmentPath, key },
            { what: "the seeded note or free text mark to be selected" },
          );
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              { attachmentPath }: { attachmentPath: string },
            ) => {
              return pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelectorAll<HTMLElement>(
                  ".zt-pdf-annotation-handle",
                ).length;
            },
            { attachmentPath },
            {
              ready: (value) => value === handles,
              what: "the handle count on the seeded note or free text to match the expected count",
            },
          );

          let last = "";
          expect(
            await waitFor(async () => {
              const next = await obRun(
                vaultId!,
                async (
                  { page: pageHelpers },
                  {
                    attachmentPath,
                    key,
                    cx,
                    cy,
                  }: {
                    attachmentPath: string;
                    key: string;
                    cx: number;
                    cy: number;
                  },
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
                  const view = pageHelpers.pdfView(attachmentPath)!;
                  const handles = Object.fromEntries(
                    [
                      ...view.containerEl.querySelectorAll<HTMLElement>(
                        ".zt-pdf-annotation-handle",
                      ),
                    ].map((node) => {
                      const rect = node.getBoundingClientRect();
                      return [
                        (node as HTMLElement | SVGElement).dataset.ztGrip,
                        {
                          x: rect.left + rect.width / 2,
                          y: rect.top + rect.height / 2,
                        },
                      ];
                    }),
                  );
                  const overlay = pageHelpers
                    .pdfView(attachmentPath)
                    ?.containerEl.querySelector<SVGGraphicsElement>(
                      `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(key)}]`,
                    )!.ownerSVGElement;
                  return JSON.stringify({
                    body: clientOf(cx, cy),
                    handles,
                    perX:
                      overlay!.getBoundingClientRect().width /
                      overlay!.viewBox.baseVal.width,
                    perY:
                      overlay!.getBoundingClientRect().height /
                      overlay!.viewBox.baseVal.height,
                  });
                },
                { attachmentPath, key, cx, cy },
              );
              const still = next === last;
              last = next;
              return still;
            }),
            last,
          ).toBe(true);
          return JSON.parse(last) as Awaited<ReturnType<typeof select>>;
        }

        async function savedPosition(
          mark: ReturnType<typeof seededMark>,
        ): Promise<string> {
          expect(
            await waitFor(
              async () =>
                !isDeepStrictEqual(
                  JSON.parse((await mark.stored()).data.annotationPosition),
                  mark.seeded.position,
                ),
            ),
          ).toBe(true);
          await mark.settled();
          const stored = await mark.stored();
          expect(stored.data.annotationSortIndex).toBe(
            await recomputedSortIndex(vaultId!, {
              attachmentPath,
              position: stored.data.annotationPosition,
            }),
          );
          expect((await mark.held())?.position).toBe(
            stored.data.annotationPosition,
          );
          return stored.data.annotationPosition;
        }

        beforeAll(async () => {
          await note.restore();
          await text.restore();
          await raiseWindow(vaultId!);
        });

        afterEach(async () => {
          await note.restore();
          await text.restore();
        });

        it("moves the note by its body, with no handle drawn, and keeps its size", async () => {
          const { body, perX, perY } = await select(note, 0);
          await dragPointer(body, { x: body.x - 40, y: body.y + 20 });
          const dx = -40 / perX;
          const dy = -20 / perY;

          const saved = await savedPosition(note);
          expect((JSON.parse(saved) as { pageIndex: number }).pageIndex).toBe(
            0,
          );
          expect(
            rectIs(
              saved,
              [
                noteRect[0] + dx,
                noteRect[1] + dy,
                noteRect[2] + dx,
                noteRect[3] + dy,
              ],
              0.01,
            ),
            saved,
          ).toBe(true);
        }, 120000);

        it("nudges the note five points for Alt+ArrowLeft, and resizes nothing for Shift+ArrowLeft", async () => {
          await select(note, 0);
          const { version } = await note.stored();
          expect(await pressKey("ArrowLeft", { shiftKey: true })).toEqual({
            prevented: false,
          });
          await note.settled();
          expect((await note.stored()).version).toBe(version);

          expect(await pressKey("ArrowLeft", { altKey: true })).toEqual({
            prevented: true,
          });
          const saved = await savedPosition(note);
          expect(
            rectIs(saved, [
              noteRect[0] - 5,
              noteRect[1],
              noteRect[2] - 5,
              noteRect[3],
            ]),
            saved,
          ).toBe(true);
        }, 120000);

        it("moves the free text by its body, its font and turn kept", async () => {
          const { body, perX, perY } = await select(text, 6);
          await dragPointer(body, { x: body.x - 40, y: body.y + 20 });
          const dx = -40 / perX;
          const dy = -20 / perY;

          const saved = await savedPosition(text);
          const position = JSON.parse(saved) as TextPosition;
          expect(position.fontSize).toBe(textSeed.fontSize);
          expect(position.rotation).toBe(textSeed.rotation);
          expect(
            rectIs(saved, [x1 + dx, y1 + dy, x2 + dx, y2 + dy], 0.01),
            saved,
          ).toBe(true);
        }, 120000);

        it("narrows the free text from its right handle, its font kept and its height fitted to the lines", async () => {
          const { handles, perX } = await select(text, 6);
          await dragPointer(handles.r!, {
            x: handles.r!.x - 80 * perX,
            y: handles.r!.y + 7,
          });
          const width = x2 - x1 - 80;
          const lines = await obRun(
            vaultId!,
            async (
              _context,
              {
                fontPrefix,
                comment,
                maxWidth,
              }: {
                fontPrefix: `${number}px `;
                comment: string | null;
                maxWidth: number;
              },
            ) => {
              const context = document.createElement("canvas").getContext("2d");
              context!.font =
                fontPrefix + getComputedStyle(document.body).fontFamily;
              let lines = 1,
                line = "";
              for (const word of comment!.split(" ")) {
                const next = line ? `${line} ${word}` : word;
                if (context!.measureText(next).width <= maxWidth) line = next;
                else {
                  lines++;
                  line = word;
                }
              }
              return lines;
            },
            {
              fontPrefix: `${textSeed.fontSize}px `,
              comment: text.seeded.comment,
              maxWidth: width,
            },
          );
          expect(lines).toBeGreaterThan(1);

          const saved = await savedPosition(text);
          expect((JSON.parse(saved) as TextPosition).fontSize).toBe(
            textSeed.fontSize,
          );
          expect(
            rectIs(saved, [x1, y2 - lines * LINE, x2 - 80, y2], 0.01),
            saved,
          ).toBe(true);
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                textKey,
              }: { attachmentPath: string; textKey: "HRK7BG32" },
            ) => {
              return pageHelpers
                .pdfView(attachmentPath)
                ?.containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(textKey)}]`,
                )?.children.length;
            },
            { attachmentPath, textKey },
            {
              ready: (value) => value === lines,
              what: "the free text HRK7BG32 mark to have the expected line count",
            },
          );
        }, 120000);

        it("fits the free text to its comment's width when its right handle is released on one line", async () => {
          const { handles, perX } = await select(text, 6);
          await dragPointer(handles.r!, {
            x: handles.r!.x + 30 * perX,
            y: handles.r!.y,
          });
          const width = await obRun(
            vaultId!,
            async (
              _context,
              {
                fontPrefix,
                comment,
              }: { fontPrefix: `${number}px `; comment: string | null },
            ) => {
              const context = document.createElement("canvas").getContext("2d");
              context!.font =
                fontPrefix + getComputedStyle(document.body).fontFamily;
              return context!.measureText(comment!).width;
            },
            {
              fontPrefix: `${textSeed.fontSize}px `,
              comment: text.seeded.comment,
            },
          );

          const saved = await savedPosition(text);
          expect((JSON.parse(saved) as TextPosition).fontSize).toBe(
            textSeed.fontSize,
          );
          expect(
            rectIs(saved, [x1, y2 - LINE, x1 + width + 5, y2], 0.01),
            saved,
          ).toBe(true);
        }, 120000);

        it("scales the free text and its font from its bottom-right corner, the top-left corner kept", async () => {
          const { handles, perX } = await select(text, 6);
          await dragPointer(handles.br!, {
            x: handles.br!.x - 54 * perX,
            y: handles.br!.y - 30,
          });
          const scale = (x2 - x1 - 54) / (x2 - x1);

          const saved = await savedPosition(text);
          expect((JSON.parse(saved) as TextPosition).fontSize).toBe(9);
          expect(
            rectIs(saved, [x1, y2 - (y2 - y1) * scale, x2 - 54, y2], 0.01),
            saved,
          ).toBe(true);
        }, 120000);

        it("scales the free text by five points of width for Shift+ArrowDown, its font rounded to the half point", async () => {
          await select(text, 6);
          expect(await pressKey("ArrowDown", { shiftKey: true })).toEqual({
            prevented: true,
          });
          const width = x2 - x1;
          const scale = (width + 5) / width;

          const saved = await savedPosition(text);
          expect((JSON.parse(saved) as TextPosition).fontSize).toBe(14.5);
          expect(
            rectIs(saved, [x1, y2 - (y2 - y1) * scale, x2 + 5, y2]),
            saved,
          ).toBe(true);
        }, 120000);
      });

      describe("Mark Handles on the seeded highlight", () => {
        const highlightKey = "Q8ZR4TDH";
        const highlight = seededMark(highlightKey, { image: false });

        const seedText = highlight.seed.annotationText!;
        const seedRects = (
          highlight.seeded.position as { rects: readonly (readonly number[])[] }
        ).rects;

        async function selectHighlight(): Promise<{ x: number; y: number }> {
          await highlight.settled();
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                highlightKey,
              }: { attachmentPath: string; highlightKey: "Q8ZR4TDH" },
            ) => {
              const view = pageHelpers.pdfView(attachmentPath)!;
              if (!view) return "no view";
              void view.reader!.navigate({ pageIndex: 0 });
              const rect = [
                ...pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelectorAll<SVGGraphicsElement>(
                    `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(highlightKey)}]`,
                  ),
              ][1]?.getBoundingClientRect();
              return !!rect && rect.width > 0;
            },
            { attachmentPath, highlightKey },
            {
              what: "the highlight Q8ZR4TDH second rect to render in the PDF view",
            },
          );
          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                highlightKey,
              }: { attachmentPath: string; highlightKey: "Q8ZR4TDH" },
            ) => {
              const { tap } = pageHelpers;
              const mark = [
                ...pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelectorAll<SVGGraphicsElement>(
                    `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(highlightKey)}]`,
                  ),
              ][1];
              if (mark!.classList.contains("is-selected")) return "selected";
              const rect = mark!.getBoundingClientRect();
              const x = rect.left + rect.width / 2,
                y = rect.top + rect.height / 2;
              tap(x, y);
              return "clicked";
            },
            { attachmentPath, highlightKey },
          );
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              { attachmentPath }: { attachmentPath: string },
            ) => {
              return [
                ...pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelectorAll<HTMLElement>(
                    ".zt-pdf-annotation-handle",
                  ),
              ].map((handle) => handle.dataset.ztGrip);
            },
            { attachmentPath },
            {
              ready: (value) => isDeepStrictEqual(value, ["start", "end"]),
              what: "the highlight Q8ZR4TDH handles to be start and end grips",
            },
          );

          let last = "";
          expect(
            await waitFor(async () => {
              const next = await obRun(
                vaultId!,
                async (
                  { page: pageHelpers },
                  { attachmentPath }: { attachmentPath: string },
                ) => {
                  const node = pageHelpers
                    .pdfView(attachmentPath)!
                    .containerEl.querySelector<HTMLElement>(
                      '.zt-pdf-annotation-handle[data-zt-grip="end"]',
                    );
                  node!.scrollIntoView({ block: "nearest", inline: "nearest" });
                  const handle = node!.getBoundingClientRect();
                  const x = handle.left + handle.width / 2,
                    y = handle.top + handle.height / 2;
                  return JSON.stringify({
                    x,
                    y,
                    onTop: document.elementFromPoint(x, y) === node,
                  });
                },
                { attachmentPath },
              );
              const still =
                next === last && (JSON.parse(next) as { onTop: boolean }).onTop;
              last = next;
              return still;
            }),
            last,
          ).toBe(true);
          return JSON.parse(last) as { x: number; y: number };
        }

        async function dragEnd(
          handle: { x: number; y: number },
          {
            word,
            at,
            from = seedText,
          }: {
            word: string;
            at: number;
            from?: string;
          },
        ): Promise<string> {
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                wordText,
              }: { attachmentPath: string; wordText: string },
            ) => {
              const wordRect = (word: string) => {
                const layer = pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelector<HTMLElement>(
                    '.page[data-page-number="1"] .textLayer',
                  );
                if (!layer) return null;
                const walker = document.createTreeWalker(
                  layer,
                  NodeFilter.SHOW_TEXT,
                );
                let node;
                while ((node = walker.nextNode())) {
                  const at = (node as Text).data.indexOf(word);
                  if (at >= 0) {
                    const range = document.createRange();
                    range.setStart(node, at);
                    range.setEnd(node, at + word.length);
                    return range.getBoundingClientRect();
                  }
                }
                return null;
              };
              const box = wordRect(wordText);
              return !!box && box.width > 0 && box.height > 0;
            },
            { attachmentPath, wordText: word },
            {
              what: "the word to hit on page 1 text layer to have a visible box",
            },
          );
          const pressed = await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                wordText,
                offsetRatio,
                handleX,
                handleY,
              }: {
                attachmentPath: string;
                wordText: string;
                offsetRatio: number;
                handleX: number;
                handleY: number;
              },
            ) => {
              const { fire } = pageHelpers;
              const wordRect = (word: string) => {
                const layer = pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelector<HTMLElement>(
                    '.page[data-page-number="1"] .textLayer',
                  );
                if (!layer) return null;
                const walker = document.createTreeWalker(
                  layer,
                  NodeFilter.SHOW_TEXT,
                );
                let node;
                while ((node = walker.nextNode())) {
                  const at = (node as Text).data.indexOf(word);
                  if (at >= 0) {
                    const range = document.createRange();
                    range.setStart(node, at);
                    range.setEnd(node, at + word.length);
                    return range.getBoundingClientRect();
                  }
                }
                return null;
              };
              const box = wordRect(wordText);
              const x = box!.left + box!.width * offsetRatio,
                y = box!.top + box!.height / 2;
              const node = fire("pointerdown", handleX, handleY);
              const container =
                pageHelpers.pdfView(attachmentPath)!.containerEl;
              fire(
                "pointermove",
                (handleX + x) / 2,
                (handleY + y) / 2,
                container,
              );
              fire("pointermove", x, y, container);
              pageHelpers.scratch.__ztTo = [x, y];
              return {
                grip: (node as HTMLElement | SVGElement).dataset.ztGrip,
                to: [x, y],
              };
            },
            {
              attachmentPath,
              wordText: word,
              offsetRatio: at,
              handleX: handle.x,
              handleY: handle.y,
            },
          );
          expect(pressed.grip).toBe("end");
          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              { attachmentPath }: { attachmentPath: string },
            ) => {
              const { fire } = pageHelpers;
              const [x, y] = pageHelpers.scratch.__ztTo!;
              const container =
                pageHelpers.pdfView(attachmentPath)!.containerEl;
              fire("pointerup", x, y, container);
              fire("click", x, y, container);
            },
            { attachmentPath },
          );
          expect(
            await waitFor(
              async () =>
                (await highlight.stored()).data.annotationText !== from,
            ),
          ).toBe(true);
          await highlight.settled();
          return (await highlight.stored()).data.annotationText!;
        }

        beforeAll(async () => {
          if (!(await isZoteroReaderOpen(rdp)))
            setReaderTabID(await openZoteroReader(rdp));
          await highlight.restore();
          await raiseWindow(vaultId!);
        });

        afterEach(highlight.restore);

        it("extends the quote by one word from its end handle", async () => {
          const handle = await selectHighlight();
          const text = await dragEnd(handle, {
            word: "Furthermore,",
            at: 0.99,
          });
          expect(text).toBe(`${seedText} Furthermore,`);

          const stored = await highlight.stored();
          const position = JSON.parse(stored.data.annotationPosition) as {
            pageIndex: number;
            rects: number[][];
            nextPageRects?: number[][];
          };
          expect(position.pageIndex).toBe(0);
          expect(position.nextPageRects).toBeUndefined();
          expect(position.rects.slice(0, 3)).toEqual(seedRects.slice(0, 3));
          expect(position.rects).toHaveLength(4);
          expect(position.rects[3]![0]).toBe(seedRects[3]![0]);
          expect(position.rects[3]![2]).toBeGreaterThan(seedRects[3]![2]! + 20);
          expect(stored.data.annotationSortIndex).toBe(
            await recomputedSortIndex(vaultId!, {
              attachmentPath,
              position: stored.data.annotationPosition,
            }),
          );

          expect(
            await waitFor(async () => {
              const held = await highlight.held();
              return (
                held?.position === stored.data.annotationPosition &&
                held.text === text
              );
            }),
          ).toBe(true);

          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                highlightKey,
                expectedWidth,
              }: {
                attachmentPath: string;
                highlightKey: "Q8ZR4TDH";
                expectedWidth: string;
              },
            ) => {
              return (
                Math.abs(
                  Number(
                    [
                      ...pageHelpers
                        .pdfView(attachmentPath)!
                        .containerEl.querySelectorAll<SVGGraphicsElement>(
                          `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(highlightKey)}]`,
                        ),
                    ][3]?.getAttribute("width"),
                  ) - Number(expectedWidth),
                ) < 0.001
              );
            },
            {
              attachmentPath,
              highlightKey,
              expectedWidth: (
                position.rects[3]![2]! - position.rects[3]![0]!
              ).toFixed(3),
            },
            {
              what: "the highlight Q8ZR4TDH last line mark to widen by one word",
            },
          );
          await obRunUntil(
            vaultId!,
            async ({ app }, { highlightKey }: { highlightKey: "Q8ZR4TDH" }) => {
              const card = app.workspace
                .getLeavesOfType("zotero-annotation-view")
                .map(({ view }) =>
                  view.containerEl.querySelector<HTMLElement>(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(highlightKey)}]`,
                  ),
                )
                .find(Boolean);
              if (!card) return "no card";
              return [...card.querySelectorAll<HTMLElement>("*")].some(
                (node) =>
                  node.childElementCount === 0 &&
                  ((text) => text.includes("just a few. Furthermore,"))(
                    node.textContent,
                  ),
              );
            },
            { highlightKey },
            {
              what: "the Annotation Card for Q8ZR4TDH to show the extended quote text",
            },
          );
        }, 120000);

        it("puts the quoted text and the range back for the undo key", async () => {
          await reopenPdfView(vaultId!, attachmentPath);
          const handle = await selectHighlight();
          const text = await dragEnd(handle, {
            word: "Furthermore,",
            at: 0.99,
          });
          expect(text).toBe(`${seedText} Furthermore,`);

          expect(await undoKey()).toEqual({ handled: true });
          await stepSettled();

          expect(
            await waitFor(
              async () =>
                (await highlight.stored()).data.annotationText === seedText,
            ),
          ).toBe(true);
          await highlight.settled();
          const stored = await highlight.stored();
          expect(stored.data.annotationPosition).toBe(
            highlight.seed.annotationPosition,
          );
          expect(stored.data.annotationSortIndex).toBe(
            highlight.seed.annotationSortIndex,
          );

          expect(
            await waitFor(async () => {
              const held = await highlight.held();
              return (
                held?.text === seedText &&
                held.position === highlight.seed.annotationPosition
              );
            }),
          ).toBe(true);
          await obRunUntil(
            vaultId!,
            async ({ app }, { highlightKey }: { highlightKey: "Q8ZR4TDH" }) => {
              const card = app.workspace
                .getLeavesOfType("zotero-annotation-view")
                .map(({ view }) =>
                  view.containerEl.querySelector<HTMLElement>(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(highlightKey)}]`,
                  ),
                )
                .find(Boolean);
              if (!card) return "no card";
              return [...card.querySelectorAll<HTMLElement>("*")].some(
                (node) =>
                  node.childElementCount === 0 &&
                  ((text) => text.trimEnd().endsWith("just a few."))(
                    node.textContent,
                  ),
              );
            },
            { highlightKey },
            {
              what: "the Annotation Card for Q8ZR4TDH to show the quote ending at just a few",
            },
          );
        }, 120000);

        it("takes the text of the new range over a Text Edit, as Zotero's reader does", async () => {
          const typed = "Corrected by hand";
          await obRun(
            vaultId!,
            async (
              { zotlit },
              {
                highlightKey,
                typed,
              }: { highlightKey: "Q8ZR4TDH"; typed: "Corrected by hand" },
            ) => {
              const { annotationRepository: repository, bridge } =
                zotlit.services;
              bridge.runSync(
                repository.editTextField("text", highlightKey, typed),
              );
              await bridge.runPromise(
                repository.submitTextField("text", highlightKey),
              );
            },
            { highlightKey, typed },
          );
          expect(
            await waitFor(
              async () =>
                (await highlight.stored()).data.annotationText === typed,
            ),
          ).toBe(true);
          await highlight.settled();

          const handle = await selectHighlight();
          await dragEnd(handle, {
            word: "Furthermore,",
            at: 0.99,
            from: typed,
          });

          const extended = `${seedText} Furthermore,`;
          expect(
            await waitFor(
              async () =>
                (await highlight.stored()).data.annotationText === extended,
            ),
          ).toBe(true);
          expect(
            await waitFor(
              async () => (await highlight.held())?.text === extended,
            ),
          ).toBe(true);
          await obRunUntil(
            vaultId!,
            async ({ app }, { highlightKey }: { highlightKey: "Q8ZR4TDH" }) => {
              const card = app.workspace
                .getLeavesOfType("zotero-annotation-view")
                .map(({ view }) =>
                  view.containerEl.querySelector<HTMLElement>(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(highlightKey)}]`,
                  ),
                )
                .find(Boolean);
              if (!card) return "no card";
              return [...card.querySelectorAll<HTMLElement>("*")].some(
                (node) =>
                  node.childElementCount === 0 &&
                  ((text) => text.includes("just a few. Furthermore,"))(
                    node.textContent,
                  ),
              );
            },
            { highlightKey },
            {
              what: "the Annotation Card for Q8ZR4TDH to show the new range text after a Text Edit",
            },
          );
        }, 120000);

        it("keeps one character when the end is dragged back past the start", async () => {
          const handle = await selectHighlight();
          const text = await dragEnd(handle, { word: "automatic", at: 0.1 });
          expect(text).toBe("T");

          const position = JSON.parse(
            (await highlight.stored()).data.annotationPosition,
          ) as { rects: number[][] };
          expect(position.rects).toHaveLength(1);
          expect(position.rects[0]![0]).toBe(seedRects[0]![0]);
        }, 120000);

        it("extends the quote by one character for Shift+ArrowRight", async () => {
          await selectHighlight();
          const prevented = await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              { attachmentPath }: { attachmentPath: string },
            ) => {
              const event = new KeyboardEvent("keydown", {
                key: "ArrowRight",
                shiftKey: true,
                bubbles: true,
                cancelable: true,
              });
              pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.dispatchEvent(event);
              return event.defaultPrevented;
            },
            { attachmentPath },
          );
          expect(prevented).toBe(true);
          expect(
            await waitFor(
              async () =>
                (await highlight.stored()).data.annotationText !== seedText,
            ),
          ).toBe(true);
          await highlight.settled();

          const stored = await highlight.stored();
          const text = `${seedText} F`;
          expect(stored.data.annotationText).toBe(text);
          expect(stored.data.annotationSortIndex).toBe(
            await recomputedSortIndex(vaultId!, {
              attachmentPath,
              position: stored.data.annotationPosition,
            }),
          );

          expect(
            await waitFor(async () => {
              const held = await highlight.held();
              return (
                held?.position === stored.data.annotationPosition &&
                held.text === text
              );
            }),
          ).toBe(true);
          await obRunUntil(
            vaultId!,
            async ({ app }, { highlightKey }: { highlightKey: "Q8ZR4TDH" }) => {
              const card = app.workspace
                .getLeavesOfType("zotero-annotation-view")
                .map(({ view }) =>
                  view.containerEl.querySelector<HTMLElement>(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(highlightKey)}]`,
                  ),
                )
                .find(Boolean);
              if (!card) return "no card";
              return [...card.querySelectorAll<HTMLElement>("*")].some(
                (node) =>
                  node.childElementCount === 0 &&
                  ((text) => text.trimEnd().endsWith("just a few. F"))(
                    node.textContent,
                  ),
              );
            },
            { highlightKey },
            {
              what: "the Annotation Card for Q8ZR4TDH to quote one more character",
            },
          );
        }, 120000);
      });

      registerPdfUnchangedCase();
    },
  );
});
