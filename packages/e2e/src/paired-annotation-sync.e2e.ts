import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";

import type { AnnotationView } from "@zotlit/query-views/desktop/annot-view/view.tsx";

import { verifySavedEditDisplay } from "./excerpt-acceptance.ts";
import { verifyExcerptRefresh } from "./excerpt-refresh.ts";
import {
  clearNotices,
  cli,
  obRun,
  obRunUntil,
  waitFor,
} from "./obsidian-cli.ts";
import type { LibraryWorkerMessage } from "./page-library-types.ts";
import type { PairedWriteProbe } from "./page-paired-types.ts";
import {
  cleanup,
  rdp,
  registerPairedReaderSession,
  registerPdfUnchangedCase,
} from "./paired-reader-session.ts";
import {
  APP_NAME,
  annotationColor,
  annotationTags,
  api,
  attachment,
  attachmentPath,
  baseUrl,
  cardTagEditor,
  debuggerPort,
  effectPath,
  environment,
  m,
  readAnnotationState,
  readerAnnotationColor,
  readerHoldsAnnotation,
  registerPairedRun,
  restoreWriteOutcomeProbe,
  serverID,
  setAnnotationTags,
  setLocalApi,
  tagEditorIn,
  vaultId,
} from "./paired-run-fixture.ts";
import {
  authorizationCount,
  clickAuthorizationDialog,
  denyAnyAuthorizationDialog,
  dismissAuthorizationDialog,
  grantRememberedKey,
  resetAuthorizations,
  restorePrompt,
  stubPrompt,
  waitForAuthorizationDialog,
  zoteroFetch,
} from "./paired-zotero.ts";
import { reloadWindow } from "./window-reload.ts";

