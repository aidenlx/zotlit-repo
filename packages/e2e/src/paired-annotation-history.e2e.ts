import { isDeepStrictEqual } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnnotationDraft } from "@zotlit/annotations/obsidian/annotation-repository/write.ts";
import { ANNOTATIONS } from "@zotlit/scripts/fixture";

import { clearNotices, obRun, obRunUntil, waitFor } from "./obsidian-cli.ts";
import type { PairedScope } from "./page-paired-types.ts";
import {
  annotationKeys,
  madeSince,
  platformKey,
  pressKey,
  rdp,
  redoKey,
  registerPairedReaderSession,
  registerPdfUnchangedCase,
  stepSettled,
  undoKey,
  whileEditingNotLive,
  poll,
} from "./paired-reader-session.ts";
import type { WireTag } from "./paired-run-fixture.ts";
import {
  ATTACHMENT_ITEM,
  annotationColor,
  annotationTags,
  api,
  attachment,
  attachmentPath,
  baseUrl,
  cardTagEditor,
  debuggerPort,
  readerAnnotationColor,
  registerPairedRun,
  serverID,
  setAnnotationTags,
  spelledTags,
  vaultId,
} from "./paired-run-fixture.ts";
import {
  eraseAnnotations,
  freshAnnotationKey,
  storedAnnotation,
} from "./paired-zotero.ts";
import { armToolOnFirstPage, reopenPdfView } from "./reader-gestures.ts";

