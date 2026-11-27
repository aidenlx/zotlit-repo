import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { FileView, MarkdownView } from "obsidian";
import { describe, expect, it, beforeAll } from "vitest";

import type { QueryFileView } from "@zotlit/query-views/desktop/query-view/file-view.ts";
import { ANNOTATIONS, ATTACHMENTS, ITEMS } from "@zotlit/scripts/fixture";

import { verifyExternalAnnotationLock } from "./annotation-lock.ts";
import { noteBody } from "./e2e-run-note-helpers.ts";
import { readQueryViewUntil, revealQueryView } from "./note-query-view.ts";
import { cliCommand, obRun, obRunUntil, waitFor } from "./obsidian-cli.ts";
import type { NoteQueryView } from "./page-helpers.ts";
import type { PairedEditorContent } from "./page-paired-types.ts";
import {
  api,
  attachment,
  attachmentPath,
  baseUrl,
  debuggerPort,
  environment,
  m,
  prepareAuthorizationFixture,
  registerPairedRun,
  restoreAnnotationComment,
  seededAnnotation,
  serverID,
  vaultId,
  restorePairedFixture,
} from "./paired-run-fixture.ts";
import { openZoteroRdp, storedAnnotation } from "./paired-zotero.ts";

describe.skipIf(!baseUrl)("Paired Run", () => {
  registerPairedRun();

  beforeAll(restorePairedFixture, 120000);

  describe.skipIf(!debuggerPort || !vaultId)("an External Annotation", () => {
    it("is locked on its card and in the reader, and Zotero keeps it unchanged", async () => {
      await prepareAuthorizationFixture();
      const rdp = await openZoteroRdp(debuggerPort!);
      await verifyExternalAnnotationLock({ vaultId: vaultId!, rdp, m });
    }, 180000);
  });

  describe.skipIf(!debuggerPort || !vaultId)("a Query File", () => {
    it("shows the library's cards in a new Query File tab, and a comment typed on one reaches Zotero", async () => {
      await prepareAuthorizationFixture();
      await using cleanup = new AsyncDisposableStack();
      const key = seededAnnotation.key;
      const original =
        (await storedAnnotation(api, serverID, key)).annotationComment ?? "";

      await obRunUntil(
        vaultId!,
        async ({ zotlit }, { attachmentKey }: { attachmentKey: string }) => {
          const { annotationRepository: repository, bridge } = zotlit.services;
          await bridge.runPromise(repository.probe);
          const list = await bridge.runPromise(repository.read(attachmentKey));
          return list?.source.kind;
        },
        { attachmentKey: attachment.key },
        {
          ready: (value) => value === "zotero-local-api",
          what: "the annotation list source to be the Zotero Local API",
        },
      );

      const before = await obRun(
        vaultId!,
        async ({ app }) => {
          return app.vault.getFiles().map((file) => file.path);
        },
        undefined,
      );
      await obRun(
        vaultId!,
        async ({ app }) => {
          app.commands.executeCommandById("zotlit:new-query-file");
        },
        undefined,
      );
      let created = "";
      expect(
        await waitFor(async () => {
          const files = await obRun(
            vaultId!,
            async ({ app }) => {
              return app.vault.getFiles().map((file) => file.path);
            },
            undefined,
          );
          created = files.find((path) => !before.includes(path)) ?? "";
          return created.endsWith(".zotquery");
        }),
      ).toBe(true);
      cleanup.defer(async () => {
        await obRun(
          vaultId!,
          async ({ app }, { created }: { created: string }) => {
            for (const leaf of app.workspace.getLeavesOfType(
              "zotlit-query-file",
            ))
              if ((leaf.view as FileView).file?.path === created) leaf.detach();
            const file = app.vault.getFileByPath(created);
            if (file) await app.vault.delete(file);
          },
          { created },
        );
      });

      await obRunUntil(
        vaultId!,
        async ({ app }, { created }: { created: string }) => {
          return !!app.workspace
            .getLeavesOfType("zotlit-query-file")
            .map((leaf) => leaf.view as QueryFileView)
            .find((view) => view.file?.path === created)
            ?.contentEl.querySelector<HTMLElement>("[data-query-view-menu]");
        },
        { created },
        {
          tries: 120,
          what: "the Query File tab for the new file to show its view menu",
        },
      );
      await obRun(
        vaultId!,
        async (
          { app, page: pageHelpers },
          { created, viewName }: { created: string; viewName: string },
        ) => {
          await pageHelpers.pickQueryView(
            app.workspace
              .getLeavesOfType("zotlit-query-file")
              .map((leaf) => leaf.view as QueryFileView)
              .find((view) => view.file?.path === created)!,
            viewName,
          );
        },
        { created, viewName: m.query_file_annotations_view_name() },
      );

      await obRunUntil(
        vaultId!,
        async ({ app }, { created, key }: { created: string; key: string }) => {
          return !!app.workspace
            .getLeavesOfType("zotlit-query-file")
            .map((leaf) => leaf.view as QueryFileView)
            .find((view) => view.file?.path === created)
            ?.contentEl.querySelector<HTMLElement>(
              `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(key)}]`,
            );
        },
        { created, key },
        {
          tries: 120,
          what: "the Query File tab to show the seeded annotation card",
        },
      );

      await obRunUntil(
        vaultId!,
        async (
          { app, page: pageHelpers },
          { created, key }: { created: string; key: string },
        ) => {
          const { press } = pageHelpers;
          const card = app.workspace
            .getLeavesOfType("zotlit-query-file")
            .map((leaf) => leaf.view as QueryFileView)
            .find((view) => view.file?.path === created)
            ?.contentEl.querySelector<HTMLElement>(
              `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(key)}]`,
            );
          if (
            app.workspace
              .getLeavesOfType("zotlit-query-file")
              .map((leaf) => leaf.view as QueryFileView)
              .find((view) => view.file?.path === created)
              ?.contentEl.querySelector<HTMLElement>(
                `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(key)}]`,
              )
              ?.querySelector<HTMLElement>(".cm-content")
          )
            return "open";
          if (!card!.hasAttribute("data-alone")) {
            press(card as HTMLElement, "card");
            return "selecting";
          }
          getSelection()!.removeAllRanges();
          press(
            card!.querySelector<HTMLElement>(".zt-annot-comment-field"),
            "comment field",
          );
          return (
            !!app.workspace
              .getLeavesOfType("zotlit-query-file")
              .map((leaf) => leaf.view as QueryFileView)
              .find((view) => view.file?.path === created)
              ?.contentEl.querySelector<HTMLElement>(
                `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(key)}]`,
              )
              ?.querySelector<HTMLElement>(".cm-content") && "open"
          );
        },
        { created, key },
        {
          ready: (value) => value === "open",
          what: "the seeded card in the Query File tab to open its comment editor",
        },
      );
      const comment = "Typed in a Query File";
      cleanup.defer(async () => {
        await restoreAnnotationComment(api, {
          serverID,
          key: await obRun(
            vaultId!,
            async ({ app }) => {
              return String(
                await JSON.parse(
                  app.secretStorage.getSecret(
                    "zotlit-zotero-write-authorization",
                  )!,
                ).key,
              );
            },
            undefined,
          ),
          annotationKey: key,
          comment: original,
        }).catch(() => {});
      });
      await obRun(
        vaultId!,
        async (
          { app },
          {
            created,
            annotationKey,
            comment,
          }: {
            created: string;
            annotationKey: string;
            comment: "Typed in a Query File";
          },
        ) => {
          const content = app.workspace
            .getLeavesOfType("zotlit-query-file")
            .map((leaf) => leaf.view as QueryFileView)
            .find((view) => view.file?.path === created)
            ?.contentEl.querySelector<HTMLElement>(
              `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(annotationKey)}]`,
            )
            ?.querySelector<HTMLElement>(".cm-content");
          const view = (content! as PairedEditorContent).cmTile.root.view;
          view.focus();
          view.dispatch({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: comment,
            },
            userEvent: "input.type",
          });
          content!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true,
              cancelable: true,
            }),
          );
        },
        { created, annotationKey: key, comment },
      );

      expect(
        await waitFor(
          async () =>
            (await storedAnnotation(api, serverID, key)).annotationComment ===
            comment,
          120,
        ),
      ).toBe(true);
      await obRunUntil(
        vaultId!,
        async ({ app }, { created, key }: { created: string; key: string }) => {
          return (
            app.workspace
              .getLeavesOfType("zotlit-query-file")
              .map((leaf) => leaf.view as QueryFileView)
              .find((view) => view.file?.path === created)
              ?.contentEl.querySelector<HTMLElement>(
                `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(key)}]`,
              )
              ?.querySelector<HTMLElement>(".zt-annot-comment")?.textContent ??
            ""
          );
        },
        { created, key },
        {
          ready: (value) => value === comment,
          what: "the seeded card's comment in the Query File tab to read the typed text",
        },
      );
    }, 180000);

    it("undoes a comment typed on a card in a note's embed with the card's undo key, and drags the card into the note", async () => {
      await prepareAuthorizationFixture();
      await using cleanup = new AsyncDisposableStack();
      const key = seededAnnotation.key;
      const notePath = "literatures/rougierTenSimpleRules2014.md";
      const original =
        (await storedAnnotation(api, serverID, key)).annotationComment ?? "";
      const storedComment = async () =>
        (await storedAnnotation(api, serverID, key)).annotationComment ?? "";
      const platformKey = process.platform === "darwin" ? "metaKey" : "ctrlKey";

      await obRunUntil(
        vaultId!,
        async ({ zotlit }, { attachmentKey }: { attachmentKey: string }) => {
          const { annotationRepository: repository, bridge } = zotlit.services;
          await bridge.runPromise(repository.probe);
          const list = await bridge.runPromise(repository.read(attachmentKey));
          return list?.source.kind;
        },
        { attachmentKey: attachment.key },
        {
          ready: (value) => value === "zotero-local-api",
          what: "the annotation list source to be the Zotero Local API before writing",
        },
      );

      const layout = await obRun(
        vaultId!,
        async ({ app }) => {
          return JSON.stringify(app.workspace.getLayout());
        },
        undefined,
      );
      const noteText = await obRun(
        vaultId!,
        async (
          { app },
          {
            notePath,
          }: { notePath: "literatures/rougierTenSimpleRules2014.md" },
        ) => {
          return await app.vault.read(app.vault.getFileByPath(notePath)!);
        },
        { notePath },
      );
      cleanup.defer(async () => {
        await obRun(
          vaultId!,
          async (
            { app },
            {
              layout,
              notePath,
              noteText,
            }: {
              layout: string;
              notePath: "literatures/rougierTenSimpleRules2014.md";
              noteText: string;
            },
          ) => {
            await app.workspace.changeLayout(JSON.parse(layout));
            await app.vault.modify(
              app.vault.getFileByPath(notePath)!,
              noteText,
            );
          },
          { layout, notePath, noteText },
        );
      });
      cleanup.defer(async () => {
        await restoreAnnotationComment(api, {
          serverID,
          key: await obRun(
            vaultId!,
            async ({ app }) => {
              return String(
                await JSON.parse(
                  app.secretStorage.getSecret(
                    "zotlit-zotero-write-authorization",
                  )!,
                ).key,
              );
            },
            undefined,
          ),
          annotationKey: key,
          comment: original,
        }).catch(() => {});
      });
      await obRun(
        vaultId!,
        async (
          { app, zotlit },
          { attachmentPath }: { attachmentPath: string },
        ) => {
          const s = zotlit.services;
          await s.bridge.runPromise(
            s.pdfReader.open(
              app.vault.getFileByPath(attachmentPath)!,
              "",
              "tab",
            ),
          );
        },
        { attachmentPath },
      );
      await obRunUntil(
        vaultId!,
        async ({ zotlit }, { attachmentPath }: { attachmentPath: string }) => {
          return !!zotlit.services.bridge
            .runSync(zotlit.services.pdfAnnotationEditor.bindings)
            .find((b) => b.filePath === attachmentPath)?.session;
        },
        { attachmentPath },
        {
          what: "the PDF annotation editor to hold a session for the attachment",
        },
      );
      await obRun(
        vaultId!,
        async (
          { app },
          {
            notePath,
          }: { notePath: "literatures/rougierTenSimpleRules2014.md" },
        ) => {
          const leaf = app.workspace.getLeaf("split");
          await leaf.setViewState({
            type: "markdown",
            state: { file: notePath, mode: "source", source: false },
            active: true,
          });
          app.workspace.setActiveLeaf(leaf, { focus: true });
        },
        { notePath },
      );

      const embed = await revealQueryView(vaultId!, notePath, {
        embed: "Lab annotations.zotquery#This item",
      });

      await readQueryViewUntil(
        vaultId!,
        async (
          { page: pageHelpers },
          { embed, keyName }: { embed: NoteQueryView; keyName: string },
        ) => {
          return !!(await pageHelpers.revealQueryView(embed)).querySelector(
            `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(keyName)}]`,
          );
        },
        { embed, keyName: key },
        {
          what: "the card in the note's embed",
          tries: 120,
          ready: (value) => value !== null && ((present) => present)(value),
        },
      );

      await readQueryViewUntil(
        vaultId!,
        async (
          { page: pageHelpers },
          { embed, key }: { embed: NoteQueryView; key: string },
        ) => {
          return await (async () => {
            const { press } = pageHelpers;
            const card = (
              await pageHelpers.revealQueryView(embed)
            ).querySelector(
              `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(key)}]`,
            );
            if (
              (await pageHelpers.revealQueryView(embed))
                .querySelector(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(key)}]`,
                )
                ?.querySelector(".cm-content")
            )
              return "open";
            if (!card!.hasAttribute("data-alone")) {
              (card! as HTMLElement).focus();
              press(card as HTMLElement, "card");
              return "selecting";
            }
            getSelection()!.removeAllRanges();
            press(
              card!.querySelector<HTMLElement>(".zt-annot-comment-field"),
              "comment field",
            );
            return String(
              !!(await pageHelpers.revealQueryView(embed))
                .querySelector(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(key)}]`,
                )
                ?.querySelector(".cm-content") && "open",
            );
          })();
        },
        { embed, key },
        {
          what: "the comment editor on the embed's card",
          ready: (value) =>
            value !== null && ((answer) => answer === "open")(value),
        },
      );
      const comment = "Typed in a note's embed";
      await obRun(
        vaultId!,
        async (
          { page: pageHelpers },
          {
            embed,
            annotationKey,
            comment,
          }: {
            embed: NoteQueryView;
            annotationKey: string;
            comment: "Typed in a note's embed";
          },
        ) => {
          const content = (await pageHelpers.revealQueryView(embed))
            .querySelector<HTMLElement>(
              `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(annotationKey)}]`,
            )
            ?.querySelector<HTMLElement>(".cm-content");
          const view = (content! as PairedEditorContent).cmTile.root.view;
          view.focus();
          view.dispatch({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: comment,
            },
            userEvent: "input.type",
          });
          content!.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true,
              cancelable: true,
            }),
          );
        },
        { embed, annotationKey: key, comment },
      );
      expect(
        await waitFor(async () => (await storedComment()) === comment, 120),
      ).toBe(true);
      await obRunUntil(
        vaultId!,
        async (
          { zotlit },
          { key, attachmentKey }: { key: string; attachmentKey: string },
        ) => {
          const { annotationRepository: repository, bridge } = zotlit.services;
          return (
            bridge.runSync(repository.mutationFor(key)).kind === "idle" &&
            !bridge.runSync(repository.textDraftFor("comment", key)) &&
            bridge.runSync(repository.canUndo(attachmentKey))
          );
        },
        { key, attachmentKey: attachment.key },
        {
          what: "the annotation to have no write or draft and an undo step ready",
        },
      );

      await obRun(
        vaultId!,
        async (
          { app },
          {
            notePath,
            platformKey,
          }: {
            notePath: "literatures/rougierTenSimpleRules2014.md";
            platformKey: "ctrlKey" | "metaKey";
          },
        ) => {
          const target = (
            app.workspace
              .getLeavesOfType("markdown")
              .find((leaf) => (leaf.view as FileView).file?.path === notePath)!
              .view as MarkdownView
          ).editor.cm.contentDOM;
          target.focus();
          const event = new KeyboardEvent("keydown", {
            key: "z",
            code: "KeyZ",
            [platformKey]: true,
            bubbles: true,
            cancelable: true,
          });
          target.dispatchEvent(event);
          return { prevented: event.defaultPrevented };
        },
        { notePath, platformKey },
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(await storedComment()).toBe(comment);

      expect(
        await obRun(
          vaultId!,
          async (
            { page: pageHelpers },
            {
              embed,
              annotationKey,
              platformKey,
            }: {
              embed: NoteQueryView;
              annotationKey: string;
              platformKey: "ctrlKey" | "metaKey";
            },
          ) => {
            const target = (
              await pageHelpers.revealQueryView(embed)
            ).querySelector<HTMLElement>(
              `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(annotationKey)}]`,
            );
            target!.focus();
            const event = new KeyboardEvent("keydown", {
              key: "z",
              code: "KeyZ",
              [platformKey]: true,
              bubbles: true,
              cancelable: true,
            });
            target!.dispatchEvent(event);
            return { prevented: event.defaultPrevented };
          },
          { embed, annotationKey: key, platformKey },
        ),
      ).toEqual({ prevented: true });
      expect(
        await waitFor(async () => (await storedComment()) === original, 120),
      ).toBe(true);

      expect(
        await obRun(
          vaultId!,
          async (
            { app, page: pageHelpers },
            {
              notePath,
              embed,
              key,
            }: {
              notePath: "literatures/rougierTenSimpleRules2014.md";
              embed: NoteQueryView;
              key: string;
            },
          ) => {
            const view = app.workspace
              .getLeavesOfType("markdown")
              .find((leaf) => (leaf.view as FileView).file?.path === notePath)!
              .view as MarkdownView;
            const cm = view.editor.cm;
            const transfer = new DataTransfer();
            const handle = (await pageHelpers.revealQueryView(embed))
              .querySelector<HTMLElement>(
                `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(key)}]`,
              )!
              .querySelector<HTMLElement>("[draggable]");
            const from = handle!.getBoundingClientRect();
            handle!.dispatchEvent(
              new DragEvent("dragstart", {
                bubbles: true,
                cancelable: true,
                dataTransfer: transfer,
                clientX: Math.floor(from.left + from.width / 2),
                clientY: Math.floor(from.top + from.height / 2),
              }),
            );
            const rect = cm.coordsAtPos(cm.state.doc.length);
            cm.contentDOM.dispatchEvent(
              new DragEvent("drop", {
                bubbles: true,
                cancelable: true,
                dataTransfer: transfer,
                clientX: Math.floor(rect!.left + 1),
                clientY: Math.floor((rect!.top + rect!.bottom) / 2),
              }),
            );
            return "dropped";
          },
          { notePath, embed, key },
        ),
      ).toBe("dropped");
      await obRunUntil(
        vaultId!,
        async (
          { app },
          {
            notePath,
            key,
          }: {
            notePath: "literatures/rougierTenSimpleRules2014.md";
            key: string;
          },
        ) => {
          const view = app.workspace
            .getLeavesOfType("markdown")
            .map((leaf) => leaf.view as MarkdownView)
            .find((view) => view.file?.path === notePath)!;
          const text = view.editor.getValue();
          return (
            text.includes("> [!note]") &&
            new RegExp(
              `zotero://open/library/items/\\w+\\?annotation=${RegExp.escape(key)}\\b`,
            ).test(text)
          );
        },
        { notePath, key },
        {
          what: "the literature note to hold a callout linking the annotation",
        },
      );
    }, 180000);
  });

  describe.skipIf(!debuggerPort || !vaultId)(
    "a Literature Note on the default Profile",
    () => {
      it("shows its Item's Annotations in a Query Block, sends a comment typed there to Zotero, and keeps the block text through an update", async () => {
        await prepareAuthorizationFixture();
        await using cleanup = new AsyncDisposableStack();
        const itemKey = "RUGIER24";
        const key = seededAnnotation.key;
        const original =
          (await storedAnnotation(api, serverID, key)).annotationComment ?? "";

        await obRunUntil(
          vaultId!,
          async ({ zotlit }, { attachmentKey }: { attachmentKey: string }) => {
            const { annotationRepository: repository, bridge } =
              zotlit.services;
            await bridge.runPromise(repository.probe);
            const list = await bridge.runPromise(
              repository.read(attachmentKey),
            );
            return list?.source.kind;
          },
          { attachmentKey: attachment.key },
          {
            ready: (value) => value === "zotero-local-api",
            what: "the item's annotation list source to be the Zotero Local API",
          },
        );

        const layout = await obRun(
          vaultId!,
          async ({ app }) => {
            return JSON.stringify(app.workspace.getLayout());
          },
          undefined,
        );
        const fixtureNotes = await obRun(
          vaultId!,
          async ({ app, zotlit }, { itemKey }: { itemKey: "RUGIER24" }) => {
            const services = zotlit.services;
            await services.bridge.runPromise(services.noteIndex.whenIndexed);
            const notes = [];
            for (const note of services.bridge.runSync(
              services.noteIndex.getNotesByItemKey(itemKey),
            )) {
              const file = app.vault.getFileByPath(note.path);
              notes.push({
                path: note.path,
                text: await app.vault.read(file!),
              });
              await app.vault.delete(file!);
            }
            return notes;
          },
          { itemKey },
        );
        expect(fixtureNotes.map(({ path }) => path)).toContain(
          "literatures/rougierTenSimpleRules2014.md",
        );
        let created = "";
        cleanup.defer(async () => {
          await obRun(
            vaultId!,
            async (
              { app },
              {
                layout,
                createdPath,
                fixtureNotes,
              }: {
                layout: string;
                createdPath: string;
                fixtureNotes: { path: string; text: string }[];
              },
            ) => {
              await app.workspace.changeLayout(JSON.parse(layout));
              const created = app.vault.getFileByPath(createdPath);
              if (created) await app.vault.delete(created);
              for (const { path, text } of fixtureNotes) {
                const file = app.vault.getFileByPath(path);
                if (file) await app.vault.modify(file, text);
                else await app.vault.create(path, text);
              }
            },
            { layout, createdPath: created, fixtureNotes },
          );
        });
        cleanup.defer(async () => {
          await restoreAnnotationComment(api, {
            serverID,
            key: await obRun(
              vaultId!,
              async ({ app }) => {
                return String(
                  await JSON.parse(
                    app.secretStorage.getSecret(
                      "zotlit-zotero-write-authorization",
                    )!,
                  ).key,
                );
              },
              undefined,
            ),
            annotationKey: key,
            comment: original,
          }).catch(() => {});
        });
        await obRunUntil(
          vaultId!,
          async ({ zotlit }, { itemKey }: { itemKey: "RUGIER24" }) => {
            return zotlit.services.bridge.runSync(
              zotlit.services.noteIndex.getNotesByItemKey(itemKey),
            ).length;
          },
          { itemKey },
          {
            ready: (value) => value === 0,
            what: "the note index to hold no notes for item RUGIER24",
          },
        );
        const result = await obRun(
          vaultId!,
          async ({ zotlit }, { itemKey }: { itemKey: "RUGIER24" }) => {
            const services = zotlit.services;
            const hits = await services.itemLookup.search("", { limit: 100 });
            const hit = hits.find(
              (candidate) => candidate.item.indexedKey === itemKey,
            );
            if (!hit) throw new Error("Fixture Item not found");
            const result = await services.noteFeature.createNote(hit.item, {
              profile: "default",
            });
            return result.outcome === "created"
              ? { outcome: "created", path: result.file.path }
              : { outcome: result.outcome };
          },
          { itemKey },
        );
        expect(result.outcome).toBe("created");
        created = result.path!;
        const read = () =>
          obRun(
            vaultId!,
            async ({ app }, { created }: { created: string }) => {
              return await app.vault.read(app.vault.getFileByPath(created)!);
            },
            { created },
          );
        const block = [
          "## Annotations",
          "",
          "```zotquery",
          "views:",
          "  - type: annotations",
          "    name: Annotations",
          "    from: annotations",
          "    filters: item == this.item",
          "    sort:",
          "      - property: attachment.dateAdded",
          "        direction: ASC",
          "      - property: sortIndex",
          "        direction: ASC",
          "```",
        ].join("\n");
        const managed = (text: string) =>
          /%%zt-managed%%\n([\s\S]*?)%%\/zt-managed%%/.exec(text)?.[1] ?? "";
        const createdText = await read();
        expect(createdText).toContain(block);
        expect(createdText).not.toContain("%%zt-managed%%");
        expect(createdText).not.toContain("[!note]");

        const report = JSON.parse(
          await cliCommand(vaultId!, "zotlit:query", {
            args: {
              from: "annotations",
              filter: "item == this.item",
              "this-item": itemKey,
              sort: "attachment.dateAdded,sortIndex",
              limit: "100",
            },
          }),
        ) as { ok: boolean; rows?: { indexedKey: string }[] };
        expect(report.ok).toBe(true);
        const own = report.rows!.map((row) => row.indexedKey);
        expect(own).toContain(key);
        await obRun(
          vaultId!,
          async ({ app }, { created }: { created: string }) => {
            const leaf = app.workspace.getLeaf("tab");
            await leaf.openFile(app.vault.getFileByPath(created)!, {
              state: { mode: "source", source: false },
            });
            app.workspace.setActiveLeaf(leaf, { focus: true });
          },
          { created },
        );
        const blockEl = await revealQueryView(vaultId!, created, { block: 0 });
        await readQueryViewUntil(
          vaultId!,
          async (
            { page: pageHelpers },
            { blockEl }: { blockEl: NoteQueryView },
          ) => {
            return [
              ...(await pageHelpers.revealQueryView(blockEl)).querySelectorAll(
                ".zt-annot-card",
              ),
            ].map((n) => n.getAttribute("data-zotero-annotation-key"));
          },
          { blockEl },
          {
            what: "the Query Block's cards",
            tries: 120,
            ready: (value) =>
              value !== null &&
              ((cards) => JSON.stringify(cards) === JSON.stringify(own))(value),
          },
        );

        await readQueryViewUntil(
          vaultId!,
          async (
            { page: pageHelpers },
            { blockEl, key }: { blockEl: NoteQueryView; key: string },
          ) => {
            return await (async () => {
              const { press } = pageHelpers;
              const card = (
                await pageHelpers.revealQueryView(blockEl)
              ).querySelector(
                `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(key)}]`,
              );
              if (
                (await pageHelpers.revealQueryView(blockEl))
                  .querySelector(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(key)}]`,
                  )
                  ?.querySelector(".cm-content")
              )
                return "open";
              if (!card!.hasAttribute("data-alone")) {
                press(card as HTMLElement, "card");
                return "selecting";
              }
              getSelection()!.removeAllRanges();
              press(
                card!.querySelector<HTMLElement>(".zt-annot-comment-field"),
                "comment field",
              );
              return String(
                !!(await pageHelpers.revealQueryView(blockEl))
                  .querySelector(
                    `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(key)}]`,
                  )
                  ?.querySelector(".cm-content") && "open",
              );
            })();
          },
          { blockEl, key },
          {
            what: "the comment editor on the block's card",
            ready: (value) =>
              value !== null && ((answer) => answer === "open")(value),
          },
        );
        const comment = "Typed in a Literature Note";
        await obRun(
          vaultId!,
          async (
            { page: pageHelpers },
            {
              blockEl,
              annotationKey,
              comment,
            }: {
              blockEl: NoteQueryView;
              annotationKey: string;
              comment: "Typed in a Literature Note";
            },
          ) => {
            const content = (await pageHelpers.revealQueryView(blockEl))
              .querySelector<HTMLElement>(
                `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(annotationKey)}]`,
              )
              ?.querySelector<HTMLElement>(".cm-content");
            const view = (content! as PairedEditorContent).cmTile.root.view;
            view.focus();
            view.dispatch({
              changes: {
                from: 0,
                to: view.state.doc.length,
                insert: comment,
              },
              userEvent: "input.type",
            });
            content!.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Escape",
                bubbles: true,
                cancelable: true,
              }),
            );
          },
          { blockEl, annotationKey: key, comment },
        );
        expect(
          await waitFor(
            async () =>
              (await storedAnnotation(api, serverID, key)).annotationComment ===
              comment,
            120,
          ),
        ).toBe(true);
        await readQueryViewUntil(
          vaultId!,
          async (
            { page: pageHelpers },
            { blockEl, key }: { blockEl: NoteQueryView; key: string },
          ) => {
            return (
              (await pageHelpers.revealQueryView(blockEl))
                .querySelector(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(key)}]`,
                )
                ?.querySelector(".zt-annot-comment")?.textContent ?? ""
            );
          },
          { blockEl, key },
          {
            what: "the comment on the block's card",
            ready: (value) =>
              value !== null && ((answer) => answer === comment)(value),
          },
        );

        await obRun(
          vaultId!,
          async (
            { page: pageHelpers },
            { blockEl }: { blockEl: NoteQueryView },
          ) => {
            const el = await pageHelpers.revealQueryView(blockEl);
            await pageHelpers.openToolbarPopover(el, "sort");
          },
          { blockEl },
        );
        await obRun(
          vaultId!,
          async (
            { page: pageHelpers },
            { blockEl }: { blockEl: NoteQueryView },
          ) => {
            const { press } = pageHelpers;
            const el = await pageHelpers.revealQueryView(blockEl);
            press(
              el.doc.querySelector<HTMLElement>(
                '[data-query-popover="sort"] [data-sort-add]',
              ),
              "Add sort",
            );
          },
          { blockEl },
        );
        await readQueryViewUntil(
          vaultId!,
          async (
            { page: pageHelpers },
            { blockEl }: { blockEl: NoteQueryView },
          ) => {
            return (
              await pageHelpers.revealQueryView(blockEl)
            ).doc.querySelectorAll(
              '[data-query-popover="sort"] [data-sort-row]',
            ).length;
          },
          { blockEl },
          {
            what: "the Query Block's sort rows",
            ready: (value) => value !== null && ((rows) => rows === 3)(value),
          },
        );
        for (const [control, value] of [
          ["data-sort-property", "type"],
          ["data-sort-direction", "DESC"],
        ] as const) {
          await readQueryViewUntil(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                keyName,
                control,
              }: {
                keyName: NoteQueryView;
                control: "data-sort-property" | "data-sort-direction";
              },
            ) => {
              return !!(
                await pageHelpers.revealQueryView(keyName)
              ).doc.querySelector(
                `[data-query-popover="sort"] [data-sort-row]:last-of-type [${control}]`,
              );
            },
            { keyName: blockEl, control },
            {
              what: "the sort row's control",
              ready: (value) => value !== null && ((present) => present)(value),
            },
          );
          await obRun(
            vaultId!,
            async (
              { page: pageHelpers },
              {
                blockEl,
                control,
                value,
              }: {
                blockEl: NoteQueryView;
                control: "data-sort-property" | "data-sort-direction";
                value: "type" | "DESC";
              },
            ) => {
              const { pick } = pageHelpers;
              const el = await pageHelpers.revealQueryView(blockEl);
              await pick(
                el.doc.querySelector<HTMLButtonElement>(
                  `[data-query-popover="sort"] [data-sort-row]:last-of-type [${control}]`,
                ),
                value,
                control,
              );
            },
            { blockEl, control, value },
          );
        }
        const sorted = block.replace(
          "        direction: ASC\n```",
          "        direction: ASC\n      - property: type\n        direction: DESC\n```",
        );
        expect(await waitFor(async () => (await read()).includes(sorted))).toBe(
          true,
        );

        const update = () =>
          obRun(
            vaultId!,
            async (
              { app, zotlit },
              { created, itemKey }: { created: string; itemKey: "RUGIER24" },
            ) => {
              const services = zotlit.services;
              const result = await services.noteFeature.updateNote(
                app.vault.getFileByPath(created)!,
                { indexedKey: itemKey, scope: "full" },
              );
              return { diagnostic: result.diagnostic ?? null };
            },
            { created, itemKey },
          );
        const beforeUpdate = await read();
        expect(await update()).toEqual({ diagnostic: null });
        expect(noteBody(await read())).toBe(noteBody(beforeUpdate));

        const item = ITEMS.find(({ key: candidate }) => candidate === itemKey)!;
        const attachments = ATTACHMENTS.filter(
          ({ parentItemID }) => parentItemID === item.itemID,
        );
        const attachmentIDs = new Set(attachments.map(({ itemID }) => itemID));
        const outside = [
          `This note rests on ${item
            .literatureNoteCitations!.map((citation) => `[@${citation}]`)
            .join(" ")}.`,
          "",
          ...attachments
            .filter(({ sourceAsset }) => sourceAsset !== null)
            .map(
              ({ path }) =>
                `[${path!}](${pathToFileURL(join(environment!.vaultPath, path!)).href})`,
            ),
        ].join("\n");
        const legacy = [
          "---",
          `title: ${JSON.stringify(item.title)}`,
          `zotero-key: ${item.key}`,
          `citekey: ${item.citationKey!}`,
          "---",
          `# ${item.title}`,
          "",
          "%%zt-managed%%",
          "## Annotations",
          ...ANNOTATIONS.filter(({ parentItemID }) =>
            attachmentIDs.has(parentItemID),
          ).flatMap(({ pageLabel, text, comment }) => [
            "",
            `> [!note] Page ${pageLabel}`,
            ">",
            `> ${text ?? comment ?? ""}`,
            "",
          ]),
          "%%/zt-managed%%",
          "",
          outside,
          "",
        ].join("\n");
        expect(
          await obRun(
            vaultId!,
            async (
              { app },
              { created, legacy }: { created: string; legacy: string },
            ) => {
              const file = app.vault.getFileByPath(created);
              await app.vault.modify(file!, legacy);
              return (await app.vault.read(file!)) === legacy;
            },
            { created, legacy },
          ),
        ).toBe(true);
        expect(await update()).toEqual({ diagnostic: null });
        const migratedText = await read();
        const migrated = managed(migratedText);
        expect(migrated).toContain(block);
        expect(migrated).not.toContain("[!note]");
        expect(migratedText).toContain(`# ${item.title}\n`);
        expect(migratedText.split("%%/zt-managed%%")[1]).toContain(outside);
      }, 240000);
    },
  );
});
