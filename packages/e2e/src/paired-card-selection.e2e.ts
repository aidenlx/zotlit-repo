import { isDeepStrictEqual } from "node:util";
import type { FileView } from "obsidian";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnnotationView } from "@zotlit/query-views/desktop/annot-view/view.tsx";

import { clearNotices, obRun, obRunUntil, waitFor } from "./obsidian-cli.ts";
import type { LibraryWorkerMessage } from "./page-library-types.ts";
import type { PairedScope, PairedWriteProbe } from "./page-paired-types.ts";
import {
  annotationKeys,
  madeSince,
  platformKey,
  pressKey,
  rdp,
  redoKey,
  registerPairedReaderSession,
  registerPdfUnchangedCase,
  seededMark,
  stepSettled,
  undoKey,
  whileEditingNotLive,
  poll,
} from "./paired-reader-session.ts";
import {
  ATTACHMENT_ITEM,
  annotationColor,
  api,
  attachment,
  attachmentPath,
  baseUrl,
  debuggerPort,
  effectPath,
  m,
  readAnnotationState,
  registerPairedRun,
  restoreAnnotationComment,
  restoreWriteOutcomeProbe,
  serverID,
  vaultId,
} from "./paired-run-fixture.ts";
import {
  eraseAnnotations,
  storedAnnotation,
  zoteroFetch,
} from "./paired-zotero.ts";
import { raiseWindow, reopenPdfView } from "./reader-gestures.ts";