describe.skipIf(!baseUrl)("Paired Run", () => {
  registerPairedRun();

  describe.skipIf(!debuggerPort || !vaultId)(
    "ZotLit and Zotero on one Fixture",
    () => {
      registerPairedReaderSession();

      describe("the Annotation History in the reader", () => {
        const historyKey = "PUPR5FG5";
        const seeded = ANNOTATIONS.find(({ key }) => key === historyKey)!;
        const seedColor = seeded.color;
        const picked = "#ff6666";

        const storedColor = () => annotationColor(api, serverID, historyKey);

        async function writeSettled(): Promise<void> {
          await obRunUntil(
            vaultId!,
            async ({ zotlit }, { historyKey }: { historyKey: "PUPR5FG5" }) => {
              const { annotationRepository: repository, bridge } =
                zotlit.services;
              return (
                bridge.runSync(repository.mutationFor(historyKey)).kind ===
                  "idle" &&
                !bridge.runSync(repository.textDraftFor("comment", historyKey))
              );
            },
            { historyKey },
            {
              what: "the Annotation History record PUPR5FG5 to go idle with no comment draft",
            },
          );
        }

        const noticeShows = (fragment: string) =>
          obRunUntil(
            vaultId!,
            async (_context, { fragment }: { fragment: string }) => {
              return [
                ...document.querySelectorAll<HTMLElement>(".notice"),
              ].some((node) => node.textContent.includes(fragment));
            },
            { fragment },
            { what: "the ZotLit notice carrying the expected text to appear" },
          );

        async function saveInZotero(
          field: "annotationColor" | "annotationComment",
          value: string,
        ): Promise<void> {
          await rdp.json(`(async () => {
            const item = Zotero.Items.getByLibraryAndKey(
              Zotero.Libraries.userLibraryID,
              ${JSON.stringify(historyKey)},
            );
            item.${field} = ${JSON.stringify(value)};
            await item.saveTx();
            return "saved";
          })()`);
          await obRunUntil(
            vaultId!,
            async (
              { zotlit },
              {
                attachmentKey,
                historyKey,
                recordField,
              }: {
                attachmentKey: string;
                historyKey: "PUPR5FG5";
                recordField: "comment" | "color";
              },
            ) => {
              const { annotationRepository: repository, bridge } =
                zotlit.services;
              const list = await bridge.runPromise(
                repository.refresh(attachmentKey),
              );
              const record = list?.annotations.find(
                (annotation) => annotation.key === historyKey,
              );
              return record![recordField];
            },
            {
              attachmentKey: attachment.key,
              historyKey,
              recordField: field === "annotationColor" ? "color" : "comment",
            },
            {
              ready: () => true,
              what: "the refreshed PUPR5FG5 comment or color field to read back",
            },
          );
        }

        async function selectMark(): Promise<void> {
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                historyKey,
              }: { attachmentPath: string; historyKey: "PUPR5FG5" },
            ) => {
              const view = pageHelpers.pdfView(attachmentPath)!;
              if (!view) return "no view";
              void view.reader!.navigate({ pageIndex: 0 });
              const rect = pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(historyKey)}]`,
                )
                ?.getBoundingClientRect();
              return !!rect && rect.width > 0;
            },
            { attachmentPath, historyKey },
            { what: "the PDF mark PUPR5FG5 to render with a non-empty box" },
          );
          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                historyKey,
              }: { attachmentPath: string; historyKey: "PUPR5FG5" },
            ) => {
              const { tap } = pageHelpers;
              const mark = pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(historyKey)}]`,
                );
              if (mark!.classList.contains("is-selected")) return "selected";
              const rect = mark!.getBoundingClientRect();
              tap(rect.left + rect.width / 2, rect.top + rect.height / 2);
              return "clicked";
            },
            { attachmentPath, historyKey },
          );
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                historyKey,
              }: { attachmentPath: string; historyKey: "PUPR5FG5" },
            ) => {
              return !!pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(historyKey)}]`,
                )
                ?.classList.contains("is-selected");
            },
            { attachmentPath, historyKey },
            { what: "the PDF mark PUPR5FG5 to be selected" },
          );
        }

        async function pickRed(): Promise<void> {
          expect(await pressKey("2", {})).toEqual({ prevented: true });
          expect(
            await waitFor(async () => (await storedColor()) === picked),
          ).toBe(true);
          await writeSettled();
        }

        beforeEach(async () => {
          await reopenPdfView(vaultId!, attachmentPath);
          await clearNotices(vaultId!);
        });

        afterEach(async () => {
          await obRun(
            vaultId!,
            async (
              { zotlit },
              {
                historyKey,
                seedColor,
              }: { historyKey: "PUPR5FG5"; seedColor: string },
            ) => {
              const { annotationRepository: repository, bridge } =
                zotlit.services;
              await bridge.runPromise(
                repository.patchColor(historyKey, seedColor),
              );
              await bridge.runPromise(repository.patchComment(historyKey, ""));
            },
            { historyKey, seedColor },
          );
          expect(
            await waitFor(async () => (await storedColor()) === seedColor),
          ).toBe(true);
        });

        it("puts the colour back for the undo key, and picks it up again for redo", async () => {
          await selectMark();
          await pickRed();

          expect(await undoKey()).toEqual({ handled: true });
          await stepSettled();

          expect(
            await waitFor(async () => (await storedColor()) === seedColor),
          ).toBe(true);
          expect(
            await waitFor(() =>
              readerAnnotationColor(rdp, historyKey, seedColor),
            ),
          ).toBe(true);
          await obRunUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                historyKey,
              }: { attachmentPath: string; historyKey: "PUPR5FG5" },
            ) => {
              return !!pageHelpers
                .pdfView(attachmentPath)!
                .containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(historyKey)}]`,
                )
                ?.classList.contains("is-selected");
            },
            { attachmentPath, historyKey },
            {
              what: "the PDF mark PUPR5FG5 to be selected after the colour step",
            },
          );

          expect(await redoKey()).toEqual({ handled: true });
          await stepSettled();

          expect(
            await waitFor(async () => (await storedColor()) === picked),
          ).toBe(true);
        }, 120000);

        it("takes an undo and a redo pressed together one after the other", async () => {
          await selectMark();
          await pickRed();

          await obRun(
            vaultId!,
            async ({ zotlit }, { attachmentPath }) => {
              const services = zotlit.services;
              const binding = services.bridge
                .runSync(services.pdfAnnotationEditor.bindings)
                .find((candidate) => candidate.filePath === attachmentPath)!;
              binding.stepHistory("undo");
              binding.stepHistory("redo");
            },
            { attachmentPath },
          );
          await stepSettled();

          expect(
            await waitFor(async () => (await storedColor()) === picked),
          ).toBe(true);
          expect(
            await waitFor(() => readerAnnotationColor(rdp, historyKey, picked)),
          ).toBe(true);
        }, 120000);

        it("leaves a colour Zotero changed alone, and says why", async () => {
          await selectMark();
          await pickRed();

          const inZotero = "#5fb236";
          await saveInZotero("annotationColor", inZotero);
          await clearNotices(vaultId!);

          expect(await undoKey()).toEqual({ handled: true });
          await stepSettled();

          expect(await storedColor()).toBe(inZotero);
          await noticeShows(
            "This annotation changed in Zotero, so ZotLit left it as it is.",
          );
        }, 120000);

        it("undoes a colour pick Zotero only commented on", async () => {
          await selectMark();
          await pickRed();

          await saveInZotero("annotationComment", "Read again in Zotero");

          expect(await undoKey()).toEqual({ handled: true });
          await stepSettled();

          expect(
            await waitFor(async () => (await storedColor()) === seedColor),
          ).toBe(true);
        }, 120000);

        it("keeps the step while editing is not live, and takes it once editing is back", async () => {
          await selectMark();
          await pickRed();

          await whileEditingNotLive(async () => {
            expect(await undoKey()).toEqual({ handled: true });
            await stepSettled();
          });
          expect(await storedColor()).toBe(picked);

          expect(await undoKey()).toEqual({ handled: true });
          await stepSettled();
          expect(
            await waitFor(async () => (await storedColor()) === seedColor),
          ).toBe(true);
        }, 120000);

        describe("from the command palette", () => {
          const offered = (id: string) =>
            obRun(
              vaultId!,
              async (
                { app, page: pageHelpers },
                {
                  attachmentPath,
                  commandId,
                }: { attachmentPath: string; commandId: `zotlit:${string}` },
              ) => {
                const view = pageHelpers.pdfView(attachmentPath)!;
                app.workspace.setActiveLeaf(view.leaf, { focus: true });
                return String(
                  (
                    app.commands as typeof app.commands & {
                      findCommand(id: string): import("obsidian").Command;
                    }
                  ).findCommand(commandId).checkCallback!(true),
                );
              },
              { attachmentPath, commandId: `zotlit:${id}` },
            );

          const run = (id: string) =>
            obRun(
              vaultId!,
              async (
                { app, page: pageHelpers },
                {
                  attachmentPath,
                  commandId,
                }: { attachmentPath: string; commandId: `zotlit:${string}` },
              ) => {
                const view = pageHelpers.pdfView(attachmentPath)!;
                app.workspace.setActiveLeaf(view.leaf, { focus: true });
                return String(app.commands.executeCommandById(commandId));
              },
              { attachmentPath, commandId: `zotlit:${id}` },
            );

          it("offers redo only once an undo stands, and takes each step", async () => {
            await selectMark();
            await pickRed();
            expect(await offered("undo-annotation-change")).toBe("true");
            expect(await offered("redo-annotation-change")).toBe("false");

            expect(await run("undo-annotation-change")).toBe("true");
            await stepSettled();
            expect(
              await waitFor(async () => (await storedColor()) === seedColor),
            ).toBe(true);
            expect(await offered("redo-annotation-change")).toBe("true");

            expect(await run("redo-annotation-change")).toBe("true");
            await stepSettled();
            expect(
              await waitFor(async () => (await storedColor()) === picked),
            ).toBe(true);
          }, 120000);
        });

        const storedComment = async () =>
          (await storedAnnotation(api, serverID, historyKey))
            .annotationComment ?? "";

        async function openCommentEditor(): Promise<void> {
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
            { what: "the popup comment editor to open for the history step" },
          );
        }

        const typeComment = (text: string) =>
          obRun(
            vaultId!,
            async ({ page: pageHelpers }, { text }: { text: string }) => {
              pageHelpers.popupEditor()!.focus();
              document.execCommand("selectAll");
              document.execCommand("insertText", false, text);
              return String(true);
            },
            { text },
          );

        async function closeCommentEditor(): Promise<void> {
          await obRun(
            vaultId!,
            async ({ page: pageHelpers }) => {
              pageHelpers.popupEditor()!.dispatchEvent(
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
            async ({ page: pageHelpers }) => {
              return !pageHelpers.popupEditor();
            },
            undefined,
            { what: "the popup comment editor to close" },
          );
          await writeSettled();
        }

        it("puts a whole comment session back for one press of the undo key", async () => {
          await selectMark();
          await openCommentEditor();

          await typeComment("Worth");
          expect(
            await waitFor(async () => (await storedComment()) === "Worth"),
          ).toBe(true);
          await typeComment("Worth citing");
          expect(
            await waitFor(
              async () => (await storedComment()) === "Worth citing",
            ),
          ).toBe(true);
          await closeCommentEditor();

          expect(await undoKey()).toEqual({ handled: true });
          await stepSettled();

          expect(
            await waitFor(async () => (await storedComment()) === ""),
          ).toBe(true);

          expect(await redoKey()).toEqual({ handled: true });
          await stepSettled();
          expect(
            await waitFor(
              async () => (await storedComment()) === "Worth citing",
            ),
          ).toBe(true);
        }, 120000);

        it("leaves the undo key to the comment editor's own text undo", async () => {
          await selectMark();
          await openCommentEditor();
          await typeComment("Typed once");
          expect(
            await waitFor(async () => (await storedComment()) === "Typed once"),
          ).toBe(true);

          const { scoped, typed } = await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                platformKey,
                attachmentPath,
              }: { platformKey: "ctrlKey" | "metaKey"; attachmentPath: string },
            ) => {
              const editor = pageHelpers.popupEditor();
              editor!.focus();
              document.execCommand("selectAll");
              document.execCommand("insertText", false, "Typed once and twice");
              const typed = editor!.textContent;
              const make = () =>
                new KeyboardEvent("keydown", {
                  key: "z",
                  [platformKey]: true,
                  bubbles: true,
                  cancelable: true,
                });
              const probe = make();
              Object.defineProperty(probe, "target", { value: editor });
              const names = [];
              if (probe.ctrlKey) names.push("Ctrl");
              if (probe.metaKey) names.push("Meta");
              const context = {
                modifiers: names.sort().join(","),
                key: probe.key,
                vkey: "KeyZ",
              };
              const scoped =
                (
                  pageHelpers.pdfView(attachmentPath)!.scope! as PairedScope
                ).handleKey(probe, context) === false;
              editor!.dispatchEvent(make());
              return { scoped, typed };
            },
            { platformKey, attachmentPath },
          );
          expect(typed).toBe("Typed once and twice");
          expect(scoped).toBe(false);

          await obRunUntil(
            vaultId!,
            async ({ page: pageHelpers }) => {
              return pageHelpers.popupEditor()!.textContent;
            },
            undefined,
            {
              ready: (value) => value === "Typed once",
              what: "the popup comment editor text to read Typed once",
            },
          );
          expect(await storedComment()).toBe("Typed once");

          await closeCommentEditor();
        }, 120000);

        it("shows the new comment from the moment a blur closes its editor", async () => {
          await selectMark();
          await openCommentEditor();
          const before = "Stored before the blur";
          const after = "Typed just before the blur";
          await typeComment(before);
          expect(
            await waitFor(async () => (await storedComment()) === before),
          ).toBe(true);
          await typeComment(after);

          const shown = await obRun(
            vaultId!,
            async (
              { app, zotlit, page: pageHelpers },
              { key }: { key: "PUPR5FG5" },
            ) => {
              const { until } = pageHelpers;
              const { annotationRepository: repository, bridge } =
                zotlit.services;
              const slot = (root: HTMLElement | null | undefined) => {
                if (root?.querySelector<HTMLElement>(".cm-content"))
                  return "editor";
                const view =
                  root?.querySelector<HTMLElement>(".zt-annot-comment");
                return view ? `view:${view.textContent}` : "none";
              };
              const roots = {
                popup: () =>
                  document.querySelector<HTMLElement>(".zt-pdf-mark-popup"),
                card: () =>
                  app.workspace
                    .getLeavesOfType("zotero-annotation-view")
                    .map((leaf) =>
                      leaf.view.containerEl.querySelector<HTMLElement>(
                        `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(key)}]`,
                      ),
                    )
                    .find(Boolean),
              };
              const shown = {
                popup: [slot(roots.popup())],
                card: [slot(roots.card())],
              };
              const record = () => {
                for (const name of ["popup", "card"] as const) {
                  const state = slot(roots[name]());
                  if (state !== shown[name].at(-1)) shown[name].push(state);
                }
              };
              const observer = new MutationObserver(record);
              observer.observe(document.body, {
                subtree: true,
                childList: true,
                characterData: true,
              });
              pageHelpers
                .popupEditor()!
                .dispatchEvent(new FocusEvent("blur", { relatedTarget: null }));
              await until(
                "comment save settles",
                () =>
                  bridge.runSync(repository.mutationFor(key)).kind === "idle" &&
                  !bridge.runSync(repository.textDraftFor("comment", key)),
                10000,
              ).catch(() => {});
              await new Promise((resolve) => setTimeout(resolve, 300));
              observer.disconnect();
              record();
              return shown;
            },
            { key: historyKey },
          );
          expect(shown.popup).toEqual(["editor", `view:${after}`]);
          expect(shown.card.at(-1)).toBe(`view:${after}`);
          expect(shown.card.length).toBeLessThanOrEqual(2);
          expect(await storedComment()).toBe(after);

          expect(
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
                await new Promise((resolve) => requestAnimationFrame(resolve));
                return !!pageHelpers.popupEditor();
              },
              undefined,
            ),
          ).toBe(true);
          await closeCommentEditor();
        }, 120000);

        describe("and the Annotation Card beside it", () => {
          async function pickOnCard(): Promise<void> {
            await obRunUntil(
              vaultId!,
              async (
                { app, page: pageHelpers },
                { historyKey }: { historyKey: "PUPR5FG5" },
              ) => {
                const { press } = pageHelpers;
                const card = app.workspace
                  .getLeavesOfType("zotero-annotation-view")
                  .map((leaf) =>
                    leaf.view.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(historyKey)}]`,
                    ),
                  )
                  .find(Boolean);
                if (!card) return "no card";
                press(card, "card");
                return card.hasAttribute("data-alone");
              },
              { historyKey },
              {
                what: "the Annotation Card for PUPR5FG5 to be marked alone after a press",
              },
            );
            expect(await pressOnCard("2", {})).toEqual({ handled: true });
            expect(
              await waitFor(async () => (await storedColor()) === picked),
            ).toBe(true);
            await writeSettled();
          }

          const pressOnCard = (
            key: string,
            modifiers: {
              ctrlKey?: boolean;
              metaKey?: boolean;
              shiftKey?: boolean;
            },
          ) =>
            obRun(
              vaultId!,
              async (
                { app },
                {
                  historyKey,
                  keyName,
                  keyModifiers,
                }: {
                  historyKey: "PUPR5FG5";
                  keyName: string;
                  keyModifiers: {
                    ctrlKey?: boolean;
                    metaKey?: boolean;
                    shiftKey?: boolean;
                  };
                },
              ) => {
                const card = app.workspace
                  .getLeavesOfType("zotero-annotation-view")
                  .map((leaf) =>
                    leaf.view.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(historyKey)}]`,
                    ),
                  )
                  .find(Boolean);
                if (!card) return { handled: false };
                const view = app.workspace
                  .getLeavesOfType("zotero-annotation-view")
                  .map((leaf) => leaf.view)
                  .find((candidate) => candidate.containerEl.contains(card));
                if (!view) return { handled: false };
                card.focus();
                const event = new KeyboardEvent("keydown", {
                  key: keyName,
                  ...keyModifiers,
                  bubbles: true,
                  cancelable: true,
                });
                Object.defineProperty(event, "target", { value: card });
                const names = [];
                if (event.ctrlKey) names.push("Ctrl");
                if (event.metaKey) names.push("Meta");
                if (event.altKey) names.push("Alt");
                if (event.shiftKey) names.push("Shift");
                const context = {
                  modifiers: names.sort().join(","),
                  key: event.key,
                  vkey: `Key${event.key.toUpperCase()}`,
                };
                const handled =
                  (view.scope! as PairedScope).handleKey(event, context) ===
                  false;
                return { handled };
              },
              { historyKey, keyName: key, keyModifiers: modifiers },
            );

          const undoOnCard = () => pressOnCard("z", { [platformKey]: true });

          it("puts back a colour the card picked, for the reader's undo key", async () => {
            await pickOnCard();

            expect(await undoKey()).toEqual({ handled: true });
            await stepSettled();

            expect(
              await waitFor(async () => (await storedColor()) === seedColor),
            ).toBe(true);
            await obRunUntil(
              vaultId!,
              async ({ app }, { historyKey }: { historyKey: "PUPR5FG5" }) => {
                return app.workspace
                  .getLeavesOfType("zotero-annotation-view")
                  .map((leaf) =>
                    leaf.view.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(historyKey)}]`,
                    ),
                  )
                  .find(Boolean)
                  ?.getAttribute("data-annot-color");
              },
              { historyKey },
              {
                ready: (value) => value === seedColor,
                what: "the Annotation Card for PUPR5FG5 color to match the seed color",
              },
            );
          }, 120000);

          it("takes the top step of the Attachment's history for the card's own undo key", async () => {
            await pickOnCard();

            expect(await undoOnCard()).toEqual({ handled: true });

            expect(
              await waitFor(async () => (await storedColor()) === seedColor),
            ).toBe(true);
          }, 120000);

          describe("a tag session", () => {
            const seededTags: WireTag[] = (seeded.tags ?? []).map(
              ({ name, type }) => ({ tag: name, type }),
            );
            const autoTag = { tag: "e2e-auto", type: 1 };
            const addedName = "e2e-card";
            const { press, toggle, editorReady, editorChips, type, remove } =
              cardTagEditor(historyKey);
            const storedTags = () => annotationTags(api, serverID, historyKey);

            const setTagsInZotero = (tags: readonly WireTag[]) =>
              setAnnotationTags(rdp, historyKey, tags);

            async function closeTagEditor(): Promise<void> {
              await press(toggle);
              await obRunUntil(
                vaultId!,
                async (
                  { app, zotlit },
                  { historyKey }: { historyKey: "PUPR5FG5" },
                ) => {
                  const { annotationRepository: repository, bridge } =
                    zotlit.services;
                  return (
                    !app.workspace
                      .getLeavesOfType("zotero-annotation-view")
                      .map((leaf) =>
                        leaf.view.containerEl.querySelector<HTMLElement>(
                          `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(historyKey)}]`,
                        ),
                      )
                      .find(Boolean)
                      ?.querySelector<HTMLInputElement>(
                        ".zt-annot-tag-input",
                      ) &&
                    bridge.runSync(repository.mutationFor(historyKey)).kind ===
                      "idle" &&
                    !bridge.runSync(repository.tagDraftFor(historyKey))
                  );
                },
                { historyKey },
                {
                  what: "the card tag input for PUPR5FG5 to open with an idle mutation and no tag draft",
                },
              );
            }

            beforeEach(async () => {
              await setTagsInZotero([...seededTags, autoTag]);
            });

            afterEach(async () => {
              await setTagsInZotero(seededTags);
            });

            it("puts the tags a card session changed back for the undo key, and applies them again for redo", async () => {
              await press(toggle);
              expect(await editorReady()).toBe(true);
              expect(await remove(autoTag.tag)).toBe("removed");
              await type(addedName, { enter: true });
              await expect
                .poll(editorChips, poll)
                .toEqual([...seededTags.map(({ tag }) => tag), addedName]);
              await closeTagEditor();
              const edited = spelledTags([...seededTags, { tag: addedName }]);
              await expect.poll(storedTags, poll).toEqual(edited);

              expect(await undoKey()).toEqual({ handled: true });
              await stepSettled();

              await expect
                .poll(storedTags, poll)
                .toEqual(spelledTags([...seededTags, autoTag]));

              expect(await redoKey()).toEqual({ handled: true });
              await stepSettled();

              await expect.poll(storedTags, poll).toEqual(edited);
            }, 120000);

            it("saves a card session on a blur, keeps the editor open for the next, and records one step for each", async () => {
              const first = "e2e-blur-first";
              const second = "e2e-blur-second";
              const tagsSettled = () =>
                obRunUntil(
                  vaultId!,
                  async (
                    { zotlit },
                    { historyKey }: { historyKey: "PUPR5FG5" },
                  ) => {
                    const { annotationRepository: repository, bridge } =
                      zotlit.services;
                    return (
                      bridge.runSync(repository.mutationFor(historyKey))
                        .kind === "idle" &&
                      !bridge.runSync(repository.tagDraftFor(historyKey))
                    );
                  },
                  { historyKey },
                  {
                    what: "the PUPR5FG5 mutation to go idle with no tag draft left",
                  },
                );
              const before = spelledTags([...seededTags, autoTag]);

              await press(toggle);
              expect(await editorReady()).toBe(true);
              await type(first, { enter: true });
              await expect.poll(editorChips, poll).toContain(first);
              await obRun(
                vaultId!,
                async ({ app }, { historyKey }: { historyKey: "PUPR5FG5" }) => {
                  app.workspace
                    .getLeavesOfType("zotero-annotation-view")
                    .map((leaf) =>
                      leaf.view.containerEl.querySelector<HTMLElement>(
                        `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(historyKey)}]`,
                      ),
                    )
                    .find(Boolean)!
                    .querySelector<HTMLInputElement>(".zt-annot-tag-input")!
                    .dispatchEvent(
                      new FocusEvent("focusout", {
                        bubbles: true,
                        relatedTarget: null,
                      }),
                    );
                },
                { historyKey },
              );
              const once = spelledTags([
                ...seededTags,
                autoTag,
                { tag: first },
              ]);
              await expect.poll(storedTags, poll).toEqual(once);
              await tagsSettled();
              expect(
                await obRun(
                  vaultId!,
                  async (
                    { app },
                    { historyKey }: { historyKey: "PUPR5FG5" },
                  ) => {
                    return !!app.workspace
                      .getLeavesOfType("zotero-annotation-view")
                      .map((leaf) =>
                        leaf.view.containerEl.querySelector<HTMLElement>(
                          `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(historyKey)}]`,
                        ),
                      )
                      .find(Boolean)
                      ?.querySelector<HTMLInputElement>(".zt-annot-tag-input");
                  },
                  { historyKey },
                ),
              ).toBe(true);

              await obRun(
                vaultId!,
                async ({ app }, { historyKey }: { historyKey: "PUPR5FG5" }) => {
                  app.workspace
                    .getLeavesOfType("zotero-annotation-view")
                    .map((leaf) =>
                      leaf.view.containerEl.querySelector<HTMLElement>(
                        `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(historyKey)}]`,
                      ),
                    )
                    .find(Boolean)!
                    .querySelector<HTMLInputElement>(".zt-annot-tag-input")!
                    .dispatchEvent(
                      new FocusEvent("focusin", { bubbles: true }),
                    );
                },
                { historyKey },
              );
              await type(second, { enter: true });
              await expect.poll(editorChips, poll).toContain(second);
              await obRun(
                vaultId!,
                async ({ app }, { historyKey }: { historyKey: "PUPR5FG5" }) => {
                  app.workspace
                    .getLeavesOfType("zotero-annotation-view")
                    .map((leaf) =>
                      leaf.view.containerEl.querySelector<HTMLElement>(
                        `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(historyKey)}]`,
                      ),
                    )
                    .find(Boolean)!
                    .querySelector<HTMLInputElement>(".zt-annot-tag-input")!
                    .dispatchEvent(
                      new KeyboardEvent("keydown", {
                        key: "Escape",
                        bubbles: true,
                        cancelable: true,
                      }),
                    );
                },
                { historyKey },
              );
              const twice = spelledTags([
                ...seededTags,
                autoTag,
                { tag: first },
                { tag: second },
              ]);
              await expect.poll(storedTags, poll).toEqual(twice);
              await obRunUntil(
                vaultId!,
                async ({ app }, { historyKey }: { historyKey: "PUPR5FG5" }) => {
                  return !app.workspace
                    .getLeavesOfType("zotero-annotation-view")
                    .map((leaf) =>
                      leaf.view.containerEl.querySelector<HTMLElement>(
                        `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(historyKey)}]`,
                      ),
                    )
                    .find(Boolean)
                    ?.querySelector<HTMLInputElement>(".zt-annot-tag-input");
                },
                { historyKey },
                { what: "the card tag input for PUPR5FG5 to close" },
              );
              await tagsSettled();

              expect(await undoKey()).toEqual({ handled: true });
              await stepSettled();
              await expect.poll(storedTags, poll).toEqual(once);
              expect(await undoKey()).toEqual({ handled: true });
              await stepSettled();
              await expect.poll(storedTags, poll).toEqual(before);
            }, 120000);
          });
        });

        describe("a create and a delete", () => {
          const draft: Omit<AnnotationDraft, "parentKey"> = {
            type: "highlight" as const,
            color: "#a28ae5",
            comment: "Annotation History run",
            text: "Identify Your Message",
            pageLabel: "1",
            sortIndex: "00000|000100|00101",
            position: { pageIndex: 0, rects: [[100, 560, 300, 580]] },
          };

          const createDraft = async () => {
            await obRunUntil(
              vaultId!,
              async (
                { zotlit },
                { attachmentKey }: { attachmentKey: string },
              ) => {
                const { annotationRepository: repository, bridge } =
                  zotlit.services;
                return bridge.runSync(repository.capabilityFor(attachmentKey))
                  .kind;
              },
              { attachmentKey: attachment.key },
              {
                ready: (value) => value === "writable",
                what: "the attachment's annotation capability to report writable",
              },
            );
            return obRun(
              vaultId!,
              async (
                { zotlit },
                {
                  attachmentKey,
                  draft,
                }: {
                  attachmentKey: string;
                  draft: Omit<AnnotationDraft, "parentKey">;
                },
              ) => {
                const outcome = await zotlit.services.bridge.runPromise(
                  zotlit.services.annotationRepository.createAnnotation(
                    attachmentKey,
                    draft,
                  ),
                );
                return {
                  kind: outcome.kind,
                  annotationKey:
                    "annotationKey" in outcome
                      ? outcome.annotationKey
                      : undefined,
                };
              },
              { attachmentKey: attachment.key, draft },
            );
          };

          const eraseThrough = (annotationKey: string) =>
            obRun(
              vaultId!,
              async (
                { zotlit },
                { annotationKey }: { annotationKey: string },
              ) => {
                const state = await zotlit.services.bridge.runPromise(
                  zotlit.services.annotationRepository.deleteAnnotation(
                    annotationKey,
                  ),
                );
                return state.kind === "failed"
                  ? { kind: state.kind, failure: { kind: state.failure.kind } }
                  : { kind: state.kind };
              },
              { annotationKey },
            );

          let baseline: readonly string[] = [];

          const extra = async (): Promise<string | null> =>
            (await madeSince(baseline))[0] ?? null;

          beforeEach(async () => {
            baseline = await annotationKeys();
          });

          afterEach(async () => {
            await eraseAnnotations(rdp, await madeSince(baseline));
          });

          it("takes back a create, and redoes it under a new key", async () => {
            const created = await createDraft();
            expect(created.kind).toBe("created");
            const madeKey = created.annotationKey!;

            expect(await undoKey()).toEqual({ handled: true });
            await stepSettled();

            expect(await waitFor(async () => (await extra()) === null)).toBe(
              true,
            );

            expect(await redoKey()).toEqual({ handled: true });
            await stepSettled();

            expect(await waitFor(async () => (await extra()) !== null)).toBe(
              true,
            );
            const restored = (await extra())!;
            expect(restored).not.toBe(madeKey);
            expect(
              await storedAnnotation(api, serverID, restored),
            ).toMatchObject({
              annotationType: draft.type,
              annotationColor: draft.color,
              annotationComment: draft.comment,
              annotationPageLabel: draft.pageLabel,
              annotationSortIndex: draft.sortIndex,
            });
          }, 120000);

          it("takes back a note the tool placed, and leaves nothing selected", async () => {
            const CLEAR = [150, 250] as const;
            await armToolOnFirstPage(vaultId!, {
              attachmentPath,
              tool: "note",
              at: CLEAR,
            });
            await obRun(
              vaultId!,
              async (
                { page: pageHelpers },
                {
                  attachmentPath,
                  pointX,
                  pointY,
                }: { attachmentPath: string; pointX: 150; pointY: 250 },
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
              },
              { attachmentPath, pointX: CLEAR[0], pointY: CLEAR[1] },
            );
            const noteKey = await freshAnnotationKey(rdp, {
              item: ATTACHMENT_ITEM,
              before: baseline,
            });

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
                ready: (value) => isDeepStrictEqual(value, [noteKey]),
                what: "the PDF selection to match the created note key",
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
                { zotlit, page: pageHelpers },
                { noteKey }: { noteKey: string },
              ) => {
                const { annotationRepository: repository, bridge } =
                  zotlit.services;
                return (
                  !pageHelpers.popupEditor() &&
                  bridge.runSync(repository.mutationFor(noteKey)).kind ===
                    "idle" &&
                  !bridge.runSync(repository.textDraftFor("comment", noteKey))
                );
              },
              { noteKey },
              {
                what: "the note popup editor to close and its mutation to go idle",
              },
            );

            expect(await undoKey()).toEqual({ handled: true });
            await stepSettled();

            expect(
              await waitFor(async () => (await extra()) === null),
              "Zotero no longer holds the note after undo",
            ).toBe(true);
            await obRunUntil(
              vaultId!,
              async (
                { page: pageHelpers },
                {
                  attachmentPath,
                  noteKey,
                }: { attachmentPath: string; noteKey: string },
              ) => {
                const selected = JSON.stringify(
                  [
                    ...pageHelpers
                      .pdfView(attachmentPath)!
                      .containerEl.querySelectorAll<SVGGraphicsElement>(
                        ".zt-pdf-annotation-mark.is-selected",
                      ),
                  ].map((mark) => mark.dataset.zoteroAnnotationKey),
                );
                const mark = pageHelpers
                  .pdfView(attachmentPath)!
                  .containerEl.querySelector<SVGGraphicsElement>(
                    `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(noteKey)}]`,
                  );
                return {
                  selected: JSON.parse(selected),
                  mark: !!mark,
                };
              },
              { attachmentPath, noteKey },
              {
                ready: (value) =>
                  isDeepStrictEqual(value, { selected: [], mark: false }),
                what: "the PDF selection to be empty and the note mark to be gone",
              },
            );
          }, 120000);

          it("puts a deleted Annotation back under a new key, and redoes the delete", async () => {
            const created = await createDraft();
            expect(created.kind).toBe("created");
            const madeKey = created.annotationKey!;
            const before = await storedAnnotation(api, serverID, madeKey);

            expect(await eraseThrough(madeKey)).toEqual({ kind: "idle" });
            expect(await waitFor(async () => (await extra()) === null)).toBe(
              true,
            );

            expect(await undoKey()).toEqual({ handled: true });
            await stepSettled();

            expect(await waitFor(async () => (await extra()) !== null)).toBe(
              true,
            );
            const restored = (await extra())!;
            expect(restored).not.toBe(madeKey);
            expect(
              await storedAnnotation(api, serverID, restored),
            ).toMatchObject({
              annotationType: before.annotationType,
              annotationColor: before.annotationColor,
              annotationComment: before.annotationComment,
              annotationPosition: before.annotationPosition,
              annotationSortIndex: before.annotationSortIndex,
            });

            expect(await redoKey()).toEqual({ handled: true });
            await stepSettled();

            expect(await waitFor(async () => (await extra()) === null)).toBe(
              true,
            );
          }, 120000);
        });
      });

      registerPdfUnchangedCase();
    },
  );
});