describe.skipIf(!baseUrl)("Paired Run", () => {
  registerPairedRun();

  describe.skipIf(!debuggerPort || !vaultId)(
    "ZotLit and Zotero on one Fixture",
    () => {
      registerPairedReaderSession();

      let createdKey = "";

      it("creates an Annotation that reaches Zotero, the page overlay and the card", async () => {
        await obRun(
          vaultId!,
          async ({ page: pageHelpers }) => {
            // oxlint-disable-next-line typescript/unbound-method -- Restored unchanged and called with the original worker receiver.
            const post = Worker.prototype.postMessage;
            const pending: (() => void)[] = [];
            pageHelpers.scratch.__ztQueryGateHits = 0;
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
                pageHelpers.scratch.__ztQueryGateHits!++;
                pending.push(() => Reflect.apply(postTarget, receiver, args));
              },
            });
            pageHelpers.scratch.__ztQueryGate = () => {
              Worker.prototype.postMessage = post;
              for (const send of pending.splice(0)) send();
            };
          },
          undefined,
        );
        cleanup.defer(async () => {
          await obRun(
            vaultId!,
            async ({ page: pageHelpers }) => {
              pageHelpers.scratch.__ztQueryGate?.();
              delete pageHelpers.scratch.__ztQueryGate;
              delete pageHelpers.scratch.__ztQueryGateHits;
            },
            undefined,
          );
        });
        const created = await obRun(
          vaultId!,
          async (
            { zotlit },
            {
              attachmentKey,
              highlightSpec,
            }: {
              attachmentKey: string;
              highlightSpec: {
                type: "highlight";
                color: "#5fb236";
                comment: "End-to-end Run create";
                text: "End-to-end Run";
                pageLabel: "1";
                sortIndex: "00000|000100|00100";
                position: { pageIndex: 0; rects: [[100, 600, 300, 620]] };
              };
            },
          ) => {
            const outcome = await zotlit.services.bridge.runPromise(
              zotlit.services.annotationRepository.createAnnotation(
                attachmentKey,
                highlightSpec,
              ),
            );
            return {
              kind: outcome.kind,
              annotationKey:
                "annotationKey" in outcome ? outcome.annotationKey : undefined,
            };
          },
          {
            attachmentKey: attachment.key,
            highlightSpec: {
              type: "highlight",
              color: "#5fb236",
              comment: "End-to-end Run create",
              text: "End-to-end Run",
              pageLabel: "1",
              sortIndex: "00000|000100|00100",
              position: {
                pageIndex: 0,
                rects: [[100, 600, 300, 620]],
              },
            },
          },
        );
        expect(created.kind).toBe("created");
        createdKey = created.annotationKey!;
        await obRunUntil(
          vaultId!,
          async ({ app }, { createdKey }: { createdKey: string }) => {
            return app.workspace
              .getLeavesOfType("zotero-annotation-view")
              .some(({ view }) =>
                view.containerEl.querySelector<HTMLElement>(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
                ),
              );
          },
          { createdKey },
          {
            what: "the Annotation Card for the new Annotation in the Annotation View",
          },
        );
        await obRunUntil(
          vaultId!,
          ({ page: pageHelpers }) =>
            (pageHelpers.scratch.__ztQueryGateHits ?? 0) > 0,
          undefined,
          { what: "the creation query to reach the held worker boundary" },
        );
        await obRun(
          vaultId!,
          async ({ page: pageHelpers }) => {
            pageHelpers.scratch.__ztQueryGate!();
            delete pageHelpers.scratch.__ztQueryGate;
            delete pageHelpers.scratch.__ztQueryGateHits;
          },
          undefined,
        );
        cleanup.defer(async () => {
          await rdp.json(`(async () => {
            const item = Zotero.Items.getByLibraryAndKey(
              Zotero.Libraries.userLibraryID,
              ${JSON.stringify(createdKey)},
            );
            if (item) await item.eraseTx();
            return "erased";
          })()`);
        });

        const stored = await zoteroFetch(api, `users/0/items/${createdKey}`, {
          headers: { "Zotero-Server-ID": serverID },
        });
        expect(stored.status).toBe(200);
        const record = (await stored.json()) as {
          data: { parentItem: string; annotationComment: string };
        };
        expect(record.data.parentItem).toBe(attachment.key);
        expect(record.data.annotationComment).toBe("End-to-end Run create");

        expect(
          await waitFor(() => readerHoldsAnnotation(rdp, createdKey)),
        ).toBe(true);

        await obRunUntil(
          vaultId!,
          async ({ app, page }, { createdKey }: { createdKey: string }) => {
            return app.workspace
              .getLeavesOfType(page.reader.viewType)
              .some(({ view }) =>
                view.containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
                ),
              );
          },
          { createdKey },
          {
            what: "the PDF overlay mark for the created Annotation on the page",
          },
        );

        await obRunUntil(
          vaultId!,
          async ({ app }, { createdKey }: { createdKey: string }) => {
            return app.workspace
              .getLeavesOfType("zotero-annotation-view")
              .some(({ view }) =>
                view.containerEl.querySelector<HTMLElement>(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
                ),
              );
          },
          { createdKey },
          {
            what: "the Annotation Card for the created Annotation in the Annotation View",
          },
        );
      }, 120000);

      it("edits that Annotation and the edit reaches the same three surfaces", async () => {
        const edited = "#a28ae5";
        const state = await obRun(
          vaultId!,
          async (
            { zotlit },
            { createdKey, edited }: { createdKey: string; edited: "#a28ae5" },
          ) => {
            const state = await zotlit.services.bridge.runPromise(
              zotlit.services.annotationRepository.patchColor(
                createdKey,
                edited,
              ),
            );
            return state.kind === "failed"
              ? { kind: state.kind, failure: { kind: state.failure.kind } }
              : { kind: state.kind };
          },
          { createdKey, edited },
        );
        expect(state.kind).toBe("idle");

        expect(
          await waitFor(
            async () =>
              (await annotationColor(api, serverID, createdKey)) === edited,
          ),
        ).toBe(true);
        expect(
          await waitFor(() => readerAnnotationColor(rdp, createdKey, edited)),
        ).toBe(true);
        await obRunUntil(
          vaultId!,
          async ({ app, page }, { createdKey }: { createdKey: string }) => {
            return app.workspace
              .getLeavesOfType(page.reader.viewType)
              .map((leaf) =>
                leaf.view.containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
                ),
              )
              .find(Boolean)
              ?.getAttribute("fill");
          },
          { createdKey },
          {
            ready: (value) => value === edited,
            what: "the PDF overlay mark of the edited Annotation to take the new fill",
          },
        );
        await obRunUntil(
          vaultId!,
          async (
            { app },
            { createdKey, edited }: { createdKey: string; edited: "#a28ae5" },
          ) => {
            const card = app.workspace
              .getLeavesOfType("zotero-annotation-view")
              .map((leaf) =>
                leaf.view.containerEl.querySelector<HTMLElement>(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
                ),
              )
              .find(Boolean);
            if (!card) return "no card";
            return card.getAttribute("data-annot-color") === edited;
          },
          { createdKey, edited },
          { what: "the Annotation Card swatch to show the edited color" },
        );
      }, 120000);

      it("adds and removes tags on the card, and Zotero holds the list", async () => {
        const {
          press,
          toggle,
          editorReady,
          cardTags,
          editorChips,
          type,
          remove,
        } = cardTagEditor(createdKey);
        const storedTags = () => annotationTags(api, serverID, createdKey);
        const poll = { timeout: 10_000, interval: 250 };
        const kept = "End-to-end Run tag, kept whole";
        const dropped = "End-to-end Run tag dropped";
        const typed = "End-to-end Run tag left typed";

        expect(await storedTags()).toStrictEqual([]);
        await press(toggle);
        expect(await editorReady()).toBe(true);
        await type(kept, { enter: true });
        await expect.poll(editorChips, poll).toEqual([kept]);
        await type(dropped, { enter: true });
        await expect.poll(editorChips, poll).toEqual([kept, dropped]);
        expect(await storedTags()).toStrictEqual([]);
        await press(toggle);

        await expect
          .poll(storedTags, poll)
          .toEqual([`${dropped}:0`, `${kept}:0`]);
        await expect
          .poll(async () => (await cardTags()).toSorted(), poll)
          .toEqual([dropped, kept]);

        await press(toggle);
        expect(await editorReady()).toBe(true);
        expect(await remove(dropped)).toBe("removed");
        await expect.poll(editorChips, poll).toEqual([kept]);
        await type(typed, { enter: false });
        await press(toggle);

        await expect
          .poll(storedTags, poll)
          .toEqual([`${typed}:0`, `${kept}:0`]);
        await expect
          .poll(async () => (await cardTags()).toSorted(), poll)
          .toEqual([typed, kept]);
      }, 120000);

      it("shows the card's new tags from the moment its tag editor closes", async () => {
        const { press, toggle, editorReady, cardTags, editorChips, type } =
          cardTagEditor(createdKey);
        const poll = { timeout: 10_000, interval: 250 };
        const added = "End-to-end Run tag drawn at once";
        await setAnnotationTags(rdp, createdKey, []);
        await expect.poll(cardTags, poll).toEqual([]);

        await press(toggle);
        expect(await editorReady()).toBe(true);
        await type(added, { enter: true });
        await expect.poll(editorChips, poll).toEqual([added]);

        const shown = await obRun(
          vaultId!,
          async (
            { app, zotlit, page: pageHelpers },
            { key, toggle }: { key: string; toggle: string },
          ) => {
            const { press, until } = pageHelpers;
            const { annotationRepository: repository, bridge } =
              zotlit.services;
            const card = () =>
              app.workspace
                .getLeavesOfType("zotero-annotation-view")
                .map((leaf) =>
                  leaf.view.containerEl.querySelector<HTMLElement>(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(key)}]`,
                  ),
                )
                .find(Boolean);
            const row = () =>
              card()?.querySelector<HTMLInputElement>(".zt-annot-tag-input")
                ? "editor"
                : `chips:${[...(card()?.querySelectorAll<HTMLElement>("[aria-pressed]") ?? [])].map((chip) => chip.textContent).join("|")}`;
            const shown = [row()];
            const record = () => {
              const state = row();
              if (state !== shown.at(-1)) shown.push(state);
            };
            const observer = new MutationObserver(record);
            observer.observe(document.body, {
              subtree: true,
              childList: true,
              characterData: true,
            });
            press(card()!.querySelector<HTMLElement>(toggle), "tag toggle");
            await until(
              "tag save settles",
              () =>
                bridge.runSync(repository.mutationFor(key)).kind === "idle" &&
                !bridge.runSync(repository.tagDraftFor(key)),
              10000,
            ).catch(() => {});
            await new Promise((resolve) => setTimeout(resolve, 300));
            observer.disconnect();
            record();
            return shown;
          },
          { key: createdKey, toggle },
        );
        expect(shown).toEqual(["editor", `chips:${added}`]);
        expect(await annotationTags(api, serverID, createdKey)).toEqual([
          `${added}:0`,
        ]);
      }, 120000);

      it("adds and removes tags from the Mark Popup, and Zotero holds the list", async () => {
        const { editorReady, editorChips, type, remove } = tagEditorIn({
          kind: "popup",
        });
        const pressVerb = () =>
          obRunUntil(
            vaultId!,
            async ({ page: pageHelpers }) => {
              const { press } = pageHelpers;
              const verb = document
                .querySelector<HTMLElement>(".zt-pdf-mark-popup")
                ?.querySelector<HTMLElement>("[data-zt-verb=tags]");
              if (!verb) return "absent";
              press(verb, "Tags");
              return "pressed";
            },
            undefined,
            {
              ready: (value) => value === "pressed",
              what: "the Mark Popup to offer a Tags verb that can be pressed",
            },
          );
        const popupTags = () =>
          obRun(
            vaultId!,
            async (_context) => {
              return document
                .querySelector<HTMLElement>(".zt-pdf-mark-popup")
                ?.querySelector<HTMLElement>("[data-zt-section=tags]")
                ?.querySelector<HTMLInputElement>(".zt-annot-tag-input")
                ? null
                : [
                    ...(document
                      .querySelector<HTMLElement>(".zt-pdf-mark-popup")
                      ?.querySelector<HTMLElement>("[data-zt-section=tags]")
                      ?.querySelectorAll<HTMLElement>(":scope > div > span") ??
                      []),
                  ]
                    .map((chip) => chip.textContent)
                    .sort();
            },
            undefined,
          );
        const storedTags = () => annotationTags(api, serverID, createdKey);
        const poll = { timeout: 10_000, interval: 250 };
        const kept = "End-to-end Run tag, kept whole";
        const removed = "End-to-end Run tag left typed";
        const added = "End-to-end Run tag from the popup";
        await setAnnotationTags(rdp, createdKey, [
          { tag: removed },
          { tag: kept },
        ]);

        await obRunUntil(
          vaultId!,
          async (
            { page: pageHelpers },
            {
              attachmentPath,
              createdKey,
            }: { attachmentPath: string; createdKey: string },
          ) => {
            const view = pageHelpers.pdfView(attachmentPath)!;
            if (!view) return "no view";
            void view.reader!.navigate({ pageIndex: 0 });
            const rect = pageHelpers
              .pdfView(attachmentPath)
              ?.containerEl.querySelector<SVGGraphicsElement>(
                `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
              )
              ?.getBoundingClientRect();
            return !!rect && rect.width > 0;
          },
          { attachmentPath, createdKey },
          {
            what: "the created Annotation's PDF mark to be laid out on page 1",
          },
        );
        await obRun(
          vaultId!,
          async (
            { page: pageHelpers },
            {
              attachmentPath,
              createdKey,
            }: { attachmentPath: string; createdKey: string },
          ) => {
            const { tap } = pageHelpers;
            const rect = pageHelpers
              .pdfView(attachmentPath)!
              .containerEl.querySelector<SVGGraphicsElement>(
                `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
              )!
              .getBoundingClientRect();
            tap(rect.left + rect.width / 2, rect.top + rect.height / 2);
          },
          { attachmentPath, createdKey },
        );
        await obRunUntil(
          vaultId!,
          async (
            { page: pageHelpers },
            {
              attachmentPath,
              createdKey,
            }: { attachmentPath: string; createdKey: string },
          ) => {
            const { press } = pageHelpers;
            if (!document.querySelector<HTMLElement>(".zt-pdf-mark-popup"))
              return "no popup";
            if (
              pageHelpers
                .pdfView(attachmentPath)
                ?.containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
                )
                ?.classList.contains("is-selected")
            )
              return "selected";
            press(
              document
                .querySelector<HTMLElement>(".zt-pdf-mark-popup")!
                .querySelector<HTMLElement>("[data-zt-verb=stack]"),
              "Stack",
            );
            return "stepped";
          },
          { attachmentPath, createdKey },
          {
            ready: (value) => value === "selected",
            what: "the created mark to be selected by stepping the Mark Popup stack",
          },
        );
        await expect.poll(popupTags, poll).toEqual([removed, kept].toSorted());

        await pressVerb();
        expect(await editorReady()).toBe(true);
        await type(added, { enter: true });
        await expect.poll(editorChips, poll).toContain(added);
        expect(await remove(removed)).toBe("removed");
        await expect.poll(editorChips, poll).not.toContain(removed);
        expect(await storedTags()).toStrictEqual([`${removed}:0`, `${kept}:0`]);
        await pressVerb();

        await expect
          .poll(storedTags, poll)
          .toEqual([`${added}:0`, `${kept}:0`]);
        await expect.poll(popupTags, poll).toEqual([added, kept].toSorted());
        expect(
          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                attachmentPath,
                createdKey,
              }: { attachmentPath: string; createdKey: string },
            ) => {
              return !!pageHelpers
                .pdfView(attachmentPath)
                ?.containerEl.querySelector<SVGGraphicsElement>(
                  `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
                )
                ?.classList.contains("is-selected");
            },
            { attachmentPath, createdKey },
          ),
        ).toBe(true);
      }, 120000);

      it("keeps painting through a saved edit, then publishes the edited pixels", async (context) => {
        await verifySavedEditDisplay(vaultId!, context);
      }, 120000);

      it("saves a comment from a pop-out card's native Scope", async () => {
        await obRun(
          vaultId!,
          async ({ app }) => {
            const leaf = app.workspace.getLeavesOfType(
              "zotero-annotation-view",
            )[0];
            if (!leaf) return;
            (leaf.view as AnnotationView).gestures!.onPinCurrentItem();
            app.workspace.moveLeafToPopout(leaf);
          },
          undefined,
        );
        await obRunUntil(
          vaultId!,
          async ({ app, page }, { createdKey }: { createdKey: string }) => {
            return (() => {
              const cardWin = app.workspace
                .getLeavesOfType("zotero-annotation-view")
                .find(({ view }) =>
                  view.containerEl.querySelector<HTMLElement>(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
                  ),
                )?.view.containerEl.win;
              return (
                !!cardWin &&
                cardWin !==
                  app.workspace
                    .getLeavesOfType(page.reader.viewType)
                    .find(({ view }) =>
                      view.containerEl.querySelector<SVGGraphicsElement>(
                        `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
                      ),
                    )?.view.containerEl?.win
              );
            })();
          },
          { createdKey },
          {
            what: "the created annotation's card to open in a window apart from its PDF",
          },
        );
        await obRunUntil(
          vaultId!,
          async (
            { app, page: pageHelpers },
            { createdKey }: { createdKey: string },
          ) => {
            const { press } = pageHelpers;
            const card = app.workspace
              .getLeavesOfType("zotero-annotation-view")
              .map((leaf) =>
                leaf.view.containerEl.querySelector<HTMLElement>(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
                ),
              )
              .find(Boolean);
            if (!card) return false;
            press(card, "card");
            return card.hasAttribute("data-alone");
          },
          { createdKey },
          { what: "the created annotation's card to be selected alone" },
        );
        await obRunUntil(
          vaultId!,
          async (
            { app, page: pageHelpers },
            { createdKey }: { createdKey: string },
          ) => {
            const { press } = pageHelpers;
            const field = app.workspace
              .getLeavesOfType("zotero-annotation-view")
              .map((leaf) =>
                leaf.view.containerEl.querySelector<HTMLElement>(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
                ),
              )
              .find(Boolean)
              ?.querySelector<HTMLElement>(".zt-annot-comment-field");
            if (!field) return false;
            field.doc.getSelection()!.removeAllRanges();
            press(field, "comment field");
            return true;
          },
          { createdKey },
          {
            what: "the comment field on the created annotation's card to accept a click",
          },
        );
        await obRunUntil(
          vaultId!,
          async ({ app }, { createdKey }: { createdKey: string }) => {
            return !!app.workspace
              .getLeavesOfType("zotero-annotation-view")
              .map((leaf) =>
                leaf.view.containerEl.querySelector<HTMLElement>(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
                ),
              )
              .find(Boolean)
              ?.querySelector<HTMLElement>(".cm-content");
          },
          { createdKey },
          {
            what: "the comment editor on the created annotation's card to open",
          },
        );

        const shortcutComment = "Saved by pop-out card Mod+Enter";
        await obRun(
          vaultId!,
          async (
            { app },
            {
              createdKey,
              shortcutComment,
            }: {
              createdKey: string;
              shortcutComment: "Saved by pop-out card Mod+Enter";
            },
          ) => {
            const editor = app.workspace
              .getLeavesOfType("zotero-annotation-view")
              .map((leaf) =>
                leaf.view.containerEl.querySelector<HTMLElement>(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
                ),
              )
              .find(Boolean)!
              .querySelector<HTMLElement>(".cm-content");
            editor!.focus();
            editor!.doc.execCommand("selectAll");
            editor!.doc.execCommand("insertText", false, shortcutComment);
          },
          { createdKey, shortcutComment },
        );
        const shortcut = await obRun(
          vaultId!,
          async ({ app, page }, { createdKey }: { createdKey: string }) => {
            const editor = app.workspace
              .getLeavesOfType("zotero-annotation-view")
              .map((leaf) =>
                leaf.view.containerEl.querySelector<HTMLElement>(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
                ),
              )
              .find(Boolean)!
              .querySelector<HTMLElement>(".cm-content");
            const mac = editor!.win.navigator.platform.startsWith("Mac");
            const event = new (
              editor!.win as Window & typeof globalThis
            ).KeyboardEvent("keydown", {
              key: "Enter",
              metaKey: mac,
              ctrlKey: !mac,
              bubbles: true,
              cancelable: true,
            });
            editor!.dispatchEvent(event);
            return {
              prevented: event.defaultPrevented,
              open: editor!.isConnected,
              owned:
                editor!.win !==
                app.workspace
                  .getLeavesOfType(page.reader.viewType)
                  .find(({ view }) =>
                    view.containerEl.querySelector<SVGGraphicsElement>(
                      `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
                    ),
                  )!.view.containerEl.win,
            };
          },
          { createdKey },
        );
        expect(shortcut).toEqual({ prevented: true, open: true, owned: true });
        expect(
          await waitFor(
            async () =>
              (await readAnnotationState(api, serverID, createdKey)).comment ===
              shortcutComment,
          ),
        ).toBe(true);
        expect(
          await obRun(
            vaultId!,
            async ({ app }, { createdKey }: { createdKey: string }) => {
              return !!app.workspace
                .getLeavesOfType("zotero-annotation-view")
                .map((leaf) =>
                  leaf.view.containerEl.querySelector<HTMLElement>(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
                  ),
                )
                .find(Boolean)
                ?.querySelector<HTMLElement>(".cm-content");
            },
            { createdKey },
          ),
        ).toBe(true);

        const escapeComment = "Saved by pop-out card Escape";
        await obRun(
          vaultId!,
          async (
            { app },
            {
              createdKey,
              escapeComment,
            }: {
              createdKey: string;
              escapeComment: "Saved by pop-out card Escape";
            },
          ) => {
            const editor = app.workspace
              .getLeavesOfType("zotero-annotation-view")
              .map((leaf) =>
                leaf.view.containerEl.querySelector<HTMLElement>(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
                ),
              )
              .find(Boolean)!
              .querySelector<HTMLElement>(".cm-content");
            editor!.focus();
            editor!.doc.execCommand("selectAll");
            editor!.doc.execCommand("insertText", false, escapeComment);
            editor!.dispatchEvent(
              new (editor!.win as Window & typeof globalThis).KeyboardEvent(
                "keydown",
                { key: "Escape", bubbles: true, cancelable: true },
              ),
            );
          },
          { createdKey, escapeComment },
        );
        expect(
          await waitFor(
            async () =>
              (await readAnnotationState(api, serverID, createdKey)).comment ===
              escapeComment,
          ),
        ).toBe(true);
        expect(
          await obRun(
            vaultId!,
            async ({ app }, { createdKey }: { createdKey: string }) => {
              return !!app.workspace
                .getLeavesOfType("zotero-annotation-view")
                .map((leaf) =>
                  leaf.view.containerEl.querySelector<HTMLElement>(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
                  ),
                )
                .find(Boolean)
                ?.querySelector<HTMLElement>(".cm-content");
            },
            { createdKey },
          ),
        ).toBe(false);
        await obRun(
          vaultId!,
          async ({ app }) => {
            const leaf = app.workspace.getLeavesOfType(
              "zotero-annotation-view",
            )[0];
            leaf!.detach();
            app.commands.executeCommandById("zotlit:open-annot-view");
            app.commands.executeCommandById(
              "zotlit:annot-view-follow-active-tab",
            );
          },
          undefined,
        );
      }, 120000);

      it("carries a Zotero-side change back into Obsidian", async () => {
        const fromZotero = "Edited in Zotero";
        await rdp.json(`(async () => {
          const item = Zotero.Items.getByLibraryAndKey(
            Zotero.Libraries.userLibraryID,
            ${JSON.stringify(createdKey)},
          );
          item.annotationComment = ${JSON.stringify(fromZotero)};
          await item.saveTx();
          return "saved";
        })()`);

        await obRunUntil(
          vaultId!,
          async (
            { app, zotlit },
            {
              attachmentKey,
              createdKey,
              fromZotero,
            }: {
              attachmentKey: string;
              createdKey: string;
              fromZotero: "Edited in Zotero";
            },
          ) => {
            const { annotationRepository: repository, bridge } =
              zotlit.services;
            await bridge.runPromise(repository.read(attachmentKey));
            return app.workspace
              .getLeavesOfType("zotero-annotation-view")
              .map((leaf) =>
                leaf.view.containerEl.querySelector<HTMLElement>(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
                ),
              )
              .find(Boolean)
              ?.textContent.includes(fromZotero);
          },
          { attachmentKey: attachment.key, createdKey, fromZotero },
          {
            what: "the created annotation's card to show the text edited in Zotero",
          },
        );
      }, 120000);

      it("recovers an unchanged unavailable ink card through the actual Refresh gesture", async () => {
        await verifyExcerptRefresh(vaultId!);
      }, 120000);

      it("refreshes external comments by focus and manual action without the Companion", async () => {
        const liveUpdates =
          (await obRun(
            vaultId!,
            async ({ zotlit }) => {
              return String(
                zotlit.services.bridge.runSync(
                  zotlit.services.settings.current,
                )["server.live-update"],
              );
            },
            undefined,
          )) === "true";
        await using restoreLiveUpdates = new AsyncDisposableStack();
        restoreLiveUpdates.defer(async () => {
          await obRun(
            vaultId!,
            async ({ zotlit }, { liveUpdates }: { liveUpdates: boolean }) => {
              zotlit.services.bridge.runSync(
                zotlit.services.settings.update({
                  "server.live-update": liveUpdates,
                }),
              );
            },
            { liveUpdates },
          );
        });
        await obRun(
          vaultId!,
          async ({ zotlit }) => {
            zotlit.services.bridge.runSync(
              zotlit.services.settings.update({ "server.live-update": false }),
            );
          },
          undefined,
        );

        const saveInZotero = (comment: string) =>
          rdp.json(`(async () => {
            const item = Zotero.Items.getByLibraryAndKey(
              Zotero.Libraries.userLibraryID,
              ${JSON.stringify(createdKey)},
            );
            item.annotationComment = ${JSON.stringify(comment)};
            await item.saveTx();
            return "saved";
          })()`);
        const cardHas = (comment: string) =>
          obRunUntil(
            vaultId!,
            async (
              { app },
              { createdKey, comment }: { createdKey: string; comment: string },
            ) => {
              return app.workspace
                .getLeavesOfType("zotero-annotation-view")
                .map((leaf) =>
                  leaf.view.containerEl.querySelector<HTMLElement>(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
                  ),
                )
                .find(Boolean)
                ?.textContent.includes(comment);
            },
            { createdKey, comment },
            {
              what: "the created annotation's card to show the external comment",
            },
          );

        const focused = "Changed while Companion disabled";
        await saveInZotero(focused);
        await obRun(
          vaultId!,
          async (_context) => {
            window.dispatchEvent(new FocusEvent("focus"));
          },
          undefined,
        );
        await cardHas(focused);

        const manual = "Changed before manual Refresh";
        await saveInZotero(manual);
        await obRun(
          vaultId!,
          async ({ app }) => {
            (
              app.workspace.getLeavesOfType("zotero-annotation-view")[0]!
                .view as AnnotationView
            ).gestures!.onRefresh();
          },
          undefined,
        );
        await cardHas(manual);
      }, 120000);

      it("keeps confirmed surfaces after a committed write loses its response and reread", async () => {
        const before = await annotationState(api, serverID, createdKey);
        const committed = "#e56b6f";
        await installLostWriteProbe(vaultId!);

        const state = await obRun(
          vaultId!,
          async (
            { zotlit },
            {
              createdKey,
              committed,
            }: { createdKey: string; committed: "#e56b6f" },
          ) => {
            const state = await zotlit.services.bridge.runPromise(
              zotlit.services.annotationRepository.patchColor(
                createdKey,
                committed,
              ),
            );
            return state.kind === "failed"
              ? { kind: state.kind, failure: { kind: state.failure.kind } }
              : { kind: state.kind };
          },
          { createdKey, committed },
        );
        expect(state).toEqual({
          kind: "failed",
          failure: { kind: "unknown-outcome" },
        });
        const stored = await annotationState(api, serverID, createdKey);
        expect(stored).toMatchObject({ color: committed });
        expect(stored.version).toBeGreaterThan(before.version);
        expect(await writeOutcomeCalls(vaultId!)).toBe(1);

        expect(await visibleAnnotationColors(vaultId!, createdKey)).toEqual({
          card: before.color,
          mark: before.color,
        });

        await restoreWriteOutcomeProbe(vaultId!);
        await cli([`vault=${vaultId!}`, "plugin:reload", "id=zotlit"]);
        await obRunUntil(
          vaultId!,
          async (
            { app, zotlit },
            {
              attachmentKey,
              createdKey,
            }: { attachmentKey: string; createdKey: string },
          ) => {
            const services = app.plugins.plugins.zotlit
              ? zotlit.services
              : undefined;
            if (!services) return "loading";
            await services.bridge.runPromise(
              services.annotationRepository.probe,
            );
            const list = await services.bridge.runPromise(
              services.annotationRepository.read(attachmentKey),
            );
            return list?.annotations.find(
              (annotation) => annotation.key === createdKey,
            )?.color;
          },
          { attachmentKey: attachment.key, createdKey },
          {
            ready: (value) => value === committed,
            what: "the created annotation's stored color to read back as committed",
          },
        );
        await obRunUntil(
          vaultId!,
          async ({ app, page }, { createdKey }: { createdKey: string }) => {
            return (() => {
              const card = app.workspace
                .getLeavesOfType("zotero-annotation-view")
                .map((leaf) =>
                  leaf.view.containerEl.querySelector<HTMLElement>(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
                  ),
                )
                .find(Boolean);
              const mark = app.workspace
                .getLeavesOfType(page.reader.viewType)
                .map((leaf) =>
                  leaf.view.containerEl.querySelector<SVGGraphicsElement>(
                    `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(createdKey)}]`,
                  ),
                )
                .find(Boolean);
              return {
                card: card?.getAttribute("data-annot-color") ?? null,
                mark: mark?.getAttribute("fill") ?? null,
              };
            })();
          },
          { createdKey },
          {
            ready: (value) =>
              isDeepStrictEqual(value, { card: committed, mark: committed }),
            what: "the card and PDF mark colors to match the committed color",
          },
        );
        expect(await annotationState(api, serverID, createdKey)).toEqual(
          stored,
        );
      }, 120000);

      for (const pending of ["unsent draft", "in-flight write"] as const) {
        it(`reloads with an ${pending} and reads Zotero without replay`, async () => {
          const baseline = await readAnnotationState(api, serverID, createdKey);
          const before = await annotationState(api, serverID, createdKey);
          const color = "#a28ae5";
          if (pending === "in-flight write") {
            await installClosingPaneProbe(vaultId!, createdKey, color);
          }
          await expect
            .poll(
              () =>
                obRun(
                  vaultId!,
                  async ({ page: pageHelpers }) => {
                    return {
                      reached:
                        pageHelpers.scratch.__zotlitWriteOutcomeProbe?.reached,
                      outcome:
                        pageHelpers.scratch.__zotlitWriteOutcomeProbe?.outcome,
                    };
                  },
                  undefined,
                ),
              { timeout: 10_000 },
            )
            .toEqual(
              pending === "in-flight write"
                ? { reached: true, outcome: null }
                : {},
            );
          const stored = await annotationState(api, serverID, createdKey);
          expect(stored.color).toBe(
            pending === "in-flight write" ? color : before.color,
          );

          const unloading = await obRun(
            vaultId!,
            (
              { app, zotlit, page: pageHelpers },
              { pending, createdKey }: { pending: string; createdKey: string },
            ) => {
              const { annotationRepository: repository, bridge } =
                zotlit.services;
              let draft: string | null = null;
              let timers = 0;
              if (pending === "unsent draft") {
                const pageWindow = window as Window;
                const schedule = pageWindow.setTimeout.bind(pageWindow);
                pageWindow.setTimeout = (
                  ...args: Parameters<Window["setTimeout"]>
                ) => {
                  timers++;
                  return schedule.apply(pageWindow, args);
                };
                try {
                  draft =
                    bridge.runSync(
                      repository.editTextField(
                        "comment",
                        createdKey,
                        "Unsent comment discarded on reload",
                      ),
                    )?.text ?? null;
                } finally {
                  pageWindow.setTimeout = schedule;
                }
              }
              const probe = pageHelpers.scratch.__zotlitWriteOutcomeProbe;
              const calls = probe?.calls ?? 0;
              const outcome = probe?.outcome ?? null;
              const lifecycle: {
                disabled: boolean;
                enabled: boolean;
                error: string | null;
              } = { disabled: false, enabled: false, error: null };
              pageHelpers.scratch.__zotlitReloadProbe = lifecycle;
              void (async () => {
                try {
                  await app.plugins.disablePlugin("zotlit");
                  lifecycle.disabled = !app.plugins.plugins.zotlit;
                  await app.plugins.enablePlugin("zotlit");
                  lifecycle.enabled = !!app.plugins.plugins.zotlit;
                } catch (error) {
                  lifecycle.error = String(error);
                }
              })();
              return { draft, timers, calls, outcome };
            },
            { pending, createdKey },
          );
          expect(unloading).toEqual(
            pending === "unsent draft"
              ? {
                  draft: "Unsent comment discarded on reload",
                  timers: 2,
                  calls: 0,
                  outcome: null,
                }
              : { draft: null, timers: 0, calls: 1, outcome: null },
          );
          await obRunUntil(
            vaultId!,
            async ({ page: pageHelpers }) => {
              return pageHelpers.scratch.__zotlitReloadProbe;
            },
            undefined,
            {
              ready: (value) =>
                isDeepStrictEqual(value, {
                  disabled: true,
                  enabled: true,
                  error: null,
                }),
              what: "the reload probe to record a clean disable and re-enable",
            },
          );

          await obRunUntil(
            vaultId!,
            async (
              { zotlit },
              {
                attachmentKey,
                createdKey,
              }: { attachmentKey: string; createdKey: string },
            ) => {
              const { annotationRepository: repository, bridge } =
                zotlit.services;
              await bridge.runPromise(repository.probe);
              const list = await bridge.runPromise(
                repository.read(attachmentKey),
              );
              const record = list?.annotations.find(
                (annotation) => annotation.key === createdKey,
              );
              return JSON.stringify({
                color: record?.color,
                comment: record?.comment,
                draft: bridge.runSync(
                  repository.textDraftFor("comment", createdKey),
                ),
                mutation: bridge.runSync(repository.mutationFor(createdKey)),
              });
            },
            { attachmentKey: attachment.key, createdKey },
            {
              ready: (value) =>
                value ===
                JSON.stringify({
                  color: stored.color,
                  comment: baseline.comment,
                  draft: null,
                  mutation: { kind: "idle" },
                }),
              what: "the stored annotation to match its baseline with no draft or write",
            },
          );
          await obRun(
            vaultId!,
            async ({ page: pageHelpers }) => {
              const probe = pageHelpers.scratch.__zotlitWriteOutcomeProbe;
              if (!probe?.pending) return;
              probe.pending = probe.pending.then(
                () => {
                  throw new Error("The old plugin's write outlived its unload");
                },
                (error: unknown) => {
                  if (
                    (error as { name?: unknown } | null)?.name !== "AbortError"
                  )
                    throw error;
                },
              );
            },
            undefined,
          );
          await restoreWriteOutcomeProbe(vaultId!);
          await obRun(
            vaultId!,
            async ({ page: pageHelpers }) => {
              delete pageHelpers.scratch.__zotlitReloadProbe;
            },
            undefined,
          );
          expect(
            await obRun(
              vaultId!,
              async ({ zotlit }, { createdKey }: { createdKey: string }) => {
                return (() => {
                  const { annotationRepository: repository, bridge } =
                    zotlit.services;
                  const draft = bridge.runSync(
                    repository.textDraftFor("comment", createdKey),
                  );
                  return {
                    draft: draft
                      ? { text: draft.text, state: { kind: draft.state.kind } }
                      : null,
                    mutation: {
                      kind: bridge.runSync(repository.mutationFor(createdKey))
                        .kind,
                    },
                  };
                })();
              },
              { createdKey },
            ),
          ).toEqual({ draft: null, mutation: { kind: "idle" } });
          expect(await annotationState(api, serverID, createdKey)).toEqual(
            stored,
          );
          expect(await readAnnotationState(api, serverID, createdKey)).toEqual({
            ...baseline,
            version: stored.version,
          });
          console.info("Pending-work reload evidence", {
            pending,
            unloading,
            stored,
          });
        }, 120000);
      }

      it("finishes a repository write after both panes close", async () => {
        const committed = "#2ea8e5";
        const savedLayout = await obRun(
          vaultId!,
          async ({ app }) => {
            return JSON.stringify(app.workspace.getLayout());
          },
          undefined,
        );
        try {
          await installClosingPaneProbe(vaultId!, createdKey, committed);
          const state = () =>
            obRun(
              vaultId!,
              async ({ page: pageHelpers }) => {
                return {
                  reached:
                    pageHelpers.scratch.__zotlitWriteOutcomeProbe?.reached,
                  outcome:
                    pageHelpers.scratch.__zotlitWriteOutcomeProbe?.outcome,
                };
              },
              undefined,
            );
          await expect
            .poll(state, { timeout: 10_000 })
            .toEqual({ reached: true, outcome: null });

          await obRun(
            vaultId!,
            async ({ app, page: pageHelpers }) => {
              app.workspace
                .getLeavesOfType(pageHelpers.reader.viewType)
                .forEach((leaf) => leaf.detach());
              app.workspace.detachLeavesOfType("zotero-annotation-view");
              pageHelpers.scratch.__zotlitWriteOutcomeProbe!.release!();
            },
            undefined,
          );
          await expect
            .poll(state, { timeout: 10_000 })
            .toMatchObject({ outcome: { kind: "idle" } });
          expect(await writeOutcomeCalls(vaultId!)).toBe(1);
          expect(await annotationColor(api, serverID, createdKey)).toBe(
            committed,
          );
        } finally {
          await restoreWriteOutcomeProbe(vaultId!);
          await obRun(
            vaultId!,
            async ({ app }, { savedLayout }: { savedLayout: string }) => {
              await app.workspace.changeLayout(JSON.parse(savedLayout));
            },
            { savedLayout },
          );
        }
      }, 120000);

      it("degrades to the Zotero database when the Local API is turned off, and recovers", async () => {
        await using restoreLocalApi = new AsyncDisposableStack();
        restoreLocalApi.defer(async () => {
          await setLocalApi(rdp, true);
        });
        const retained = await annotationColor(api, serverID, createdKey);
        expect(retained).not.toBeNull();
        await obRun(
          vaultId!,
          async (
            { app, zotlit, page },
            { attachmentPath }: { attachmentPath: string },
          ) => {
            const file = app.vault.getFileByPath(attachmentPath);
            const s = zotlit.services;
            if (!app.workspace.getLeavesOfType(page.reader.viewType).length)
              await s.bridge.runPromise(s.pdfReader.open(file!, "", "tab"));
            app.commands.executeCommandById("zotlit:open-annot-view");
            app.commands.executeCommandById(
              "zotlit:annot-view-follow-active-tab",
            );
          },
          { attachmentPath },
        );
        expect(
          await waitFor(async () => {
            const visible = await visibleAnnotationColors(vaultId!, createdKey);
            return visible.card === retained && visible.mark === retained;
          }),
        ).toBe(true);

        await setLocalApi(rdp, false);
        await obRunUntil(
          vaultId!,
          async ({ zotlit }, { attachmentKey }: { attachmentKey: string }) => {
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
            what: "the Annotation Source capability reason to read local-api-disabled",
          },
        );
        await obRunUntil(
          vaultId!,
          async ({ zotlit }, { attachmentKey }: { attachmentKey: string }) => {
            const list = await zotlit.services.bridge.runPromise(
              zotlit.services.annotationRepository.read(attachmentKey),
            );
            return list?.source.kind;
          },
          { attachmentKey: attachment.key },
          {
            ready: (value) => value === "zotero-db",
            what: "the annotation list source to fall back to the Zotero database",
          },
        );
        expect(await visibleAnnotationColors(vaultId!, createdKey)).toEqual({
          card: retained,
          mark: retained,
        });

        await setLocalApi(rdp, true);
        await obRunUntil(
          vaultId!,
          async ({ zotlit }, { attachmentKey }: { attachmentKey: string }) => {
            const { annotationRepository: repository, bridge } =
              zotlit.services;
            await bridge.runPromise(repository.probe);
            return bridge.runSync(repository.capabilityFor(attachmentKey)).kind;
          },
          { attachmentKey: attachment.key },
          {
            ready: (value) => value === "writable",
            what: "the annotation capability to become writable again",
          },
        );
        await obRunUntil(
          vaultId!,
          async ({ zotlit }, { attachmentKey }: { attachmentKey: string }) => {
            const list = await zotlit.services.bridge.runPromise(
              zotlit.services.annotationRepository.read(attachmentKey),
            );
            return list?.source.kind;
          },
          { attachmentKey: attachment.key },
          {
            ready: (value) => value === "zotero-local-api",
            what: "the annotation list source to return to the Zotero Local API",
          },
        );
        expect(await visibleAnnotationColors(vaultId!, createdKey)).toEqual({
          card: retained,
          mark: retained,
        });
      }, 120000);

      it("updates one managed note to a new immutable excerpt version", async () => {
        const { vaultPath } = environment!;
        const legacySource = join(
          environment!.layout.dataDir,
          "cache",
          "library",
          "FDRFQ7C2.png",
        );
        const notePaths = await obRun(
          vaultId!,
          async ({ app, zotlit }) => {
            const services = zotlit.services;
            await services.bridge.runPromise(services.noteIndex.whenIndexed);
            const literature = services.bridge.runSync(
              services.noteIndex.getNotesByItemKey("RUGIER24"),
            )[0];
            const imported = services.bridge.runSync(
              services.noteIndex.getImportedNoteByNoteKey("NNNNAAAA"),
            )[0];
            if (!literature || !imported)
              throw new Error("Managed acceptance notes missing");
            return {
              literature: literature.path,
              imported: imported.path,
              live: services.bridge.runSync(services.settings.current)[
                "note.default-profile"
              ].bindings["note.import-annotations-as-template"],
              assets: app.vault
                .getFiles()
                .filter((file) => file.name.startsWith("zotlit-excerpt-"))
                .map((file) => file.path),
            };
          },
          undefined,
        );
        const originalLiterature = await readFile(
          join(vaultPath, notePaths.literature),
          "utf8",
        );
        const originalImported = await readFile(
          join(vaultPath, notePaths.imported),
          "utf8",
        );
        const originalInk = await obRun(
          vaultId!,
          async ({ zotlit }) => {
            const list = await zotlit.services.bridge.runPromise(
              zotlit.services.annotationRepository.read("RGRPDF24"),
            );
            const annotation = list?.annotations.find(
              (value) => value.key === "TYY6Z6ZF",
            );
            if (!annotation) throw new Error("Ink annotation missing");
            return { color: annotation.color };
          },
          undefined,
        );
        await using restore = new AsyncDisposableStack();
        restore.defer(async () => {
          await obRun(
            vaultId!,
            async (
              { app, zotlit },
              {
                color,
                live,
                literaturePath,
                importedPath,
                originalLiterature,
                originalImported,
                assets,
              }: {
                color: string | null;
                live: boolean;
                literaturePath: string;
                importedPath: string;
                originalLiterature: string;
                originalImported: string;
                assets: string[];
              },
            ) => {
              const services = zotlit.services;
              await services.bridge.runPromise(
                services.annotationRepository.patchColor("TYY6Z6ZF", color!),
              );
              await services.bridge.runPromise(services.zoteroReads.refresh);
              services.bridge.runSync(
                services.settings.update((current) => ({
                  "note.default-profile": {
                    ...current["note.default-profile"],
                    bindings: {
                      ...current["note.default-profile"].bindings,
                      "note.import-annotations-as-template": live,
                    },
                  },
                })),
              );
              const literature = app.vault.getFileByPath(literaturePath);
              const imported = app.vault.getFileByPath(importedPath);
              if (literature)
                await app.vault.modify(literature, originalLiterature);
              if (imported) await app.vault.modify(imported, originalImported);
              const keep = new Set(assets);
              for (const file of app.vault
                .getFiles()
                .filter((file) => file.name.startsWith("zotlit-excerpt-")))
                if (!keep.has(file.path)) await app.vault.delete(file);
            },
            {
              color: originalInk.color,
              live: notePaths.live,
              literaturePath: notePaths.literature,
              importedPath: notePaths.imported,
              originalLiterature,
              originalImported,
              assets: notePaths.assets,
            },
          );
          expect(
            await waitFor(
              async () =>
                (await annotationColor(api, serverID, "TYY6Z6ZF")) ===
                originalInk.color,
            ),
          ).toBe(true);
        });

        const prepared = await obRun(
          vaultId!,
          async (
            { app, zotlit },
            {
              literaturePath,
              importedPath,
              legacySource,
              legacyEmbedPrefix,
              legacyEmbedSuffix,
            }: {
              literaturePath: string;
              importedPath: string;
              legacySource: string;
              legacyEmbedPrefix: "\n\n![Legacy excerpt](";
              legacyEmbedSuffix: ")\n";
            },
          ) => {
            const services = zotlit.services;
            services.bridge.runSync(
              services.settings.update((current) => ({
                "note.default-profile": {
                  ...current["note.default-profile"],
                  bindings: {
                    ...current["note.default-profile"].bindings,
                    "note.import-annotations-as-template": true,
                  },
                },
              })),
            );
            const literature = app.vault.getFileByPath(literaturePath);
            const imported = app.vault.getFileByPath(importedPath);
            if (!literature || !imported)
              throw new Error("Managed acceptance notes missing");
            const legacyUrl = require("url").pathToFileURL(legacySource).href;
            await app.vault.modify(
              literature,
              (await app.vault.read(literature)) +
                legacyEmbedPrefix +
                legacyUrl +
                legacyEmbedSuffix,
            );
            const literatureResult = await services.noteFeature.updateNote(
              literature,
              { indexedKey: "RUGIER24", scope: "full" },
            );
            const importedResult = await services.batchImport.reimportNoteByKey(
              "NNNNAAAA",
              imported,
            );
            return {
              legacyUrl,
              literature: { diagnostic: literatureResult.diagnostic ?? null },
              imported: importedResult,
            };
          },
          {
            literaturePath: notePaths.literature,
            importedPath: notePaths.imported,
            legacySource,
            legacyEmbedPrefix: "\n\n![Legacy excerpt](",
            legacyEmbedSuffix: ")\n",
          },
        );
        expect(prepared.literature).toEqual({ diagnostic: null });
        expect(prepared.imported).toEqual({ outcome: "overwritten" });

        const literatureBefore = await readFile(
          join(vaultPath, notePaths.literature),
          "utf8",
        );
        const importedBefore = await readFile(
          join(vaultPath, notePaths.imported),
          "utf8",
        );
        expect(literatureBefore).toContain(prepared.legacyUrl);
        expect(importedBefore).toContain("zotlit-excerpt-");
        const excerptTargets = (markdown: string) =>
          markdown
            .split("![[")
            .slice(1)
            .map((part) => part.split("]]", 1)[0]!)
            .filter((target) => target.includes("zotlit-excerpt-"));
        const beforeTargets = excerptTargets(importedBefore);
        expect(beforeTargets).toHaveLength(2);
        const beforeBytes = new Map(
          await Promise.all(
            beforeTargets.map(
              async (target) =>
                [target, await readFile(join(vaultPath, target))] as const,
            ),
          ),
        );
        const legacyBytes = await readFile(legacySource);

        const changedColor = "#d12f2f";
        expect(
          await obRun(
            vaultId!,
            async (
              { zotlit },
              { changedColor }: { changedColor: "#d12f2f" },
            ) => {
              const outcome = await zotlit.services.bridge.runPromise(
                zotlit.services.annotationRepository.patchColor(
                  "TYY6Z6ZF",
                  changedColor,
                ),
              );
              return { kind: outcome.kind };
            },
            { changedColor },
          ),
        ).toMatchObject({ kind: "idle" });
        expect(
          await waitFor(
            async () =>
              (await annotationColor(api, serverID, "TYY6Z6ZF")) ===
              changedColor,
          ),
        ).toBe(true);
        await obRun(
          vaultId!,
          async ({ zotlit }) => {
            await zotlit.services.bridge.runPromise(
              zotlit.services.zoteroReads.refresh,
            );
          },
          undefined,
        );
        expect(
          await obRun(
            vaultId!,
            async ({ app, zotlit }, { imported }: { imported: string }) => {
              const services = zotlit.services;
              const file = app.vault.getFileByPath(imported);
              if (!file) throw new Error("Imported Note missing");
              return await services.batchImport.reimportNoteByKey(
                "NNNNAAAA",
                file,
              );
            },
            { imported: notePaths.imported },
          ),
        ).toEqual({ outcome: "overwritten" });

        const literatureAfter = await readFile(
          join(vaultPath, notePaths.literature),
          "utf8",
        );
        const importedAfter = await readFile(
          join(vaultPath, notePaths.imported),
          "utf8",
        );
        expect(literatureAfter).toBe(literatureBefore);
        expect(literatureAfter).toContain(prepared.legacyUrl);
        expect(await readFile(legacySource)).toEqual(legacyBytes);
        const afterTargets = excerptTargets(importedAfter);
        const retired = beforeTargets.filter(
          (target) => !afterTargets.includes(target),
        );
        const created = afterTargets.filter(
          (target) => !beforeTargets.includes(target),
        );
        expect(retired).toHaveLength(1);
        expect(created).toHaveLength(1);
        expect(await readFile(join(vaultPath, created[0]!))).not.toEqual(
          beforeBytes.get(retired[0]!),
        );
        for (const [target, bytes] of beforeBytes)
          expect(await readFile(join(vaultPath, target))).toEqual(bytes);
      }, 120000);

      const noticeShows = (title: string) =>
        obRunUntil(
          vaultId!,
          async (_context, { title }: { title: string }) => {
            return [
              ...document.querySelectorAll<HTMLElement>(
                ".notice .notice-message",
              ),
            ].some((node) => node.textContent.split("\n")[0] === title);
          },
          { title },
          { what: `the notice "${title}" to appear` },
        );

      const answerEditingConfirmation = (confirm: boolean) => {
        const title = m.modal_zotero_editing_confirm_title();
        const action = confirm ? m.modal_zotero_editing_confirm_action() : null;
        return obRunUntil(
          vaultId!,
          ({ page }, { title, action }) => {
            const modal = [
              ...activeDocument.querySelectorAll(".modal-container .modal"),
            ].find(
              (el) => el.querySelector(".modal-title")?.textContent === title,
            );
            if (!modal) return false;
            if (action === null) {
              modal.ownerDocument.body.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "Escape",
                  bubbles: true,
                  cancelable: true,
                }),
              );
              return true;
            }
            const button = [
              ...modal.querySelectorAll<HTMLButtonElement>("button"),
            ].find((el) => el.textContent.trim() === action);
            page.press(button, action);
            return true;
          },
          { title, action },
          { what: `the "${title}" modal to accept a press` },
        );
      };

      it("Allow leaves ZotLit read-only, and says so", async () => {
        const notAllowed =
          "To edit annotations, choose Always Allow in Zotero.";

        await using restore = new AsyncDisposableStack();
        const popout = await obRun(
          vaultId!,
          async ({ app }) => {
            return app.vault.getConfig("settingsPopoutWindow") ?? null;
          },
          undefined,
        );
        restore.defer(async () => {
          await obRun(
            vaultId!,
            async ({ app }, { popoutEnabled }: { popoutEnabled: boolean }) => {
              app.setting.close();
              app.vault.setConfig("settingsPopoutWindow", popoutEnabled);
            },
            { popoutEnabled: popout },
          );
        });

        await resetAuthorizations(rdp);
        await obRun(
          vaultId!,
          async ({ zotlit }) => {
            await zotlit.services.bridge.runPromise(
              zotlit.services.zoteroLocalApi.forgetAuthorization,
            );
            for (const node of document.querySelectorAll<HTMLElement>(
              ".notice",
            ))
              node.remove();
          },
          undefined,
        );
        await stubPrompt(rdp, { allow: true, remember: false });
        await obRunUntil(
          vaultId!,
          async ({ zotlit }, { attachmentKey }: { attachmentKey: string }) => {
            const { annotationRepository: repository, bridge } =
              zotlit.services;
            await bridge.runPromise(repository.probe);
            return bridge.runSync(repository.capabilityFor(attachmentKey)).kind;
          },
          { attachmentKey: attachment.key },
          {
            ready: (value) => value === "authorization-required",
            what: "the annotation capability to require authorization",
          },
        );

        await obRun(
          vaultId!,
          async ({ app, zotlit }) => {
            app.vault.setConfig("settingsPopoutWindow", false);
            await zotlit.services.capabilityNotices.showEditingCapability();
          },
          undefined,
        );
        await obRunUntil(
          vaultId!,
          async ({ app, page: pageHelpers }) => {
            const { press } = pageHelpers;
            const row = [
              ...app.setting.containerEl.querySelectorAll<HTMLElement>(
                ".setting-item",
              ),
            ].find(
              (el) =>
                el.querySelector<HTMLElement>(".setting-item-name")
                  ?.textContent === "Zotero editing",
            );
            const button =
              row &&
              [...row.querySelectorAll<HTMLButtonElement>("button")].find(
                (el) => el.textContent.trim() === "Allow editing",
              );
            if (!button || button.disabled || button.style.display === "none")
              return false;
            press(button, "Allow editing");
            return true;
          },
          undefined,
          {
            what: "the Allow editing button in the Zotero editing setting to be clicked",
          },
        );

        await noticeShows(notAllowed);
        expect(
          await obRun(
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
          ),
        ).toBe("authorization-required");
        expect(
          await obRun(
            vaultId!,
            async ({ app }) => {
              return !!JSON.parse(
                app.secretStorage.getSecret(
                  "zotlit-zotero-write-authorization",
                ) ?? "{}",
              ).key;
            },
            undefined,
          ),
        ).toBe(false);
        expect(await authorizationCount(rdp)).toBe(0);

        await stubPrompt(rdp, { allow: true, remember: true });
        expect(
          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                notAllowed,
              }: {
                notAllowed: "To edit annotations, choose Always Allow in Zotero.";
              },
            ) => {
              const { press } = pageHelpers;
              const notice = [
                ...document.querySelectorAll<HTMLElement>(".notice"),
              ].find((node) => node.textContent.includes(notAllowed));
              const button =
                notice &&
                [...notice.querySelectorAll<HTMLElement>(".notice-cta")].find(
                  (el) => el.textContent.trim() === "Allow editing",
                );
              if (!button) return "false";
              press(button, "Allow editing");
              return "true";
            },
            { notAllowed },
          ),
        ).toBe("true");

        await answerEditingConfirmation(true);
        await noticeShows("Zotero editing is enabled.");
        expect(
          await obRun(
            vaultId!,
            async ({ page: pageHelpers }) => {
              using cleanup = new DisposableStack();
              const notice = pageHelpers
                .windowDocuments()
                .flatMap((doc) => [
                  ...doc.querySelectorAll<HTMLElement>(".notice"),
                ])
                .find((node) =>
                  node.textContent.includes("Zotero editing is enabled."),
                );
              if (!notice) throw new Error("Editing success notice is missing");
              const dismissed = Promise.withResolvers();
              const observer = cleanup.adopt(
                new notice.ownerDocument.defaultView!.MutationObserver(() => {
                  if (!notice.isConnected) dismissed.resolve("dismissed");
                }),
                (value) => value.disconnect(),
              );
              observer.observe(notice.ownerDocument.body, {
                childList: true,
                subtree: true,
              });
              cleanup.adopt(
                setTimeout(
                  () =>
                    dismissed.reject(
                      new Error(
                        "Editing success notice still covers the view after five seconds",
                      ),
                    ),
                  Temporal.Duration.from({ seconds: 5 }).total("milliseconds"),
                ),
                clearTimeout,
              );
              return String(await dismissed.promise);
            },
            undefined,
          ),
        ).toBe("dismissed");
        await obRunUntil(
          vaultId!,
          async ({ zotlit }, { attachmentKey }: { attachmentKey: string }) => {
            const { annotationRepository: repository, bridge } =
              zotlit.services;
            await bridge.runPromise(repository.probe);
            return bridge.runSync(repository.capabilityFor(attachmentKey)).kind;
          },
          { attachmentKey: attachment.key },
          {
            ready: (value) => value === "writable",
            what: "the annotation capability to be writable after allowing editing",
          },
        );
        expect(
          await obRun(
            vaultId!,
            async ({ app }) => {
              return !!JSON.parse(
                app.secretStorage.getSecret(
                  "zotlit-zotero-write-authorization",
                ) ?? "{}",
              ).key;
            },
            undefined,
          ),
        ).toBe(true);
      }, 120000);

      it("a dismissed Zotero dialog leaves ZotLit read-only until the researcher confirms in ZotLit", async () => {
        const title = m.modal_zotero_editing_confirm_title();
        await using restore = new AsyncDisposableStack();
        restore.defer(async () => {
          await obRun(
            vaultId!,
            ({ page }, { title }) => {
              for (const doc of page.windowDocuments()) {
                const modal = [
                  ...doc.querySelectorAll(".modal-container .modal"),
                ].find(
                  (el) =>
                    el.querySelector(".modal-title")?.textContent === title,
                );
                if (modal)
                  doc.body.dispatchEvent(
                    new KeyboardEvent("keydown", {
                      key: "Escape",
                      bubbles: true,
                      cancelable: true,
                    }),
                  );
              }
            },
            { title },
          );
        });
        restore.defer(async () => {
          await denyAnyAuthorizationDialog(rdp);
        });

        const forget = () =>
          obRun(vaultId!, async ({ zotlit }) => {
            const { bridge, zoteroLocalApi } = zotlit.services;
            await bridge.runPromise(zoteroLocalApi.forgetAuthorization);
          });
        const ask = () =>
          obRun(vaultId!, ({ zotlit }) => {
            void zotlit.services.capabilityNotices.allowEditing();
          });
        const expectEditing = async (
          kind: "authorization-required" | "writable",
        ) => {
          const state = await obRunUntil(
            vaultId!,
            async ({ app, zotlit }, { attachmentKey, title }) => {
              const { annotationRepository: repository, bridge } =
                zotlit.services;
              await bridge.runPromise(repository.probe);
              const capability = bridge.runSync(
                repository.capabilityFor(attachmentKey),
              );
              const record = JSON.parse(
                app.secretStorage.getSecret(
                  "zotlit-zotero-write-authorization",
                ) ?? "{}",
              );
              const confirmationOpen = [
                ...activeDocument.querySelectorAll(
                  ".modal-container .modal-title",
                ),
              ].some((el) => el.textContent === title);
              return {
                kind: capability.kind,
                hasKey: Object.hasOwn(record, "key"),
                confirmationOpen,
              };
            },
            { attachmentKey: attachment.key, title },
            {
              ready: (state) => state.kind === kind,
              what: `the annotation capability to be ${kind}`,
            },
          );
          expect(state).toEqual({
            kind,
            hasKey: kind === "writable",
            confirmationOpen: false,
          });
        };

        await restorePrompt(rdp);
        await resetAuthorizations(rdp);
        await forget();
        await clearNotices(vaultId!);
        await expectEditing("authorization-required");

        const earlierKey = await grantRememberedKey(api, rdp, {
          serverID,
          appName: APP_NAME,
        });
        await obRun(
          vaultId!,
          ({ app }, { serverID, key }) => {
            app.secretStorage.setSecret(
              "zotlit-zotero-write-authorization",
              JSON.stringify({ version: 1, serverID, key }),
            );
          },
          { serverID, key: earlierKey },
        );
        const earlierGrant = () =>
          obRun(
            vaultId!,
            async ({ app, zotlit }, { attachmentKey }) => {
              const { annotationRepository: repository, bridge } =
                zotlit.services;
              await bridge.runPromise(repository.probe);
              const record = JSON.parse(
                app.secretStorage.getSecret(
                  "zotlit-zotero-write-authorization",
                ) ?? "{}",
              );
              return {
                kind: bridge.runSync(repository.capabilityFor(attachmentKey))
                  .kind,
                hasKey: Object.hasOwn(record, "key"),
                confirmed: record.confirmed === true,
              };
            },
            { attachmentKey: attachment.key },
          );
        expect(await earlierGrant()).toEqual({
          kind: "authorization-required",
          hasKey: true,
          confirmed: false,
        });
        await ask();
        await answerEditingConfirmation(false);
        expect(await earlierGrant()).toEqual({
          kind: "authorization-required",
          hasKey: true,
          confirmed: false,
        });
        await ask();
        await answerEditingConfirmation(true);
        await noticeShows(m.notice_zotero_editing_enabled());
        expect(await earlierGrant()).toEqual({
          kind: "writable",
          hasKey: true,
          confirmed: true,
        });
        expect(await waitForAuthorizationDialog(rdp, 4)).toBe(false);
        expect(await authorizationCount(rdp)).toBe(1);

        await resetAuthorizations(rdp);
        await forget();
        await clearNotices(vaultId!);
        await expectEditing("authorization-required");

        await ask();
        expect(await waitForAuthorizationDialog(rdp)).toBe(true);
        await dismissAuthorizationDialog(rdp);
        await answerEditingConfirmation(false);
        await expectEditing("authorization-required");
        expect(await authorizationCount(rdp)).toBe(1);

        await reloadWindow(vaultId!);
        await expectEditing("authorization-required");

        await ask();
        expect(await waitForAuthorizationDialog(rdp)).toBe(true);
        await clickAuthorizationDialog(rdp, "cancel");
        await answerEditingConfirmation(true);
        await noticeShows(m.notice_zotero_editing_enabled());
        await expectEditing("writable");

        await reloadWindow(vaultId!);
        await expectEditing("writable");
        expect(await waitForAuthorizationDialog(rdp, 4)).toBe(false);

        await forget();
        await resetAuthorizations(rdp);
        await ask();
        expect(await waitForAuthorizationDialog(rdp)).toBe(true);
        await clickAuthorizationDialog(rdp, "extra1");
        await expectEditing("authorization-required");
      }, 120000);

      registerPdfUnchangedCase();
    },
  );
});