describe.skipIf(!baseUrl)("Paired Run", () => {
  registerPairedRun();

  describe.skipIf(!debuggerPort || !vaultId)(
    "ZotLit and Zotero on one Fixture",
    () => {
      registerPairedReaderSession();

      describe("the Card Selection", () => {
        const cardKey = "Q8ZR4TDH";
        const markKey = "PUPR5FG5";

        const shown = () =>
          obRun(
            vaultId!,
            async (
              { app, page: pageHelpers },
              { attachmentPath }: { attachmentPath: string },
            ) => {
              const cards = [
                ...(app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view?.containerEl.querySelectorAll<HTMLElement>(
                    ".zt-annot-card[data-selected]",
                  ) ?? []),
              ].map((card) => card.dataset.zoteroAnnotationKey);
              const marks = [
                ...new Set(
                  [
                    ...pageHelpers
                      .pdfView(attachmentPath)!
                      .containerEl.querySelectorAll<SVGGraphicsElement>(
                        ".zt-pdf-annotation-mark.is-selected",
                      ),
                  ].map((mark) => mark.dataset.zoteroAnnotationKey),
                ),
              ];
              return {
                cards,
                marks,
                popup:
                  !!document.querySelector<HTMLElement>(".zt-pdf-mark-popup"),
              };
            },
            { attachmentPath },
          );

        async function clickCard(key: string): Promise<void> {
          await obRunUntil(
            vaultId!,
            async ({ app, page: pageHelpers }, { key }: { key: string }) => {
              const { press } = pageHelpers;
              const card = app.workspace
                .getLeavesOfType("zotero-annotation-view")[0]
                ?.view?.containerEl.querySelector<HTMLElement>(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(key)}]`,
                );
              if (!card) return "no card";
              press(card, "card");
              return "clicked";
            },
            { key },
            {
              ready: (value) => value === "clicked",
              what: "the Annotation Card for the selection key to accept a press",
            },
          );
        }

        beforeEach(async () => {
          await reopenPdfView(vaultId!, attachmentPath);
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                markKey,
              }: { attachmentPath: string; markKey: "PUPR5FG5" },
            ) => {
              const view = pageHelpers.pdfView(attachmentPath)!;
              if (!view) return "no view";
              void view.reader!.navigate({ pageIndex: 0 });
              const rect = view.containerEl
                .querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(markKey)}]`,
                )
                ?.getBoundingClientRect();
              return !!rect && rect.width > 0;
            },
            { attachmentPath, markKey },
            { what: "the PDF mark PUPR5FG5 to render in the PDF view" },
          );
        });

        async function tapMark(key: string): Promise<void> {
          expect(
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                {
                  attachmentPath,
                  key,
                }: { attachmentPath: string; key: string },
              ) => {
                const { tap } = pageHelpers;
                const mark = pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelector<SVGGraphicsElement>(
                    `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(key)}]`,
                  );
                const rect = mark!.getBoundingClientRect();
                tap(rect.left + rect.width / 2, rect.top + rect.height / 2);
                return "tapped";
              },
              { attachmentPath, key },
            ),
          ).toBe("tapped");
        }

        const command = (id: string) =>
          obRun(
            vaultId!,
            async ({ app }, { id }: { id: string }) => {
              app.commands.executeCommandById(id);
              return (
                app.workspace.getLeavesOfType("zotero-annotation-view")[0]
                  ?.view as AnnotationView
              )?.snapshot.followMode;
            },
            { id },
          );

        it("selects a card in Pinned mode, and clears it for Escape", async () => {
          expect(await command("zotlit:annot-view-pin-current-item")).toBe(
            "pinned",
          );
          try {
            await clickCard(cardKey);
            await expect
              .poll(shown, poll)
              .toEqual({ cards: [cardKey], marks: [], popup: false });

            expect(
              await obRun(
                vaultId!,
                async ({ app }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
                  const leaf = app.workspace.getLeavesOfType(
                    "zotero-annotation-view",
                  )[0];
                  app.workspace.setActiveLeaf(leaf!, { focus: true });
                  const card = app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view?.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                    );
                  card!.focus();
                  const event = new KeyboardEvent("keydown", {
                    key: "Escape",
                    code: "Escape",
                    bubbles: true,
                    cancelable: true,
                  });
                  card!.dispatchEvent(event);
                  return { prevented: event.defaultPrevented };
                },
                { cardKey },
              ),
            ).toEqual({ prevented: true });
            await expect
              .poll(shown, poll)
              .toEqual({ cards: [], marks: [], popup: false });
          } finally {
            await command("zotlit:annot-view-unpin");
            await obRun(
              vaultId!,
              async (
                { app, page: pageHelpers },
                { attachmentPath }: { attachmentPath: string },
              ) => {
                app.workspace.setActiveLeaf(
                  pageHelpers.pdfView(attachmentPath)!.leaf,
                  { focus: true },
                );
              },
              { attachmentPath },
            );
          }
        }, 120000);

        it("lands quietly on a clicked card's mark, and selects the card of a clicked mark", async () => {
          expect(
            await obRun(
              vaultId!,
              async ({ app }) => {
                return (
                  app.workspace.getLeavesOfType("zotero-annotation-view")[0]
                    ?.view as AnnotationView
                )?.snapshot.followMode;
              },
              undefined,
            ),
          ).toBe("active-tab");
          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              { attachmentPath }: { attachmentPath: string },
            ) => {
              void pageHelpers
                .pdfView(attachmentPath)!
                .reader!.navigate({ pageIndex: 3 });
            },
            { attachmentPath },
          );

          await clickCard(cardKey);
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                cardKey,
              }: { attachmentPath: string; cardKey: "Q8ZR4TDH" },
            ) => {
              const view = pageHelpers.pdfView(attachmentPath)!;
              const box = view.reader!.container.getBoundingClientRect();
              const mark = view.containerEl.querySelector<SVGGraphicsElement>(
                `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
              );
              const rect = mark?.getBoundingClientRect();
              return (
                !!mark &&
                mark.classList.contains("is-selected") &&
                rect!.top >= box.top &&
                rect!.bottom <= box.bottom
              );
            },
            { attachmentPath, cardKey },
            {
              what: "the PDF mark Q8ZR4TDH to be selected and inside the visible viewer",
            },
          );
          expect(await shown()).toEqual({
            cards: [cardKey],
            marks: [cardKey],
            popup: false,
          });

          await tapMark(markKey);
          await expect
            .poll(shown, poll)
            .toMatchObject({ cards: [markKey], marks: [markKey] });
        }, 120000);

        it("keeps one editor open on a card: its comment editor or its tag editor", async () => {
          await raiseWindow(vaultId!);
          await clickCard(cardKey);
          await expect
            .poll(shown, poll)
            .toMatchObject({ cards: [cardKey], marks: [cardKey] });

          const editors = () =>
            obRun(
              vaultId!,
              async ({ app }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
                return {
                  comment: !!app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view?.containerEl.querySelector(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                    )
                    ?.querySelector<HTMLElement>(".cm-content"),
                  tags: !!app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view?.containerEl.querySelector(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                    )
                    ?.querySelector<HTMLInputElement>("[data-slot=tags-input]"),
                };
              },
              { cardKey },
            );

          await obRun(
            vaultId!,
            async ({ zotlit }) => {
              zotlit.services.queryClient.client.removeQueries({
                queryKey: ["annotations"],
              });
            },
            undefined,
          );
          await obRun(
            vaultId!,
            async (
              { app },
              { modifiers, cardKey }: { modifiers: []; cardKey: "Q8ZR4TDH" },
            ) => {
              const target = app.workspace
                .getLeavesOfType("zotero-annotation-view")[0]
                ?.view?.containerEl.querySelector(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                )
                ?.querySelector<HTMLElement>(".zt-annot-comment-field");
              target!.scrollIntoView({
                block: "center",
                inline: "nearest",
                behavior: "instant",
              });
              const rect = target!.getBoundingClientRect();
              const zoom = (
                require("electron") as {
                  webFrame: {
                    getZoomFactor(): number;
                  };
                }
              ).webFrame.getZoomFactor();
              const x = Math.round((rect.left + rect.width / 2) * zoom),
                y = Math.round((rect.top + rect.height / 2) * zoom);
              const contents = (
                require("@electron/remote") as {
                  getCurrentWebContents(): {
                    sendInputEvent(event: object): void;
                  };
                }
              ).getCurrentWebContents();
              contents.sendInputEvent({
                type: "mouseDown",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              contents.sendInputEvent({
                type: "mouseUp",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              return "clicked";
            },
            { modifiers: [], cardKey },
          ).then((value) => {
            expect(value).toBe("clicked");
          });
          await expect
            .poll(editors, poll)
            .toEqual({ comment: true, tags: false });

          await using heldQuery = new AsyncDisposableStack();
          heldQuery.defer(async () => {
            await obRun(
              vaultId!,
              async ({ page: pageHelpers }) => {
                pageHelpers.scratch.__zlHeldAnnotationQuery?.restore!();
                delete pageHelpers.scratch.__zlHeldAnnotationQuery;
              },
              undefined,
            );
          });
          await obRun(
            vaultId!,
            async ({ zotlit, page: pageHelpers }) => {
              const services = zotlit.services;
              const db = services.zoteroReads;
              // oxlint-disable-next-line typescript/unbound-method -- Restored unchanged and called with the original worker receiver.
              const post = Worker.prototype.postMessage;
              const pending: (() => void)[] = [];
              const state: {
                changed: boolean;
                heldReads: number;
                restore: (() => void) | null;
              } = { changed: false, heldReads: 0, restore: null };
              const off = services.bridge.subscribe(db.events, (event) => {
                if (event._tag === "changed") state.changed = true;
              });
              state.restore = () => {
                Worker.prototype.postMessage = post;
                off();
                for (const send of pending.splice(0)) send();
              };
              pageHelpers.scratch.__zlHeldAnnotationQuery = state;
              Worker.prototype.postMessage = new Proxy(post, {
                apply: (
                  postTarget,
                  receiver: Worker,
                  args: Parameters<Worker["postMessage"]>,
                ) => {
                  const request = (args[0] as LibraryWorkerMessage)?.[1];
                  if (
                    request?.tag !== "ItemQuery" ||
                    !("view" in request.payload.job) ||
                    request.payload.job.view.from !== "annotations"
                  )
                    return Reflect.apply(postTarget, receiver, args);
                  state.heldReads++;
                  pending.push(() => Reflect.apply(postTarget, receiver, args));
                },
              });
              await services.bridge.runPromise(db.refresh);
            },
            undefined,
          );
          await obRunUntil(
            vaultId!,
            async ({ page: pageHelpers }) => {
              return (
                pageHelpers.scratch.__zlHeldAnnotationQuery!.changed &&
                pageHelpers.scratch.__zlHeldAnnotationQuery!.heldReads > 0
              );
            },
            undefined,
            {
              what: "the held annotation query to report a change after a held worker read",
            },
          );

          await obRun(
            vaultId!,
            async (
              { app },
              { modifiers, cardKey }: { modifiers: []; cardKey: "Q8ZR4TDH" },
            ) => {
              const target = app.workspace
                .getLeavesOfType("zotero-annotation-view")[0]
                ?.view?.containerEl.querySelector(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                )
                ?.querySelector(`.clickable-icon:has(svg.lucide-${"tag"})`);
              target!.scrollIntoView({
                block: "center",
                inline: "nearest",
                behavior: "instant",
              });
              const rect = target!.getBoundingClientRect();
              const zoom = (
                require("electron") as {
                  webFrame: {
                    getZoomFactor(): number;
                  };
                }
              ).webFrame.getZoomFactor();
              const x = Math.round((rect.left + rect.width / 2) * zoom),
                y = Math.round((rect.top + rect.height / 2) * zoom);
              const contents = (
                require("@electron/remote") as {
                  getCurrentWebContents(): {
                    sendInputEvent(event: object): void;
                  };
                }
              ).getCurrentWebContents();
              contents.sendInputEvent({
                type: "mouseDown",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              contents.sendInputEvent({
                type: "mouseUp",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              return "clicked";
            },
            { modifiers: [], cardKey },
          ).then((value) => {
            expect(value).toBe("clicked");
          });
          await expect
            .poll(editors, poll)
            .toEqual({ comment: false, tags: true });

          await obRun(
            vaultId!,
            async (
              { app },
              { modifiers, cardKey }: { modifiers: []; cardKey: "Q8ZR4TDH" },
            ) => {
              const target = app.workspace
                .getLeavesOfType("zotero-annotation-view")[0]
                ?.view?.containerEl.querySelector(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                )
                ?.querySelector<HTMLElement>(".zt-annot-comment-field");
              target!.scrollIntoView({
                block: "center",
                inline: "nearest",
                behavior: "instant",
              });
              const rect = target!.getBoundingClientRect();
              const zoom = (
                require("electron") as {
                  webFrame: {
                    getZoomFactor(): number;
                  };
                }
              ).webFrame.getZoomFactor();
              const x = Math.round((rect.left + rect.width / 2) * zoom),
                y = Math.round((rect.top + rect.height / 2) * zoom);
              const contents = (
                require("@electron/remote") as {
                  getCurrentWebContents(): {
                    sendInputEvent(event: object): void;
                  };
                }
              ).getCurrentWebContents();
              contents.sendInputEvent({
                type: "mouseDown",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              contents.sendInputEvent({
                type: "mouseUp",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              return "clicked";
            },
            { modifiers: [], cardKey },
          ).then((value) => {
            expect(value).toBe("clicked");
          });
          await expect
            .poll(editors, poll)
            .toEqual({ comment: true, tags: false });

          expect(
            await obRun(
              vaultId!,
              async (_context) => {
                const contents =
                  require("@electron/remote").getCurrentWebContents();
                contents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
                contents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
                return "pressed";
              },
              undefined,
            ),
          ).toBe("pressed");
          await expect
            .poll(editors, poll)
            .toEqual({ comment: false, tags: false });
        }, 120000);

        it("saves a comment typed into the comment field of a card selected in Pinned mode", async () => {
          await raiseWindow(vaultId!);

          const original =
            (await readAnnotationState(api, serverID, cardKey)).comment ?? "";
          const typed = "Saved through the comment field";
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
          expect(await command("zotlit:annot-view-pin-current-item")).toBe(
            "pinned",
          );
          try {
            expect(
              await obRun(
                vaultId!,
                async ({ app }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
                  return !!app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view?.containerEl.querySelector(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                    )
                    ?.querySelector<HTMLElement>(".zt-annot-comment-field");
                },
                { cardKey },
              ),
            ).toBe(false);
            await clickCard(cardKey);
            await expect.poll(shown, poll).toMatchObject({ cards: [cardKey] });

            await obRun(
              vaultId!,
              async (
                { app },
                { modifiers, cardKey }: { modifiers: []; cardKey: "Q8ZR4TDH" },
              ) => {
                const target = app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view?.containerEl.querySelector(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                  )
                  ?.querySelector<HTMLElement>(".zt-annot-comment-field");
                target!.scrollIntoView({
                  block: "center",
                  inline: "nearest",
                  behavior: "instant",
                });
                const rect = target!.getBoundingClientRect();
                const zoom = (
                  require("electron") as {
                    webFrame: {
                      getZoomFactor(): number;
                    };
                  }
                ).webFrame.getZoomFactor();
                const x = Math.round((rect.left + rect.width / 2) * zoom),
                  y = Math.round((rect.top + rect.height / 2) * zoom);
                const contents = (
                  require("@electron/remote") as {
                    getCurrentWebContents(): {
                      sendInputEvent(event: object): void;
                    };
                  }
                ).getCurrentWebContents();
                contents.sendInputEvent({
                  type: "mouseDown",
                  x,
                  y,
                  button: "left",
                  clickCount: 1,
                  modifiers,
                });
                contents.sendInputEvent({
                  type: "mouseUp",
                  x,
                  y,
                  button: "left",
                  clickCount: 1,
                  modifiers,
                });
                return "clicked";
              },
              { modifiers: [], cardKey },
            ).then((value) => {
              expect(value).toBe("clicked");
            });
            await expect
              .poll(
                () =>
                  obRun(
                    vaultId!,
                    async ({ app }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
                      return String(
                        !!app.workspace
                          .getLeavesOfType("zotero-annotation-view")[0]
                          ?.view?.containerEl.querySelector(
                            `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                          )
                          ?.querySelector<HTMLElement>(".cm-content")
                          ?.contains(document.activeElement),
                      );
                    },
                    { cardKey },
                  ),
                poll,
              )
              .toBe("true");
            await obRun(
              vaultId!,
              async (
                { app },
                {
                  typed,
                  cardKey,
                }: {
                  typed: "Saved through the comment field";
                  cardKey: "Q8ZR4TDH";
                },
              ) => {
                const editor = app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view?.containerEl.querySelector(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                  )
                  ?.querySelector<HTMLElement>(".cm-content");
                editor!.doc.execCommand("selectAll");
                editor!.doc.execCommand("insertText", false, typed);
              },
              { typed, cardKey },
            );
            await obRun(
              vaultId!,
              async (
                { app },
                { modifiers, cardKey }: { modifiers: []; cardKey: "Q8ZR4TDH" },
              ) => {
                const target = app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view?.containerEl.querySelector(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                  )
                  ?.querySelector("blockquote");
                target!.scrollIntoView({
                  block: "center",
                  inline: "nearest",
                  behavior: "instant",
                });
                const rect = target!.getBoundingClientRect();
                const zoom = (
                  require("electron") as {
                    webFrame: {
                      getZoomFactor(): number;
                    };
                  }
                ).webFrame.getZoomFactor();
                const x = Math.round((rect.left + rect.width / 2) * zoom),
                  y = Math.round((rect.top + rect.height / 2) * zoom);
                const contents = (
                  require("@electron/remote") as {
                    getCurrentWebContents(): {
                      sendInputEvent(event: object): void;
                    };
                  }
                ).getCurrentWebContents();
                contents.sendInputEvent({
                  type: "mouseDown",
                  x,
                  y,
                  button: "left",
                  clickCount: 1,
                  modifiers,
                });
                contents.sendInputEvent({
                  type: "mouseUp",
                  x,
                  y,
                  button: "left",
                  clickCount: 1,
                  modifiers,
                });
                return "clicked";
              },
              { modifiers: [], cardKey },
            ).then((value) => {
              expect(value).toBe("clicked");
            });
            await expect
              .poll(
                () =>
                  obRun(
                    vaultId!,
                    async ({ app }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
                      return String(
                        !!app.workspace
                          .getLeavesOfType("zotero-annotation-view")[0]
                          ?.view?.containerEl.querySelector(
                            `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                          )
                          ?.querySelector<HTMLElement>(".cm-content"),
                      );
                    },
                    { cardKey },
                  ),
                poll,
              )
              .toBe("false");
            expect(
              await waitFor(
                async () =>
                  (await readAnnotationState(api, serverID, cardKey))
                    .comment === typed,
              ),
            ).toBe(true);
          } finally {
            await command("zotlit:annot-view-unpin");
            await obRun(
              vaultId!,
              async (
                { app, page: pageHelpers },
                { attachmentPath }: { attachmentPath: string },
              ) => {
                app.workspace.setActiveLeaf(
                  pageHelpers.pdfView(attachmentPath)!.leaf,
                  { focus: true },
                );
              },
              { attachmentPath },
            );
            await obRunUntil(
              vaultId!,
              async ({ zotlit }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
                const { annotationRepository: repository, bridge } =
                  zotlit.services;
                return (
                  bridge.runSync(repository.mutationFor(cardKey)).kind ===
                    "idle" &&
                  !bridge.runSync(repository.textDraftFor("comment", cardKey))
                );
              },
              { cardKey },
              {
                what: "the Q8ZR4TDH mutation to go idle with no comment draft",
              },
            );
            await restoreAnnotationComment(api, {
              serverID,
              key,
              annotationKey: cardKey,
              comment: original,
            });
          }
        }, 120000);

        it("keeps the card an editor is open on through a mark click, and takes the mark once it closes", async () => {
          await raiseWindow(vaultId!);
          await clickCard(cardKey);
          await expect
            .poll(shown, poll)
            .toMatchObject({ cards: [cardKey], marks: [cardKey] });

          await obRunUntil(
            vaultId!,
            async (
              { app, page: pageHelpers },
              { cardKey }: { cardKey: "Q8ZR4TDH" },
            ) => {
              const { press } = pageHelpers;
              if (
                app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view?.containerEl.querySelector<HTMLElement>(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                  )
                  ?.querySelector<HTMLElement>(".cm-content")
              )
                return "open";
              getSelection()!.removeAllRanges();
              press(
                app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view?.containerEl.querySelector<HTMLElement>(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                  )
                  ?.querySelector<HTMLElement>(".zt-annot-comment-field"),
                "comment field",
              );
              return (
                !!app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view?.containerEl.querySelector<HTMLElement>(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                  )
                  ?.querySelector<HTMLElement>(".cm-content") && "open"
              );
            },
            { cardKey },
            {
              ready: (value) => value === "open",
              what: "the comment editor on card Q8ZR4TDH to open after a press",
            },
          );
          await obRun(
            vaultId!,
            async (
              { app },
              { cardKey, modifiers }: { cardKey: "Q8ZR4TDH"; modifiers: [] },
            ) => {
              const target = app.workspace
                .getLeavesOfType("zotero-annotation-view")[0]
                ?.view?.containerEl.querySelector(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                )
                ?.querySelector<HTMLElement>(".cm-content");
              target!.scrollIntoView({
                block: "center",
                inline: "nearest",
                behavior: "instant",
              });
              const rect = target!.getBoundingClientRect();
              const zoom = (
                require("electron") as {
                  webFrame: {
                    getZoomFactor(): number;
                  };
                }
              ).webFrame.getZoomFactor();
              const x = Math.round((rect.left + rect.width / 2) * zoom),
                y = Math.round((rect.top + rect.height / 2) * zoom);
              const contents = (
                require("@electron/remote") as {
                  getCurrentWebContents(): {
                    sendInputEvent(event: object): void;
                  };
                }
              ).getCurrentWebContents();
              contents.sendInputEvent({
                type: "mouseDown",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              contents.sendInputEvent({
                type: "mouseUp",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              return "clicked";
            },
            { cardKey, modifiers: [] },
          ).then((value) => {
            expect(value).toBe("clicked");
          });
          await obRunUntil(
            vaultId!,
            async ({ app }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
              return !!app.workspace
                .getLeavesOfType("zotero-annotation-view")[0]
                ?.view?.containerEl.querySelector<HTMLElement>(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                )
                ?.querySelector<HTMLElement>(".cm-content")
                ?.contains(document.activeElement);
            },
            { cardKey },
            { what: "the card editor for Q8ZR4TDH to hold keyboard focus" },
          );

          await obRun(
            vaultId!,
            async (
              { app, page },
              {
                modifiers,
                attachmentPath,
                markKey,
              }: { modifiers: []; attachmentPath: string; markKey: "PUPR5FG5" },
            ) => {
              const target = app.workspace
                .getLeavesOfType(page.reader.viewType)
                .map(({ view }) => view)
                .find(
                  (view) =>
                    (view as FileView).file?.path === attachmentPath &&
                    view.containerEl.getBoundingClientRect().width > 0,
                )!
                .containerEl.querySelector(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(markKey)}]`,
                );
              target!.scrollIntoView({
                block: "center",
                inline: "nearest",
                behavior: "instant",
              });
              const rect = target!.getBoundingClientRect();
              const zoom = (
                require("electron") as {
                  webFrame: {
                    getZoomFactor(): number;
                  };
                }
              ).webFrame.getZoomFactor();
              const x = Math.round((rect.left + rect.width / 2) * zoom),
                y = Math.round((rect.top + rect.height / 2) * zoom);
              const contents = (
                require("@electron/remote") as {
                  getCurrentWebContents(): {
                    sendInputEvent(event: object): void;
                  };
                }
              ).getCurrentWebContents();
              contents.sendInputEvent({
                type: "mouseDown",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              contents.sendInputEvent({
                type: "mouseUp",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              return "clicked";
            },
            { modifiers: [], attachmentPath, markKey },
          ).then((value) => {
            expect(value).toBe("clicked");
          });
          await expect
            .poll(shown, poll)
            .toMatchObject({ cards: [cardKey], marks: [markKey] });
          expect(
            await obRun(
              vaultId!,
              async ({ app }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
                return JSON.stringify({
                  open: !!app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view?.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                    )
                    ?.querySelector<HTMLElement>(".cm-content"),
                  focused: !!app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view?.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                    )
                    ?.querySelector<HTMLElement>(".cm-content")
                    ?.contains(document.activeElement),
                });
              },
              { cardKey },
            ),
          ).toBe(JSON.stringify({ open: true, focused: false }));

          await obRun(
            vaultId!,
            async (
              { app },
              { cardKey, modifiers }: { cardKey: "Q8ZR4TDH"; modifiers: [] },
            ) => {
              const target = app.workspace
                .getLeavesOfType("zotero-annotation-view")[0]
                ?.view?.containerEl.querySelector(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                )
                ?.querySelector<HTMLElement>(".cm-content");
              target!.scrollIntoView({
                block: "center",
                inline: "nearest",
                behavior: "instant",
              });
              const rect = target!.getBoundingClientRect();
              const zoom = (
                require("electron") as {
                  webFrame: {
                    getZoomFactor(): number;
                  };
                }
              ).webFrame.getZoomFactor();
              const x = Math.round((rect.left + rect.width / 2) * zoom),
                y = Math.round((rect.top + rect.height / 2) * zoom);
              const contents = (
                require("@electron/remote") as {
                  getCurrentWebContents(): {
                    sendInputEvent(event: object): void;
                  };
                }
              ).getCurrentWebContents();
              contents.sendInputEvent({
                type: "mouseDown",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              contents.sendInputEvent({
                type: "mouseUp",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              return "clicked";
            },
            { cardKey, modifiers: [] },
          ).then((value) => {
            expect(value).toBe("clicked");
          });
          expect(
            await obRun(
              vaultId!,
              async (_context) => {
                const contents =
                  require("@electron/remote").getCurrentWebContents();
                contents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
                contents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
                return "pressed";
              },
              undefined,
            ),
          ).toBe("pressed");
          await expect
            .poll(shown, poll)
            .toMatchObject({ cards: [markKey], marks: [markKey] });
          expect(
            await obRun(
              vaultId!,
              async ({ app }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
                return !!app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view?.containerEl.querySelector<HTMLElement>(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                  )
                  ?.querySelector<HTMLElement>(".cm-content");
              },
              { cardKey },
            ),
          ).toBe(false);
        }, 120000);

        describe("a Text Edit", () => {
          const highlight = seededMark(cardKey, { image: false });

          async function chooseEditQuotedText(): Promise<void> {
            await obRun(
              vaultId!,
              async ({ app }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
                return (
                  app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view?.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                    )
                    ?.querySelector<HTMLElement>(
                      ".clickable-icon:has(svg.lucide-more-horizontal)",
                    )!
                    .scrollIntoView({ block: "nearest" }),
                  true
                );
              },
              { cardKey },
            );
            await obRun(
              vaultId!,
              async (
                { app },
                { cardKey, modifiers }: { cardKey: "Q8ZR4TDH"; modifiers: [] },
              ) => {
                const target = app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view?.containerEl.querySelector(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                  )
                  ?.querySelector(
                    ".clickable-icon:has(svg.lucide-more-horizontal)",
                  );
                target!.scrollIntoView({
                  block: "center",
                  inline: "nearest",
                  behavior: "instant",
                });
                const rect = target!.getBoundingClientRect();
                const zoom = (
                  require("electron") as {
                    webFrame: {
                      getZoomFactor(): number;
                    };
                  }
                ).webFrame.getZoomFactor();
                const x = Math.round((rect.left + rect.width / 2) * zoom),
                  y = Math.round((rect.top + rect.height / 2) * zoom);
                const contents = (
                  require("@electron/remote") as {
                    getCurrentWebContents(): {
                      sendInputEvent(event: object): void;
                    };
                  }
                ).getCurrentWebContents();
                contents.sendInputEvent({
                  type: "mouseDown",
                  x,
                  y,
                  button: "left",
                  clickCount: 1,
                  modifiers,
                });
                contents.sendInputEvent({
                  type: "mouseUp",
                  x,
                  y,
                  button: "left",
                  clickCount: 1,
                  modifiers,
                });
                return "clicked";
              },
              { cardKey, modifiers: [] },
            ).then((value) => {
              expect(value).toBe("clicked");
            });
            await obRunUntil(
              vaultId!,
              async (
                { page: pageHelpers },
                { menuItemLabel }: { menuItemLabel: string },
              ) => {
                const { press } = pageHelpers;
                const item =
                  document.querySelector<HTMLElement>(".menu .menu-item");
                if (!item) return "no menu";
                if (
                  item.textContent.trim() !== menuItemLabel ||
                  item.classList.contains("is-disabled")
                )
                  return "not offered";
                press(item, "Edit text");
                return "chosen";
              },
              { menuItemLabel: m.annot_view_menu_edit_text() },
              {
                ready: (value) => value === "chosen",
                what: "the Edit text menu item to be offered and clicked",
              },
            );
          }

          afterEach(highlight.restore);

          it("saves a correction typed after Edit quoted text in Pinned mode, with its range and Sort Index kept", async () => {
            await raiseWindow(vaultId!);
            expect(await command("zotlit:annot-view-pin-current-item")).toBe(
              "pinned",
            );
            try {
              expect(
                await obRun(
                  vaultId!,
                  async ({ app }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
                    return !!app.workspace
                      .getLeavesOfType("zotero-annotation-view")[0]
                      ?.view?.containerEl.querySelector<HTMLElement>(
                        `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                      )
                      ?.hasAttribute("data-alone");
                  },
                  { cardKey },
                ),
              ).toBe(false);
              await chooseEditQuotedText();
              await expect
                .poll(shown, poll)
                .toMatchObject({ cards: [cardKey] });
              await obRunUntil(
                vaultId!,
                async ({ app }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
                  return !!app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view?.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                    )
                    ?.querySelector<HTMLElement>("blockquote .cm-content")
                    ?.contains(document.activeElement);
                },
                { cardKey },
                {
                  what: "the excerpt block editor on card Q8ZR4TDH to hold the caret",
                },
              );
              await obRun(
                vaultId!,
                async (_context) => {
                  require("@electron/remote")
                    .getCurrentWebContents()
                    .insertText(" Checked.");
                },
                undefined,
              );
              await press("Escape");

              const corrected = `${highlight.seed.annotationText} Checked.`;
              expect(
                await waitFor(
                  async () =>
                    (await highlight.stored()).data.annotationText ===
                    corrected,
                ),
              ).toBe(true);
              expect((await highlight.stored()).data).toMatchObject({
                annotationPosition: highlight.seed.annotationPosition,
                annotationSortIndex: highlight.seed.annotationSortIndex,
              });
              await obRunUntil(
                vaultId!,
                async (
                  { app },
                  {
                    cardKey,
                    corrected,
                  }: { cardKey: "Q8ZR4TDH"; corrected: string },
                ) => {
                  return (
                    !app.workspace
                      .getLeavesOfType("zotero-annotation-view")[0]
                      ?.view?.containerEl.querySelector<HTMLElement>(
                        `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                      )
                      ?.querySelector<HTMLElement>("blockquote .cm-content") &&
                    app.workspace
                      .getLeavesOfType("zotero-annotation-view")[0]
                      ?.view?.containerEl.querySelector<HTMLElement>(
                        `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                      )!
                      .querySelector<HTMLElement>("blockquote")!.textContent ===
                      corrected
                  );
                },
                { cardKey, corrected },
                {
                  what: "the Q8ZR4TDH card to close its quote editor and show the correction",
                },
              );
            } finally {
              await command("zotlit:annot-view-unpin");
              await obRun(
                vaultId!,
                async (
                  { app, page: pageHelpers },
                  { attachmentPath }: { attachmentPath: string },
                ) => {
                  app.workspace.setActiveLeaf(
                    pageHelpers.pdfView(attachmentPath)!.leaf,
                    { focus: true },
                  );
                },
                { attachmentPath },
              );
            }
          }, 120000);

          it("shows a Write Conflict on the Quoted Text in its Excerpt Block once another card is selected, and Discard keeps Zotero's text", async () => {
            await raiseWindow(vaultId!);

            const inZotero = `${highlight.seed.annotationText} (edited in Zotero)`;
            const typed = `${highlight.seed.annotationText} Mine.`;

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
            const path = `users/0/items/${cardKey}`;

            await using cleanup = new AsyncDisposableStack();
            cleanup.defer(async () => {
              await restoreWriteOutcomeProbe(vaultId!);
              await obRun(
                vaultId!,
                async ({ zotlit }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
                  return (
                    zotlit.services.bridge.runSync(
                      zotlit.services.annotationRepository.discardTextDraft(
                        "text",
                        cardKey,
                      ),
                    ),
                    true
                  );
                },
                { cardKey },
              );
            });
            await installHeldWriteProbe(vaultId!);

            await clickCard(cardKey);
            await chooseEditQuotedText();
            await obRunUntil(
              vaultId!,
              async ({ app }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
                return !!app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view?.containerEl.querySelector<HTMLElement>(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                  )
                  ?.querySelector<HTMLElement>("blockquote .cm-content")
                  ?.contains(document.activeElement);
              },
              { cardKey },
              {
                what: "the quote editor on the Q8ZR4TDH card to hold keyboard focus",
              },
            );
            await obRun(
              vaultId!,
              async (_context) => {
                require("@electron/remote")
                  .getCurrentWebContents()
                  .insertText(" Mine.");
              },
              undefined,
            );
            await obRunUntil(
              vaultId!,
              async ({ page: pageHelpers }) => {
                return pageHelpers.scratch.__zotlitWriteOutcomeProbe!.reached;
              },
              undefined,
              {
                what: "the write outcome probe to record the conflicting write",
              },
            );

            const { version } = await highlight.stored();
            const edited = await zoteroFetch(api, path, {
              method: "PATCH",
              headers: {
                "Zotero-Server-ID": serverID,
                "Zotero-API-Key": apiKey,
                "Content-Type": "application/json",
                "If-Unmodified-Since-Version": String(version),
              },
              body: JSON.stringify({ annotationText: inZotero }),
            });
            expect(edited.status).toBe(204);
            await obRun(
              vaultId!,
              async ({ page: pageHelpers }) => {
                return (
                  pageHelpers.scratch.__zotlitWriteOutcomeProbe!.release!(),
                  true
                );
              },
              undefined,
            );
            await obRunUntil(
              vaultId!,
              async ({ zotlit }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
                return zotlit.services.bridge.runSync(
                  zotlit.services.annotationRepository.textDraftFor(
                    "text",
                    cardKey,
                  ),
                )?.state.kind;
              },
              { cardKey },
              {
                ready: (value) => value === "conflict",
                what: "the text draft for the Q8ZR4TDH quote to reach the conflict state",
              },
            );

            await clickCard(markKey);
            await expect.poll(shown, poll).toMatchObject({ cards: [markKey] });
            await obRunUntil(
              vaultId!,
              async (
                { app },
                {
                  cardKey,
                  inZotero,
                  typed,
                }: { cardKey: "Q8ZR4TDH"; inZotero: string; typed: string },
              ) => {
                const panel = app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view?.containerEl.querySelector<HTMLElement>(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                  )
                  ?.querySelector<HTMLElement>("blockquote .zt-annot-conflict");
                if (!panel || panel.getBoundingClientRect().width === 0)
                  return "none";
                return {
                  zotero: panel.textContent.includes(inZotero),
                  mine: panel.textContent.includes(typed),
                  verbs: [...panel.querySelectorAll<HTMLElement>("button")].map(
                    (node) => node.textContent,
                  ),
                };
              },
              { cardKey, inZotero, typed },
              {
                ready: (value) =>
                  isDeepStrictEqual(value, {
                    zotero: true,
                    mine: true,
                    verbs: ["Use my text", "Keep Zotero's text"],
                  }),
                what: "the Q8ZR4TDH quote conflict panel to show both texts and both choices",
              },
            );
            expect((await highlight.stored()).data.annotationText).toBe(
              inZotero,
            );

            await obRun(
              vaultId!,
              async ({ app }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
                return (
                  app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view?.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                    )
                    ?.querySelector<HTMLElement>(
                      "blockquote .zt-annot-conflict",
                    )!
                    .scrollIntoView({ block: "center" }),
                  true
                );
              },
              { cardKey },
            );
            await obRun(
              vaultId!,
              async (
                { app },
                { modifiers, cardKey }: { modifiers: []; cardKey: "Q8ZR4TDH" },
              ) => {
                const target = [
                  ...app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]!
                    .view.containerEl.querySelector(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                    )!
                    .querySelector("blockquote .zt-annot-conflict")!
                    .querySelectorAll("button"),
                ].find((button) => button.textContent === "Keep Zotero's text");
                target!.scrollIntoView({
                  block: "center",
                  inline: "nearest",
                  behavior: "instant",
                });
                const rect = target!.getBoundingClientRect();
                const zoom = (
                  require("electron") as {
                    webFrame: {
                      getZoomFactor(): number;
                    };
                  }
                ).webFrame.getZoomFactor();
                const x = Math.round((rect.left + rect.width / 2) * zoom),
                  y = Math.round((rect.top + rect.height / 2) * zoom);
                const contents = (
                  require("@electron/remote") as {
                    getCurrentWebContents(): {
                      sendInputEvent(event: object): void;
                    };
                  }
                ).getCurrentWebContents();
                contents.sendInputEvent({
                  type: "mouseDown",
                  x,
                  y,
                  button: "left",
                  clickCount: 1,
                  modifiers,
                });
                contents.sendInputEvent({
                  type: "mouseUp",
                  x,
                  y,
                  button: "left",
                  clickCount: 1,
                  modifiers,
                });
                return "clicked";
              },
              { modifiers: [], cardKey },
            ).then((value) => {
              expect(value).toBe("clicked");
            });
            await obRunUntil(
              vaultId!,
              async (
                { app },
                {
                  cardKey,
                  inZotero,
                }: { cardKey: "Q8ZR4TDH"; inZotero: string },
              ) => {
                return (
                  !app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view?.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                    )
                    ?.querySelector<HTMLElement>(
                      "blockquote .zt-annot-conflict",
                    ) &&
                  app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view?.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                    )!
                    .querySelector<HTMLElement>("blockquote")!.textContent ===
                    inZotero
                );
              },
              { cardKey, inZotero },
              {
                what: "the Q8ZR4TDH quote to drop its conflict and show Zotero's text",
              },
            );
            expect((await highlight.stored()).data.annotationText).toBe(
              inZotero,
            );
          }, 120000);

          it("puts a whole Text Edit session back for one press of the undo key, and redoes it", async () => {
            await raiseWindow(vaultId!);
            const seedText = highlight.seed.annotationText!;
            const storedText = async () =>
              (await highlight.stored()).data.annotationText;
            const type = (text: string) =>
              obRun(
                vaultId!,
                async (_context, { text }: { text: string }) => {
                  require("@electron/remote")
                    .getCurrentWebContents()
                    .insertText(text);
                  return String(true);
                },
                { text },
              );

            await clickCard(cardKey);
            await chooseEditQuotedText();
            await obRunUntil(
              vaultId!,
              async ({ app }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
                return !!app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view?.containerEl.querySelector<HTMLElement>(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                  )
                  ?.querySelector<HTMLElement>("blockquote .cm-content")
                  ?.contains(document.activeElement);
              },
              { cardKey },
              {
                what: "the Q8ZR4TDH quote editor to hold focus for the undo key",
              },
            );

            const saveSettled = async () => {
              await obRunUntil(
                vaultId!,
                async ({ zotlit }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
                  const { annotationRepository: repository, bridge } =
                    zotlit.services;
                  const draft = bridge.runSync(
                    repository.textDraftFor("text", cardKey),
                  );
                  return (
                    bridge.runSync(repository.mutationFor(cardKey)).kind ===
                      "idle" && draft?.state.kind !== "pending"
                  );
                },
                { cardKey },
                {
                  what: "the Q8ZR4TDH annotation to have no pending write or draft",
                },
              );
            };

            await type(" Checked.");
            expect(
              await waitFor(
                async () => (await storedText()) === `${seedText} Checked.`,
              ),
            ).toBe(true);
            await saveSettled();
            await type(" Twice.");
            await press("Escape");
            const corrected = `${seedText} Checked. Twice.`;
            expect(
              await waitFor(async () => (await storedText()) === corrected),
            ).toBe(true);
            await obRunUntil(
              vaultId!,
              async ({ zotlit }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
                const { annotationRepository: repository, bridge } =
                  zotlit.services;
                return (
                  bridge.runSync(repository.mutationFor(cardKey)).kind ===
                    "idle" &&
                  !bridge.runSync(repository.textDraftFor("text", cardKey))
                );
              },
              { cardKey },
              {
                what: "the Q8ZR4TDH annotation to have no write in flight and no draft",
              },
            );

            expect(await undoKey()).toEqual({ handled: true });
            await stepSettled();
            expect(
              await waitFor(async () => (await storedText()) === seedText),
            ).toBe(true);
            expect((await highlight.stored()).data).toMatchObject({
              annotationPosition: highlight.seed.annotationPosition,
              annotationSortIndex: highlight.seed.annotationSortIndex,
            });
            await obRunUntil(
              vaultId!,
              async (
                { app },
                {
                  cardKey,
                  seedText,
                }: { cardKey: "Q8ZR4TDH"; seedText: string },
              ) => {
                return (
                  app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view?.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                    )
                    ?.querySelector<HTMLElement>("blockquote")?.textContent ===
                  seedText
                );
              },
              { cardKey, seedText },
              { what: "the Q8ZR4TDH card quote to show the seeded text" },
            );

            expect(await redoKey()).toEqual({ handled: true });
            await stepSettled();
            expect(
              await waitFor(async () => (await storedText()) === corrected),
            ).toBe(true);
          }, 120000);

          it("keeps Edit quoted text enabled while editing is not live, and choosing it says why", async () => {
            await raiseWindow(vaultId!);
            await whileEditingNotLive(async () => {
              await clearNotices(vaultId!);
              await clickCard(cardKey);
              await obRunUntil(
                vaultId!,
                async ({ app }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
                  return app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view?.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                    )
                    ?.querySelector<HTMLElement>(".zt-annot-comment-field")
                    ?.hasAttribute("data-blocked");
                },
                { cardKey },
                {
                  what: "the Q8ZR4TDH comment field to carry the blocked marker",
                },
              );

              await chooseEditQuotedText();
              await obRunUntil(
                vaultId!,
                async (
                  _context,
                  {
                    permissionText,
                  }: {
                    permissionText: "Allow other applications on this computer to communicate with Zotero";
                  },
                ) => {
                  return [
                    ...document.querySelectorAll<HTMLElement>(".notice"),
                  ].some((node) => node.textContent.includes(permissionText));
                },
                {
                  permissionText:
                    "Allow other applications on this computer to communicate with Zotero",
                },
                {
                  what: "the Zotero communication permission notice to appear",
                },
              );
              expect(
                await obRun(
                  vaultId!,
                  async ({ app }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
                    return !!app.workspace
                      .getLeavesOfType("zotero-annotation-view")[0]
                      ?.view?.containerEl.querySelector<HTMLElement>(
                        `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                      )
                      ?.querySelector<HTMLElement>("blockquote .cm-content");
                  },
                  { cardKey },
                ),
              ).toBe(false);
            });
          }, 120000);
        });

        async function press(keyCode: string): Promise<void> {
          expect(
            await obRun(
              vaultId!,
              async (_context, { keyCode }: { keyCode: string }) => {
                const contents =
                  require("@electron/remote").getCurrentWebContents();
                contents.sendInputEvent({
                  type: "keyDown",
                  keyCode: keyCode,
                });
                contents.sendInputEvent({
                  type: "keyUp",
                  keyCode: keyCode,
                });
                return "pressed";
              },
              { keyCode },
            ),
          ).toBe("pressed");
        }

        it("moves to the next card in list order for ↓ on a focused card, and lands quietly on its mark; ↓ in a text field moves nothing", async () => {
          await raiseWindow(vaultId!);
          expect(
            await obRun(
              vaultId!,
              async ({ app }) => {
                return (
                  app.workspace.getLeavesOfType("zotero-annotation-view")[0]
                    ?.view as AnnotationView
                )?.snapshot.followMode;
              },
              undefined,
            ),
          ).toBe("active-tab");
          const next = await obRun(
            vaultId!,
            async ({ app }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
              const rows = [
                ...app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]!
                  .view.containerEl.querySelectorAll<HTMLElement>(
                    '[role="grid"] > [role="row"]',
                  ),
              ].map((row) => row.dataset.zoteroAnnotationKey);
              return String(rows[rows.indexOf(cardKey) + 1]);
            },
            { cardKey },
          );
          expect(next).toMatch(/^[A-Z0-9]{8}$/);

          await obRun(
            vaultId!,
            async (
              { app },
              { cardKey, modifiers }: { cardKey: "Q8ZR4TDH"; modifiers: [] },
            ) => {
              const target = app.workspace
                .getLeavesOfType("zotero-annotation-view")[0]
                ?.view?.containerEl.querySelector(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                );
              target!.scrollIntoView({
                block: "center",
                inline: "nearest",
                behavior: "instant",
              });
              const rect = target!.getBoundingClientRect();
              const zoom = (
                require("electron") as {
                  webFrame: {
                    getZoomFactor(): number;
                  };
                }
              ).webFrame.getZoomFactor();
              const x = Math.round((rect.left + rect.width / 2) * zoom),
                y = Math.round((rect.top + rect.height / 2) * zoom);
              const contents = (
                require("@electron/remote") as {
                  getCurrentWebContents(): {
                    sendInputEvent(event: object): void;
                  };
                }
              ).getCurrentWebContents();
              contents.sendInputEvent({
                type: "mouseDown",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              contents.sendInputEvent({
                type: "mouseUp",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              return "clicked";
            },
            { cardKey, modifiers: [] },
          ).then((value) => {
            expect(value).toBe("clicked");
          });
          await expect
            .poll(shown, poll)
            .toEqual({ cards: [cardKey], marks: [cardKey], popup: false });
          expect(
            await obRun(
              vaultId!,
              async ({ app }, { cardKey }: { cardKey: "Q8ZR4TDH" }) => {
                return (
                  document.activeElement ===
                  app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view?.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                    )
                );
              },
              { cardKey },
            ),
          ).toBe(true);
          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              { attachmentPath }: { attachmentPath: string },
            ) => {
              void pageHelpers
                .pdfView(attachmentPath)!
                .reader!.navigate({ pageIndex: 3 });
            },
            { attachmentPath },
          );

          await press("Down");
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                next,
              }: { attachmentPath: string; next: string },
            ) => {
              const view = pageHelpers.pdfView(attachmentPath)!;
              const box = view.reader!.container.getBoundingClientRect();
              const mark = view.containerEl.querySelector<SVGGraphicsElement>(
                `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(next)}]`,
              );
              const rect = mark?.getBoundingClientRect();
              return (
                !!mark &&
                mark.classList.contains("is-selected") &&
                rect!.top >= box.top &&
                rect!.bottom <= box.bottom
              );
            },
            { attachmentPath, next },
            {
              what: "the PDF mark for the next card to be selected and scrolled into view",
            },
          );
          expect(await shown()).toEqual({
            cards: [next],
            marks: [next],
            popup: false,
          });
          expect(
            await obRun(
              vaultId!,
              async ({ app }, { next }: { next: string }) => {
                return (
                  document.activeElement ===
                    app.workspace
                      .getLeavesOfType("zotero-annotation-view")[0]
                      ?.view?.containerEl.querySelector<HTMLElement>(
                        `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(next)}]`,
                      ) &&
                  app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view?.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(next)}]`,
                    )!.tabIndex === 0
                );
              },
              { next },
            ),
          ).toBe(true);

          await obRunUntil(
            vaultId!,
            async ({ app, page: pageHelpers }) => {
              const { press } = pageHelpers;
              if (
                !app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view.containerEl.querySelector<HTMLInputElement>(
                    'input[placeholder^="Search annotations"]',
                  )
              )
                press(
                  app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view.containerEl.querySelector<HTMLElement>(
                      '[aria-label="Search annotations"]',
                    ),
                  "Search annotations",
                );
              const input = app.workspace
                .getLeavesOfType("zotero-annotation-view")[0]
                ?.view.containerEl.querySelector<HTMLInputElement>(
                  'input[placeholder^="Search annotations"]',
                );
              if (!input) return "closed";
              input.focus();
              return document.activeElement === input && "focused";
            },
            undefined,
            {
              ready: (value) => value === "focused",
              what: "the Search annotations field in the Annotation View to take focus",
            },
          );
          try {
            await obRun(
              vaultId!,
              async ({ app }) => {
                const input = app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view.containerEl.querySelector<HTMLInputElement>(
                    'input[placeholder^="Search annotations"]',
                  );
                input!.dataset.ztKeyUp = "";
                input!.addEventListener(
                  "keyup",
                  () => {
                    input!.dataset.ztKeyUp = "done";
                  },
                  { once: true },
                );
              },
              undefined,
            );
            await press("Down");
            await obRunUntil(
              vaultId!,
              async ({ app }) => {
                return app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view.containerEl.querySelector<HTMLInputElement>(
                    'input[placeholder^="Search annotations"]',
                  )?.dataset.ztKeyUp;
              },
              undefined,
              {
                ready: (value) => value === "done",
                what: "the Search annotations field to finish its keyup handling",
              },
            );
            expect(await shown()).toEqual({
              cards: [next],
              marks: [next],
              popup: false,
            });
          } finally {
            await obRun(
              vaultId!,
              async ({ app, page: pageHelpers }) => {
                const { press } = pageHelpers;
                if (
                  app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view.containerEl.querySelector<HTMLInputElement>(
                      'input[placeholder^="Search annotations"]',
                    )
                )
                  press(
                    app.workspace
                      .getLeavesOfType("zotero-annotation-view")[0]
                      ?.view.containerEl.querySelector<HTMLElement>(
                        '[aria-label="Search annotations"]',
                      ),
                    "Search annotations",
                  );
              },
              undefined,
            );
          }
        }, 120000);

        it("selects a card for a click on its comment text, toggles it for a Cmd/Ctrl-click, and opens no editor", async () => {
          await raiseWindow(vaultId!);
          const mod = await obRun(
            vaultId!,
            async (_context) => {
              return process.platform === "darwin" ? "meta" : "control";
            },
            undefined,
          );
          const baseline = await annotationKeys();
          const drafts = [1, 2].map((n) => ({
            type: "highlight" as const,
            color: "#a28ae5",
            comment: `Comment click ${n}`,
            text: "Identify Your Message",
            pageLabel: "1",
            sortIndex: `00000|000100|0010${n}`,
            position: {
              pageIndex: 0,
              rects: [[100, 560 - n * 30, 300, 580 - n * 30]],
            },
          }));
          try {
            const outcomes = await obRun(
              vaultId!,
              async (
                { zotlit },
                {
                  drafts,
                  attachmentKey,
                }: {
                  drafts: {
                    type: "highlight";
                    color: string;
                    comment: string;
                    text: string;
                    pageLabel: string;
                    sortIndex: string;
                    position: { pageIndex: number; rects: number[][] };
                  }[];
                  attachmentKey: string;
                },
              ) => {
                const { annotationRepository: repository, bridge } =
                  zotlit.services;
                const outcomes = [];
                for (const draft of drafts)
                  outcomes.push(
                    await bridge.runPromise(
                      repository.createAnnotation(attachmentKey, draft),
                    ),
                  );
                return outcomes.map((outcome) => ({
                  kind: outcome.kind,
                  annotationKey:
                    "annotationKey" in outcome
                      ? outcome.annotationKey
                      : undefined,
                }));
              },
              { drafts, attachmentKey: attachment.key },
            );
            expect(outcomes).toEqual([
              { kind: "created", annotationKey: expect.any(String) },
              { kind: "created", annotationKey: expect.any(String) },
            ]);
            const made = outcomes.map(({ annotationKey }) => annotationKey!);
            const [first, second] = made as [string, string];

            const editorOpen = () =>
              obRun(
                vaultId!,
                async ({ app }) => {
                  return String(
                    !!app.workspace
                      .getLeavesOfType("zotero-annotation-view")[0]
                      ?.view?.containerEl.querySelector<HTMLElement>(
                        ".zt-annot-card .cm-content",
                      ),
                  );
                },
                undefined,
              );
            await clickCard(first);
            await expect.poll(shown, poll).toMatchObject({ cards: [first] });

            await obRun(
              vaultId!,
              async (
                { app },
                { second, modifiers }: { second: string; modifiers: [string] },
              ) => {
                const target = (function () {
                  const el = app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view?.containerEl.querySelector(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(second)}]`,
                    )!
                    .querySelector(".zt-annot-comment");
                  el!.scrollIntoView({ block: "center" });
                  return el;
                })();
                target!.scrollIntoView({
                  block: "center",
                  inline: "nearest",
                  behavior: "instant",
                });
                const rect = target!.getBoundingClientRect();
                const zoom = (
                  require("electron") as {
                    webFrame: {
                      getZoomFactor(): number;
                    };
                  }
                ).webFrame.getZoomFactor();
                const x = Math.round((rect.left + rect.width / 2) * zoom),
                  y = Math.round((rect.top + rect.height / 2) * zoom);
                const contents = (
                  require("@electron/remote") as {
                    getCurrentWebContents(): {
                      sendInputEvent(event: object): void;
                    };
                  }
                ).getCurrentWebContents();
                contents.sendInputEvent({
                  type: "mouseDown",
                  x,
                  y,
                  button: "left",
                  clickCount: 1,
                  modifiers,
                });
                contents.sendInputEvent({
                  type: "mouseUp",
                  x,
                  y,
                  button: "left",
                  clickCount: 1,
                  modifiers,
                });
                return "clicked";
              },
              { second, modifiers: [mod] },
            ).then((value) => {
              expect(value).toBe("clicked");
            });
            await expect
              .poll(
                async () =>
                  (await shown()).cards.toSorted((a, b) =>
                    String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
                  ),
                poll,
              )
              .toEqual([first, second].toSorted());
            expect(await editorOpen()).toBe("false");

            await obRun(
              vaultId!,
              async (
                { app },
                { second, modifiers }: { second: string; modifiers: [string] },
              ) => {
                const target = (function () {
                  const el = app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view?.containerEl.querySelector(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(second)}]`,
                    )!
                    .querySelector(".zt-annot-comment");
                  el!.scrollIntoView({ block: "center" });
                  return el;
                })();
                target!.scrollIntoView({
                  block: "center",
                  inline: "nearest",
                  behavior: "instant",
                });
                const rect = target!.getBoundingClientRect();
                const zoom = (
                  require("electron") as {
                    webFrame: {
                      getZoomFactor(): number;
                    };
                  }
                ).webFrame.getZoomFactor();
                const x = Math.round((rect.left + rect.width / 2) * zoom),
                  y = Math.round((rect.top + rect.height / 2) * zoom);
                const contents = (
                  require("@electron/remote") as {
                    getCurrentWebContents(): {
                      sendInputEvent(event: object): void;
                    };
                  }
                ).getCurrentWebContents();
                contents.sendInputEvent({
                  type: "mouseDown",
                  x,
                  y,
                  button: "left",
                  clickCount: 1,
                  modifiers,
                });
                contents.sendInputEvent({
                  type: "mouseUp",
                  x,
                  y,
                  button: "left",
                  clickCount: 1,
                  modifiers,
                });
                return "clicked";
              },
              { second, modifiers: [mod] },
            ).then((value) => {
              expect(value).toBe("clicked");
            });
            await expect.poll(shown, poll).toMatchObject({ cards: [first] });
            expect(await editorOpen()).toBe("false");

            await obRun(
              vaultId!,
              async (
                { app },
                { second, modifiers }: { second: string; modifiers: [] },
              ) => {
                const target = (function () {
                  const el = app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view?.containerEl.querySelector(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(second)}]`,
                    )!
                    .querySelector(".zt-annot-comment");
                  el!.scrollIntoView({ block: "center" });
                  return el;
                })();
                target!.scrollIntoView({
                  block: "center",
                  inline: "nearest",
                  behavior: "instant",
                });
                const rect = target!.getBoundingClientRect();
                const zoom = (
                  require("electron") as {
                    webFrame: {
                      getZoomFactor(): number;
                    };
                  }
                ).webFrame.getZoomFactor();
                const x = Math.round((rect.left + rect.width / 2) * zoom),
                  y = Math.round((rect.top + rect.height / 2) * zoom);
                const contents = (
                  require("@electron/remote") as {
                    getCurrentWebContents(): {
                      sendInputEvent(event: object): void;
                    };
                  }
                ).getCurrentWebContents();
                contents.sendInputEvent({
                  type: "mouseDown",
                  x,
                  y,
                  button: "left",
                  clickCount: 1,
                  modifiers,
                });
                contents.sendInputEvent({
                  type: "mouseUp",
                  x,
                  y,
                  button: "left",
                  clickCount: 1,
                  modifiers,
                });
                return "clicked";
              },
              { second, modifiers: [] },
            ).then((value) => {
              expect(value).toBe("clicked");
            });
            await expect.poll(shown, poll).toMatchObject({ cards: [second] });
            expect(await editorOpen()).toBe("false");
          } finally {
            await eraseAnnotations(rdp, await madeSince(baseline));
          }
        }, 120000);

        it("adds a card for Cmd/Ctrl-click, takes a range for Shift-click and every card for Cmd/Ctrl+A, and lands only on an added card", async () => {
          await raiseWindow(vaultId!);
          const [underline, highlight, image] = [
            "K3JRFLFQ",
            markKey,
            "FDRFQ7C2",
          ] as const;
          const mod = await obRun(
            vaultId!,
            async (_context) => {
              return process.platform === "darwin" ? "meta" : "control";
            },
            undefined,
          );

          const sorted = async () => {
            const { cards, marks, popup } = await shown();
            return {
              cards: cards.toSorted((a, b) =>
                String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
              ),
              marks: marks.toSorted((a, b) =>
                String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
              ),
              popup,
            };
          };
          const page = () =>
            obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                { attachmentPath }: { attachmentPath: string },
              ) => {
                return String(
                  pageHelpers.pdfView(attachmentPath)!.reader!.state.get()
                    .pageIndex + 1,
                );
              },
              { attachmentPath },
            );
          const toTop = () =>
            obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                { attachmentPath }: { attachmentPath: string },
              ) => {
                void pageHelpers
                  .pdfView(attachmentPath)!
                  .reader!.navigate({ pageIndex: 0 });
                return "top";
              },
              { attachmentPath },
            );
          const rangeOf = async (from: string, to: string) => {
            const rows = await obRun(
              vaultId!,
              async ({ app }) => {
                return [
                  ...app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]!
                    .view.containerEl.querySelectorAll<HTMLElement>(
                      '[role="grid"] > [role="row"]',
                    ),
                ].map((row) => row.dataset.zoteroAnnotationKey);
              },
              undefined,
            );
            const [a, b] = [rows.indexOf(from), rows.indexOf(to)].toSorted(
              (x, y) => x - y,
            );
            return rows
              .slice(a, b! + 1)
              .toSorted((a, b) =>
                String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
              );
          };

          await obRun(
            vaultId!,
            async (
              { app },
              {
                underline,
                modifiers,
              }: { underline: "K3JRFLFQ"; modifiers: [] },
            ) => {
              const target = (function () {
                const card = app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view?.containerEl.querySelector(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(underline)}]`,
                  );
                const el = card!.querySelector("blockquote") ?? card;
                el!.scrollIntoView({ block: "center" });
                return el;
              })();
              target!.scrollIntoView({
                block: "center",
                inline: "nearest",
                behavior: "instant",
              });
              const rect = target!.getBoundingClientRect();
              const zoom = (
                require("electron") as {
                  webFrame: {
                    getZoomFactor(): number;
                  };
                }
              ).webFrame.getZoomFactor();
              const x = Math.round((rect.left + rect.width / 2) * zoom),
                y = Math.round((rect.top + rect.height / 2) * zoom);
              const contents = (
                require("@electron/remote") as {
                  getCurrentWebContents(): {
                    sendInputEvent(event: object): void;
                  };
                }
              ).getCurrentWebContents();
              contents.sendInputEvent({
                type: "mouseDown",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              contents.sendInputEvent({
                type: "mouseUp",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              return "clicked";
            },
            { underline, modifiers: [] },
          ).then((value) => {
            expect(value).toBe("clicked");
          });
          await expect
            .poll(sorted, poll)
            .toEqual({ cards: [underline], marks: [underline], popup: false });

          await obRun(
            vaultId!,
            async (
              { app },
              {
                highlight,
                modifiers,
              }: { highlight: "PUPR5FG5"; modifiers: [string] },
            ) => {
              const target = (function () {
                const card = app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view?.containerEl.querySelector(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(highlight)}]`,
                  );
                const el = card!.querySelector("blockquote") ?? card;
                el!.scrollIntoView({ block: "center" });
                return el;
              })();
              target!.scrollIntoView({
                block: "center",
                inline: "nearest",
                behavior: "instant",
              });
              const rect = target!.getBoundingClientRect();
              const zoom = (
                require("electron") as {
                  webFrame: {
                    getZoomFactor(): number;
                  };
                }
              ).webFrame.getZoomFactor();
              const x = Math.round((rect.left + rect.width / 2) * zoom),
                y = Math.round((rect.top + rect.height / 2) * zoom);
              const contents = (
                require("@electron/remote") as {
                  getCurrentWebContents(): {
                    sendInputEvent(event: object): void;
                  };
                }
              ).getCurrentWebContents();
              contents.sendInputEvent({
                type: "mouseDown",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              contents.sendInputEvent({
                type: "mouseUp",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              return "clicked";
            },
            { highlight, modifiers: [mod] },
          ).then((value) => {
            expect(value).toBe("clicked");
          });
          await expect.poll(sorted, poll).toEqual({
            cards: [underline, highlight].toSorted(),
            marks: [underline, highlight].toSorted(),
            popup: false,
          });

          const anchored = await rangeOf(highlight, cardKey);
          expect(anchored).not.toContain(underline);
          await obRun(
            vaultId!,
            async (
              { app },
              {
                cardKey,
                modifiers,
              }: { cardKey: "Q8ZR4TDH"; modifiers: ["shift"] },
            ) => {
              const target = (function () {
                const card = app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view?.containerEl.querySelector(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                  );
                const el = card!.querySelector("blockquote") ?? card;
                el!.scrollIntoView({ block: "center" });
                return el;
              })();
              target!.scrollIntoView({
                block: "center",
                inline: "nearest",
                behavior: "instant",
              });
              const rect = target!.getBoundingClientRect();
              const zoom = (
                require("electron") as {
                  webFrame: {
                    getZoomFactor(): number;
                  };
                }
              ).webFrame.getZoomFactor();
              const x = Math.round((rect.left + rect.width / 2) * zoom),
                y = Math.round((rect.top + rect.height / 2) * zoom);
              const contents = (
                require("@electron/remote") as {
                  getCurrentWebContents(): {
                    sendInputEvent(event: object): void;
                  };
                }
              ).getCurrentWebContents();
              contents.sendInputEvent({
                type: "mouseDown",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              contents.sendInputEvent({
                type: "mouseUp",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              return "clicked";
            },
            { cardKey, modifiers: ["shift"] },
          ).then((value) => {
            expect(value).toBe("clicked");
          });
          await expect.poll(sorted, poll).toEqual({
            cards: anchored,
            marks: anchored,
            popup: false,
          });

          const every = (await obRun(
            vaultId!,
            async ({ app }) => {
              return [
                ...app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]!
                  .view.containerEl.querySelectorAll<HTMLElement>(
                    ".zt-annot-card",
                  ),
              ]
                .map((card) => card.dataset.zoteroAnnotationKey)
                .sort((a, b) =>
                  String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0,
                );
            },
            undefined,
          )) as string[];
          expect(
            await obRun(
              vaultId!,
              async (_context, { mod }: { mod: string }) => {
                const contents =
                  require("@electron/remote").getCurrentWebContents();
                contents.sendInputEvent({
                  type: "keyDown",
                  keyCode: "A",
                  modifiers: [`${mod}`],
                });
                contents.sendInputEvent({
                  type: "keyUp",
                  keyCode: "A",
                  modifiers: [mod],
                });
                return "pressed";
              },
              { mod },
            ),
          ).toBe("pressed");
          await expect
            .poll(async () => (await sorted()).cards, poll)
            .toEqual(every);

          await obRun(
            vaultId!,
            async (
              { app },
              {
                underline,
                modifiers,
              }: { underline: "K3JRFLFQ"; modifiers: [] },
            ) => {
              const target = (function () {
                const card = app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view?.containerEl.querySelector(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(underline)}]`,
                  );
                const el = card!.querySelector("blockquote") ?? card;
                el!.scrollIntoView({ block: "center" });
                return el;
              })();
              target!.scrollIntoView({
                block: "center",
                inline: "nearest",
                behavior: "instant",
              });
              const rect = target!.getBoundingClientRect();
              const zoom = (
                require("electron") as {
                  webFrame: {
                    getZoomFactor(): number;
                  };
                }
              ).webFrame.getZoomFactor();
              const x = Math.round((rect.left + rect.width / 2) * zoom),
                y = Math.round((rect.top + rect.height / 2) * zoom);
              const contents = (
                require("@electron/remote") as {
                  getCurrentWebContents(): {
                    sendInputEvent(event: object): void;
                  };
                }
              ).getCurrentWebContents();
              contents.sendInputEvent({
                type: "mouseDown",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              contents.sendInputEvent({
                type: "mouseUp",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              return "clicked";
            },
            { underline, modifiers: [] },
          ).then((value) => {
            expect(value).toBe("clicked");
          });
          await expect
            .poll(sorted, poll)
            .toEqual({ cards: [underline], marks: [underline], popup: false });
          await toTop();
          await expect.poll(page, poll).toBe("1");
          await obRun(
            vaultId!,
            async (
              { app },
              { image, modifiers }: { image: "FDRFQ7C2"; modifiers: [string] },
            ) => {
              const target = (function () {
                const card = app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view?.containerEl.querySelector(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(image)}]`,
                  );
                const el = card!.querySelector("blockquote") ?? card;
                el!.scrollIntoView({ block: "center" });
                return el;
              })();
              target!.scrollIntoView({
                block: "center",
                inline: "nearest",
                behavior: "instant",
              });
              const rect = target!.getBoundingClientRect();
              const zoom = (
                require("electron") as {
                  webFrame: {
                    getZoomFactor(): number;
                  };
                }
              ).webFrame.getZoomFactor();
              const x = Math.round((rect.left + rect.width / 2) * zoom),
                y = Math.round((rect.top + rect.height / 2) * zoom);
              const contents = (
                require("@electron/remote") as {
                  getCurrentWebContents(): {
                    sendInputEvent(event: object): void;
                  };
                }
              ).getCurrentWebContents();
              contents.sendInputEvent({
                type: "mouseDown",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              contents.sendInputEvent({
                type: "mouseUp",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              return "clicked";
            },
            { image, modifiers: [mod] },
          ).then((value) => {
            expect(value).toBe("clicked");
          });
          await expect.poll(page, poll).toBe("2");
          expect((await sorted()).cards).toEqual([underline, image].toSorted());

          await toTop();
          await expect.poll(page, poll).toBe("1");
          await obRun(
            vaultId!,
            async (
              { app },
              { image, modifiers }: { image: "FDRFQ7C2"; modifiers: [string] },
            ) => {
              const target = (function () {
                const card = app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view?.containerEl.querySelector(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(image)}]`,
                  );
                const el = card!.querySelector("blockquote") ?? card;
                el!.scrollIntoView({ block: "center" });
                return el;
              })();
              target!.scrollIntoView({
                block: "center",
                inline: "nearest",
                behavior: "instant",
              });
              const rect = target!.getBoundingClientRect();
              const zoom = (
                require("electron") as {
                  webFrame: {
                    getZoomFactor(): number;
                  };
                }
              ).webFrame.getZoomFactor();
              const x = Math.round((rect.left + rect.width / 2) * zoom),
                y = Math.round((rect.top + rect.height / 2) * zoom);
              const contents = (
                require("@electron/remote") as {
                  getCurrentWebContents(): {
                    sendInputEvent(event: object): void;
                  };
                }
              ).getCurrentWebContents();
              contents.sendInputEvent({
                type: "mouseDown",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              contents.sendInputEvent({
                type: "mouseUp",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              return "clicked";
            },
            { image, modifiers: [mod] },
          ).then((value) => {
            expect(value).toBe("clicked");
          });
          await expect
            .poll(sorted, poll)
            .toEqual({ cards: [underline], marks: [underline], popup: false });
          expect(await page()).toBe("1");

          await obRun(
            vaultId!,
            async (
              { app },
              {
                underline,
                modifiers,
              }: { underline: "K3JRFLFQ"; modifiers: [string] },
            ) => {
              const target = (function () {
                const card = app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view?.containerEl.querySelector(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(underline)}]`,
                  );
                const el = card!.querySelector("blockquote") ?? card;
                el!.scrollIntoView({ block: "center" });
                return el;
              })();
              target!.scrollIntoView({
                block: "center",
                inline: "nearest",
                behavior: "instant",
              });
              const rect = target!.getBoundingClientRect();
              const zoom = (
                require("electron") as {
                  webFrame: {
                    getZoomFactor(): number;
                  };
                }
              ).webFrame.getZoomFactor();
              const x = Math.round((rect.left + rect.width / 2) * zoom),
                y = Math.round((rect.top + rect.height / 2) * zoom);
              const contents = (
                require("@electron/remote") as {
                  getCurrentWebContents(): {
                    sendInputEvent(event: object): void;
                  };
                }
              ).getCurrentWebContents();
              contents.sendInputEvent({
                type: "mouseDown",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              contents.sendInputEvent({
                type: "mouseUp",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              return "clicked";
            },
            { underline, modifiers: [mod] },
          ).then((value) => {
            expect(value).toBe("clicked");
          });
          await expect
            .poll(sorted, poll)
            .toEqual({ cards: [], marks: [], popup: false });
          const kept = await rangeOf(underline, cardKey);
          await obRun(
            vaultId!,
            async (
              { app },
              {
                cardKey,
                modifiers,
              }: { cardKey: "Q8ZR4TDH"; modifiers: ["shift"] },
            ) => {
              const target = (function () {
                const card = app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view?.containerEl.querySelector(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(cardKey)}]`,
                  );
                const el = card!.querySelector("blockquote") ?? card;
                el!.scrollIntoView({ block: "center" });
                return el;
              })();
              target!.scrollIntoView({
                block: "center",
                inline: "nearest",
                behavior: "instant",
              });
              const rect = target!.getBoundingClientRect();
              const zoom = (
                require("electron") as {
                  webFrame: {
                    getZoomFactor(): number;
                  };
                }
              ).webFrame.getZoomFactor();
              const x = Math.round((rect.left + rect.width / 2) * zoom),
                y = Math.round((rect.top + rect.height / 2) * zoom);
              const contents = (
                require("@electron/remote") as {
                  getCurrentWebContents(): {
                    sendInputEvent(event: object): void;
                  };
                }
              ).getCurrentWebContents();
              contents.sendInputEvent({
                type: "mouseDown",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              contents.sendInputEvent({
                type: "mouseUp",
                x,
                y,
                button: "left",
                clickCount: 1,
                modifiers,
              });
              return "clicked";
            },
            { cardKey, modifiers: ["shift"] },
          ).then((value) => {
            expect(value).toBe("clicked");
          });
          await expect.poll(sorted, poll).toEqual({
            cards: kept,
            marks: kept,
            popup: false,
          });
        }, 120000);

        it("deletes a group of two Cmd/Ctrl-clicked cards after one counted confirmation, and one undo restores both", async () => {
          const baseline = await annotationKeys();
          const drafts = [1, 2].map((n) => ({
            type: "highlight" as const,
            color: "#a28ae5",
            comment: `Group delete ${n}`,
            text: "Identify Your Message",
            pageLabel: "1",
            sortIndex: `00000|000100|0010${n}`,
            position: {
              pageIndex: 0,
              rects: [[100, 560 - n * 30, 300, 580 - n * 30]],
            },
          }));
          const made = await obRun(
            vaultId!,
            async (
              { zotlit },
              {
                drafts,
                attachmentKey,
              }: {
                drafts: {
                  type: "highlight";
                  color: string;
                  comment: string;
                  text: string;
                  pageLabel: string;
                  sortIndex: string;
                  position: { pageIndex: number; rects: number[][] };
                }[];
                attachmentKey: string;
              },
            ) => {
              const { annotationRepository: repository, bridge } =
                zotlit.services;
              const keys = [];
              for (const draft of drafts) {
                const outcome = await bridge.runPromise(
                  repository.createAnnotation(attachmentKey, draft),
                );
                if (outcome.kind !== "created")
                  throw new Error("Annotation creation failed");
                keys.push(outcome.annotationKey);
              }
              return keys;
            },
            { drafts, attachmentKey: attachment.key },
          );
          try {
            expect(made).toHaveLength(2);
            const [first, second] = made as [string, string];
            await clickCard(first);
            await obRunUntil(
              vaultId!,
              async (
                { app },
                {
                  second,
                  platformKey,
                }: { second: string; platformKey: "ctrlKey" | "metaKey" },
              ) => {
                const card = app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view?.containerEl.querySelector<HTMLElement>(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(second)}]`,
                  );
                if (!card) return "no card";
                card.dispatchEvent(
                  new MouseEvent("click", {
                    bubbles: true,
                    cancelable: true,
                    [platformKey]: true,
                  }),
                );
                return "clicked";
              },
              { second, platformKey },
              {
                ready: (value) => value === "clicked",
                what: "the second card to take a modifier click in the Annotation View",
              },
            );
            await expect.poll(shown, poll).toMatchObject({
              cards: expect.arrayContaining(made),
              marks: expect.arrayContaining(made),
            });
            expect((await shown()).cards).toHaveLength(2);

            expect(
              await obRun(
                vaultId!,
                async ({ app }, { second }: { second: string }) => {
                  const leaf = app.workspace.getLeavesOfType(
                    "zotero-annotation-view",
                  )[0];
                  app.workspace.setActiveLeaf(leaf!, { focus: true });
                  const card = app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view?.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(second)}]`,
                    );
                  card!.focus();
                  const event = new KeyboardEvent("keydown", {
                    key: "Delete",
                    code: "Delete",
                    bubbles: true,
                    cancelable: true,
                  });
                  card!.dispatchEvent(event);
                  return { prevented: event.defaultPrevented };
                },
                { second },
              ),
            ).toEqual({ prevented: true });
            await obRunUntil(
              vaultId!,
              async (_context) => {
                return document.querySelector<HTMLElement>(
                  ".modal-container .modal-title",
                )?.textContent;
              },
              undefined,
              {
                ready: (value) => value === "Delete 2 annotations?",
                what: "the delete confirmation title to name the count of 2 annotations",
              },
            );
            expect(await madeSince(baseline)).toEqual(
              expect.arrayContaining(made),
            );
            expect(
              await obRun(
                vaultId!,
                async ({ page: pageHelpers }) => {
                  const { press } = pageHelpers;
                  const button = [
                    ...document.querySelectorAll<HTMLElement>(
                      ".modal-container .modal-button-container button",
                    ),
                  ].find((node) => node.textContent === "Delete");
                  press(button, "Delete");
                  return "confirmed";
                },
                undefined,
              ),
            ).toBe("confirmed");

            expect(
              await waitFor(
                async () => (await madeSince(baseline)).length === 0,
              ),
            ).toBe(true);
            await expect.poll(shown, poll).toMatchObject({ cards: [] });
            await obRunUntil(
              vaultId!,
              async ({ zotlit }, { made }: { made: string[] }) => {
                const { annotationRepository: repository, bridge } =
                  zotlit.services;
                return made.every(
                  (key) =>
                    bridge.runSync(repository.mutationFor(key)).kind === "idle",
                );
              },
              { made },
              {
                what: "the two deleted annotations to have no write in flight",
              },
            );

            expect(await undoKey()).toEqual({ handled: true });
            await stepSettled();
            expect(
              await waitFor(
                async () => (await madeSince(baseline)).length === 2,
              ),
            ).toBe(true);
            const restored = await madeSince(baseline);
            expect(restored.some((key) => made.includes(key))).toBe(false);
            const comments = await Promise.all(
              restored.map(
                async (key) =>
                  (await storedAnnotation(api, serverID, key))
                    .annotationComment,
              ),
            );
            expect(comments.toSorted()).toEqual([
              "Group delete 1",
              "Group delete 2",
            ]);
          } finally {
            await obRun(
              vaultId!,
              async ({ app }) => {
                for (const modal of app.workspace.containerEl.doc.querySelectorAll<HTMLElement>(
                  ".modal-container .modal-close-button",
                ))
                  modal.click();
              },
              undefined,
            );
            await obRun(
              vaultId!,
              async (
                { app, page: pageHelpers },
                { attachmentPath }: { attachmentPath: string },
              ) => {
                app.workspace.setActiveLeaf(
                  pageHelpers.pdfView(attachmentPath)!.leaf,
                  { focus: true },
                );
              },
              { attachmentPath },
            );
            await eraseAnnotations(rdp, await madeSince(baseline));
          }
        }, 120000);

        async function withGroupOfTwo(
          run: (made: readonly [string, string]) => Promise<void>,
        ): Promise<void> {
          const baseline = await annotationKeys();
          const drafts = [
            { n: 1, color: "#a28ae5", text: "Identify Your Message" },
            { n: 2, color: "#ff6666", text: "Know Your Audience" },
          ].map(({ n, color, text }) => ({
            type: "highlight" as const,
            color,
            comment: `Group recolour ${n}`,
            text,
            pageLabel: "1",
            sortIndex: `00000|000100|0010${n}`,
            position: {
              pageIndex: 0,
              rects: [[100, 560 - n * 30, 300, 580 - n * 30]],
            },
          }));
          try {
            const outcomes = await obRun(
              vaultId!,
              async (
                { zotlit },
                {
                  drafts,
                  attachmentKey,
                }: {
                  drafts: {
                    type: "highlight";
                    color: string;
                    comment: string;
                    text: string;
                    pageLabel: string;
                    sortIndex: string;
                    position: { pageIndex: number; rects: number[][] };
                  }[];
                  attachmentKey: string;
                },
              ) => {
                const { annotationRepository: repository, bridge } =
                  zotlit.services;
                const outcomes = [];
                for (const draft of drafts)
                  outcomes.push(
                    await bridge.runPromise(
                      repository.createAnnotation(attachmentKey, draft),
                    ),
                  );
                return outcomes.map((outcome) => ({
                  kind: outcome.kind,
                  annotationKey:
                    "annotationKey" in outcome
                      ? outcome.annotationKey
                      : undefined,
                }));
              },
              { drafts, attachmentKey: attachment.key },
            );
            expect(outcomes).toEqual([
              { kind: "created", annotationKey: expect.any(String) },
              { kind: "created", annotationKey: expect.any(String) },
            ]);
            const made = outcomes.map(({ annotationKey }) => annotationKey!);
            const [first, second] = made as [string, string];
            await clickCard(first);
            await obRunUntil(
              vaultId!,
              async (
                { app },
                {
                  second,
                  platformKey,
                }: { second: string; platformKey: "ctrlKey" | "metaKey" },
              ) => {
                const card = app.workspace
                  .getLeavesOfType("zotero-annotation-view")[0]
                  ?.view?.containerEl.querySelector<HTMLElement>(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(second)}]`,
                  );
                if (!card) return "no card";
                card.dispatchEvent(
                  new MouseEvent("click", {
                    bubbles: true,
                    cancelable: true,
                    [platformKey]: true,
                  }),
                );
                return "clicked";
              },
              { second, platformKey },
              {
                ready: (value) => value === "clicked",
                what: "the second card to take a modifier click into the Card Selection",
              },
            );
            await expect.poll(shown, poll).toMatchObject({
              cards: expect.arrayContaining(made),
              marks: expect.arrayContaining(made),
            });
            await run([first, second]);
          } finally {
            await eraseAnnotations(rdp, await madeSince(baseline));
          }
        }

        const colorsOf = (keys: readonly string[]) =>
          Promise.all(keys.map((key) => annotationColor(api, serverID, key)));

        async function expectOneUndoReturnsBoth(
          made: readonly string[],
        ): Promise<void> {
          expect(
            await waitFor(async () =>
              (await colorsOf(made)).every((color) => color === "#5fb236"),
            ),
            "Zotero holds green on both Annotations",
          ).toBe(true);
          await obRunUntil(
            vaultId!,
            async ({ zotlit }, { made }: { made: readonly string[] }) => {
              const { annotationRepository: repository, bridge } =
                zotlit.services;
              return made.every(
                (key) =>
                  bridge.runSync(repository.mutationFor(key)).kind === "idle",
              );
            },
            { made },
            {
              what: "the grouped annotations to have no write in flight before undo",
            },
          );
          expect(await undoKey()).toEqual({ handled: true });
          await stepSettled();
          expect(
            await waitFor(
              async () =>
                JSON.stringify(await colorsOf(made)) ===
                JSON.stringify(["#a28ae5", "#ff6666"]),
            ),
            "one undo returned both first colours in Zotero",
          ).toBe(true);
        }

        it("recolours a group of two Cmd/Ctrl-clicked cards with a reader colour key, and one undo returns both colours", async () => {
          await withGroupOfTwo(async (made) => {
            expect(await pressKey("3", {})).toEqual({ prevented: true });
            await expectOneUndoReturnsBoth(made);
          });
        }, 120000);

        it("recolours a group from the palette of a card in it, and one undo returns both colours", async () => {
          const nativeMenus = await obRun(
            vaultId!,
            async ({ app }) => {
              return String(app.vault.getConfig("nativeMenus"));
            },
            undefined,
          );
          await obRun(
            vaultId!,
            async ({ app }) => {
              return (app.vault.setConfig("nativeMenus", false), true);
            },
            undefined,
          );
          try {
            await withGroupOfTwo(async (made) => {
              await obRunUntil(
                vaultId!,
                async (
                  { app, page: pageHelpers },
                  {
                    annotationKey,
                    buttonLabel,
                  }: { annotationKey: string; buttonLabel: "Change color" },
                ) => {
                  const { press } = pageHelpers;
                  const button = app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view?.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(annotationKey)}]`,
                    )
                    ?.querySelector<HTMLElement>(
                      `[aria-label=${JSON.stringify(buttonLabel)}]`,
                    );
                  if (!button) return "no button";
                  press(button, "Change color");
                  const green = [
                    ...document.querySelectorAll<HTMLElement>(
                      ".menu .menu-item",
                    ),
                  ].find((item) => item.textContent.trim() === "Green");
                  if (!green) return "no menu";
                  press(green, "Green");
                  return "picked";
                },
                { annotationKey: made[1], buttonLabel: "Change color" },
                {
                  ready: (value) => value === "picked",
                  what: "the Change color menu on the grouped card to offer Green",
                },
              );
              await expectOneUndoReturnsBoth(made);
            });
          } finally {
            await obRun(
              vaultId!,
              async (
                { app },
                { nativeMenusEnabled }: { nativeMenusEnabled: boolean },
              ) => {
                return (
                  app.vault.setConfig("nativeMenus", nativeMenusEnabled), true
                );
              },
              { nativeMenusEnabled: nativeMenus === "true" },
            );
          }
        }, 120000);

        it("recolours a group with a colour key on the view, and one undo returns both colours", async () => {
          await withGroupOfTwo(async (made) => {
            expect(
              await obRun(
                vaultId!,
                async (
                  { app },
                  { annotationKey }: { annotationKey: string },
                ) => {
                  const card = app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view?.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(annotationKey)}]`,
                    );
                  card!.focus();
                  const event = new KeyboardEvent("keydown", {
                    key: "3",
                    bubbles: true,
                    cancelable: true,
                  });
                  Object.defineProperty(event, "target", { value: card });
                  const handled =
                    (
                      app.workspace.getLeavesOfType(
                        "zotero-annotation-view",
                      )[0]!.view.scope! as PairedScope
                    ).handleKey(event, {
                      modifiers: "",
                      key: "3",
                      vkey: "Digit3",
                    }) === false;
                  return { handled };
                },
                { annotationKey: made[1] },
              ),
            ).toEqual({ handled: true });
            await expectOneUndoReturnsBoth(made);
          });
        }, 120000);

        it("copies the quoted text of a group for Cmd/Ctrl+C on the view, in list order", async () => {
          await withGroupOfTwo(async (made) => {
            const clipboard = (text: string | null) =>
              obRun(
                vaultId!,
                (_context, { text }: { text: string | null }) => {
                  const { clipboard } = require("electron") as {
                    clipboard: {
                      writeText(text: string): void;
                      readText(): string;
                    };
                  };
                  if (text !== null) clipboard.writeText(text);
                  return clipboard.readText();
                },
                { text },
              );
            await clipboard("before");
            expect(
              await obRun(
                vaultId!,
                async (
                  { app },
                  {
                    annotationKey,
                    platformKey,
                    modifierKey,
                  }: {
                    annotationKey: string;
                    platformKey: "ctrlKey" | "metaKey";
                    modifierKey: "Ctrl" | "Meta";
                  },
                ) => {
                  const card = app.workspace
                    .getLeavesOfType("zotero-annotation-view")[0]
                    ?.view?.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(annotationKey)}]`,
                    );
                  card!.focus();
                  const event = new KeyboardEvent("keydown", {
                    key: "c",
                    [platformKey]: true,
                    bubbles: true,
                    cancelable: true,
                  });
                  Object.defineProperty(event, "target", { value: card });
                  const handled =
                    (
                      app.workspace.getLeavesOfType(
                        "zotero-annotation-view",
                      )[0]!.view.scope! as PairedScope
                    ).handleKey(event, {
                      modifiers: modifierKey,
                      key: "c",
                      vkey: "KeyC",
                    }) === false;
                  return { handled };
                },
                {
                  annotationKey: made[1],
                  platformKey,
                  modifierKey: platformKey === "metaKey" ? "Meta" : "Ctrl",
                },
              ),
            ).toEqual({ handled: true });
            expect(
              await waitFor(
                async () =>
                  (await clipboard(null)) ===
                  "Identify Your Message\n\nKnow Your Audience",
              ),
            ).toBe(true);
          });
        }, 120000);

        it("selects both cards of a Zotero Reader selection of two annotations", async () => {
          const selectInZotero = (keys: readonly string[]) =>
            rdp.json<string[]>(`(() => {
              const reader = Zotero.Reader._readers.find(
                (candidate) => candidate.itemID === ${ATTACHMENT_ITEM}.id,
              );
              // The Reader is the one the Companion reports as active.
              Zotero_Tabs.select(reader.tabID);
              reader._internalReader.setSelectedAnnotations(
                Components.utils.cloneInto(${JSON.stringify(keys)}, reader._iframeWindow),
              );
              return [...reader._internalReader._state.selectedAnnotationIDs];
            })()`);
          const cards = () =>
            obRun(
              vaultId!,
              async ({ app }) => {
                const view = app.workspace.getLeavesOfType(
                  "zotero-annotation-view",
                )[0]?.view;
                return {
                  mode: (view! as AnnotationView).snapshot.followMode,
                  cards: [
                    ...view!.containerEl.querySelectorAll<HTMLElement>(
                      ".zt-annot-card[data-selected]",
                    ),
                  ].map((card) => card.dataset.zoteroAnnotationKey),
                };
              },
              undefined,
            );

          await obRun(
            vaultId!,
            async ({ app }) => {
              app.commands.executeCommandById(
                "zotlit:annot-view-follow-zotero-reader",
              );
            },
            undefined,
          );
          try {
            expect(await selectInZotero([markKey, cardKey])).toEqual([
              markKey,
              cardKey,
            ]);
            await expect.poll(cards, poll).toEqual({
              mode: "zotero-reader",
              cards: [cardKey, markKey],
            });

            await selectInZotero([]);
            await expect
              .poll(cards, poll)
              .toEqual({ mode: "zotero-reader", cards: [] });
          } finally {
            await selectInZotero([]);
            await obRun(
              vaultId!,
              async ({ app }) => {
                app.commands.executeCommandById(
                  "zotlit:annot-view-follow-active-tab",
                );
              },
              undefined,
            );
          }
        }, 120000);
      });

      registerPdfUnchangedCase();
    },
  );
});

async function installHeldWriteProbe(vaultId: string): Promise<void> {
  await obRun(
    vaultId,
    async (
      { zotlit, page: pageHelpers },
      { effectPath }: { effectPath: string },
    ) => {
      const { Effect } = require(effectPath) as Pick<
        typeof import("@zotlit/plugin-kernel/effect.ts"),
        "Effect"
      >;
      const services = zotlit.services;
      const api = services.zoteroLocalApi;
      const gate = Promise.withResolvers<void>();
      const probe: PairedWriteProbe = {
        api,
        authorizedSend: api.authorizedSend.bind(api),
        listAnnotations: api.listAnnotations.bind(api),
        calls: 0,
        reached: false,
        release: gate.resolve,
      };
      pageHelpers.scratch.__zotlitWriteOutcomeProbe = probe;
      api.authorizedSend = (...args) =>
        Effect.promise(async () => {
          probe.calls += 1;
          probe.reached = true;
          await gate.promise;
          return await services.bridge.runPromise(
            probe.authorizedSend(...args),
          );
        });
    },
    { effectPath },
  );
}