async function annotationState(
  api: string,
  serverID: string,
  key: string,
): Promise<{ version: number; color: string | null }> {
  const reply = await zoteroFetch(api, `users/0/items/${key}`, {
    headers: { "Zotero-Server-ID": serverID },
  });
  expect(reply.status).toBe(200);
  const record = (await reply.json()) as {
    version: number;
    data: { annotationColor?: string };
  };
  return {
    version: record.version,
    color: record.data.annotationColor ?? null,
  };
}

async function installLostWriteProbe(vaultId: string): Promise<void> {
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
      const probe: PairedWriteProbe = {
        api,
        authorizedSend: api.authorizedSend.bind(api),
        listAnnotations: api.listAnnotations.bind(api),
        calls: 0,
        failRead: false,
      };
      pageHelpers.scratch.__zotlitWriteOutcomeProbe = probe;
      api.authorizedSend = (...args) =>
        Effect.promise(async () => {
          probe.calls += 1;
          const reply = await services.bridge.runPromise(
            probe.authorizedSend(...args),
          );
          if ("value" in reply) {
            probe.failRead = true;
            return { failure: { kind: "unknown-outcome" } };
          }
          return reply;
        });
      api.listAnnotations = (...args) =>
        Effect.promise(async () => {
          if (!probe.failRead)
            return await services.bridge.runPromise(
              probe.listAnnotations(...args),
            );
          probe.failRead = false;
          return { failure: { kind: "unreachable" } };
        });
    },
    { effectPath },
  );
}

async function installClosingPaneProbe(
  vaultId: string,
  annotationKey: string,
  color: string,
): Promise<void> {
  await obRun(
    vaultId,
    async (
      { zotlit, page: pageHelpers },
      {
        effectPath,
        annotationKey,
        color,
      }: { effectPath: string; annotationKey: string; color: string },
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
        outcome: null,
      };
      pageHelpers.scratch.__zotlitWriteOutcomeProbe = probe;
      api.authorizedSend = (...args) =>
        Effect.promise(async () => {
          if (!args[0].endsWith(`/${annotationKey}`))
            return await services.bridge.runPromise(
              probe.authorizedSend(...args),
            );
          probe.calls += 1;
          const reply = await services.bridge.runPromise(
            probe.authorizedSend(...args),
          );
          probe.reached = true;
          await gate.promise;
          return reply;
        });
      probe.pending = services.bridge
        .runPromise(
          services.annotationRepository.patchColor(annotationKey, color),
        )
        .then((outcome) => {
          probe.outcome = { kind: outcome.kind };
        });
    },
    { effectPath, annotationKey, color },
  );
}

async function writeOutcomeCalls(vaultId: string): Promise<number> {
  return await obRun(
    vaultId,
    async ({ page: pageHelpers }) => {
      return pageHelpers.scratch.__zotlitWriteOutcomeProbe?.calls ?? -1;
    },
    undefined,
  );
}

function visibleAnnotationColors(
  vaultId: string,
  annotationKey: string,
): Promise<{ card: string | null; mark: string | null }> {
  return obRun(
    vaultId,
    async ({ app, page }, { annotationKey }: { annotationKey: string }) => {
      const card = app.workspace
        .getLeavesOfType("zotero-annotation-view")
        .map((leaf) =>
          leaf.view.containerEl.querySelector<HTMLElement>(
            `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(annotationKey)}]`,
          ),
        )
        .find(Boolean);
      const mark = app.workspace
        .getLeavesOfType(page.reader.viewType)
        .map((leaf) =>
          leaf.view.containerEl.querySelector<SVGGraphicsElement>(
            `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(annotationKey)}]`,
          ),
        )
        .find(Boolean);
      return {
        card: card?.getAttribute("data-annot-color") ?? null,
        mark: mark?.getAttribute("fill") ?? null,
      };
    },
    { annotationKey },
  );
}
