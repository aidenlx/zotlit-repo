import { expect } from "vitest";

import { ATTACHMENTS } from "@zotlit/scripts/fixture";

import { obRunUntil, obRun } from "./obsidian-cli.ts";
import { clearNotices, waitFor } from "./obsidian-cli.ts";
import type { AnnotationLeaf } from "./page-notes-types.ts";
import type { ZoteroRdp } from "./paired-zotero.ts";
import {
  openPdfWithAnnotationView,
  raiseWindow,
  reopenPdfView,
  settledGesture,
} from "./reader-gestures.ts";

type Messages = typeof import("@zotlit/plugin-messages/messages.ts");

const attachment = ATTACHMENTS.find(({ key }) => key === "EXTPDF25")!;
const attachmentPath = attachment.path!;

const QUOTED_TEXT = "Another PDF reader highlighted this sentence.";
const COMMENT = "Noted in another PDF reader.";

const ATTACHMENT_ITEM = `Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID, ${JSON.stringify(attachment.key)})`;

interface HeldAnnotation {
  isExternal: boolean;
  version: number;
  dateModified: string;
  deleted: boolean;
  text: string;
  comment: string;
  color: string;
  position: string;
  sortIndex: string;
  pageLabel: string;
  tags: { tag: string; type?: number }[];
}

export async function verifyExternalAnnotationLock({
  vaultId,
  rdp,
  m,
}: {
  vaultId: string;
  rdp: ZoteroRdp;
  m: Messages;
}): Promise<void> {
  await using cleanup = new AsyncDisposableStack();

  expect(
    await rdp.json<number>(`${ATTACHMENT_ITEM}.getAnnotations().length`),
  ).toBe(0);
  const readerTab = await rdp.json<string>(`(async () => {
    const reader = await Zotero.Reader.open(${ATTACHMENT_ITEM}.id);
    return reader.tabID;
  })()`);
  cleanup.defer(async () => {
    await rdp.json(`(async () => {
      const attachment = ${ATTACHMENT_ITEM};
      for (const annotation of attachment.getAnnotations()) {
        await annotation.eraseTx();
      }
      attachment.attachmentLastProcessedModificationTime = 0;
      await attachment.saveTx({ skipAll: true });
      return "restored";
    })()`);
  });
  cleanup.defer(async () => {
    await rdp.json(`(() => {
      Zotero.Reader.getByTabID(${JSON.stringify(readerTab)})?.close();
      return "closed";
    })()`);
  });
  const heldKeys = () =>
    rdp.json<string[]>(
      `${ATTACHMENT_ITEM}.getAnnotations().map(({ key }) => key)`,
    );
  expect(
    await waitFor(async () => (await heldKeys()).length > 0),
    "Zotero imported no Annotation from the PDF",
  ).toBe(true);
  const [annotationKey = ""] = await heldKeys();

  const readHeldAnnotation = () =>
    rdp.json<{ count: number; annotation: HeldAnnotation }>(`(() => {
      const attachment = ${ATTACHMENT_ITEM};
      const item = Zotero.Items.getByLibraryAndKey(
        Zotero.Libraries.userLibraryID,
        ${JSON.stringify(annotationKey)},
      );
      return {
        count: attachment.getAnnotations().length,
        annotation: {
          isExternal: item.annotationIsExternal,
          version: item.version,
          dateModified: item.dateModified,
          deleted: item.deleted,
          text: item.annotationText,
          comment: item.annotationComment,
          color: item.annotationColor,
          position: item.annotationPosition,
          sortIndex: item.annotationSortIndex,
          pageLabel: item.annotationPageLabel,
          tags: item.getTags(),
        },
      };
    })()`);
  const imported = await readHeldAnnotation();
  expect(imported).toMatchObject({
    count: 1,
    annotation: {
      isExternal: true,
      deleted: false,
      text: QUOTED_TEXT,
      comment: COMMENT,
    },
  });

  await raiseWindow(vaultId);
  await openPdfWithAnnotationView(vaultId, { attachmentPath, cleanup });
  await obRunUntil(
    vaultId,
    async ({ zotlit }, { attachmentKey }) => {
      const { annotationRepository: repository, bridge } = zotlit.services;
      await bridge.runPromise(repository.probe);
      const list = await bridge.runPromise(repository.read(attachmentKey));
      return `${String(list?.source.kind)}/${
        bridge.runSync(repository.capabilityFor(attachmentKey)).kind
      }`;
    },
    { attachmentKey: attachment.key },
    {
      ready: (value) => value === "zotero-local-api/writable",
      what: "the attachment source and capability to read zotero-local-api/writable",
    },
  );

  const reason = m.annot_view_lock_external();
  const selectCardAlone = async () => {
    await obRunUntil(
      vaultId,
      async ({ app }, { annotationKey }) => {
        const card = (
          app.workspace.getLeavesOfType(
            "zotero-annotation-view",
          ) as AnnotationLeaf[]
        )[0]?.view?.containerEl.querySelector<HTMLElement>(
          `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
            annotationKey,
          )}]`,
        );
        if (!card) return "no card";
        if (!card.hasAttribute("data-alone")) card.click();
        return card.hasAttribute("data-alone");
      },
      { annotationKey },
      { what: "the annotation card to be marked alone in the Annotation View" },
    );
  };
  const dimmed = (node: string) =>
    obRun(
      vaultId,
      async ({ app }, { annotationKey, nodeSelector }) => {
        const node = (
          app.workspace.getLeavesOfType(
            "zotero-annotation-view",
          ) as AnnotationLeaf[]
        )[0]?.view?.containerEl
          .querySelector<HTMLElement>(
            `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
              annotationKey,
            )}]`,
          )!
          .querySelector<HTMLElement>(nodeSelector);
        return node ? String(node.hasAttribute("data-blocked")) : "absent";
      },
      { annotationKey, nodeSelector: node },
    );

  await obRunUntil(
    vaultId,
    async ({ app }, { annotationKey }) => {
      return !!app.workspace
        .getLeavesOfType("zotero-annotation-view")[0]
        ?.view?.containerEl.querySelector<HTMLElement>(
          `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
            annotationKey,
          )}]`,
        )
        ?.querySelector<HTMLElement>(".zt-annot-lock");
    },
    { annotationKey },
    { what: "the lock icon on the annotation card in the Annotation View" },
  );
  expect(
    await obRun(
      vaultId,
      async ({ app }, { annotationKey }) => {
        const card = (
          app.workspace.getLeavesOfType(
            "zotero-annotation-view",
          ) as AnnotationLeaf[]
        )[0]?.view?.containerEl.querySelector<HTMLElement>(
          `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
            annotationKey,
          )}]`,
        ) as HTMLElement;
        return {
          quote:
            card.querySelector<HTMLElement>("blockquote")?.textContent.trim() ??
            "",
          lock: card
            .querySelector<HTMLElement>(".zt-annot-lock")!
            .getAttribute("aria-label"),
        };
      },
      { annotationKey },
    ),
  ).toEqual({
    quote: QUOTED_TEXT,
    lock: m.annot_view_lock_label({ reason }),
  });

  await selectCardAlone();

  const buttonByLabel = (label: string) =>
    `[role=button][aria-label=${JSON.stringify(label)}]`;
  const cardVerbs = {
    "Edit quoted text": buttonByLabel(m.annot_view_menu_edit_text()),
    comment: ".zt-annot-comment-field",
    colour: buttonByLabel(m.annot_view_card_color()),
    tags: buttonByLabel(m.annot_view_card_add_tags()),
  };

  for (const [verb, node] of Object.entries(cardVerbs)) {
    expect(await dimmed(node), `${verb} is not dimmed`).toBe("true");
    await clearNotices(vaultId);
    await obRun(
      vaultId,
      async ({ app, page }, { annotationKey, node, verb }) => {
        const { press } = page;
        press(
          (
            app.workspace.getLeavesOfType(
              "zotero-annotation-view",
            ) as AnnotationLeaf[]
          )[0]?.view?.containerEl
            .querySelector<HTMLElement>(
              `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
                annotationKey,
              )}]`,
            )!
            .querySelector<HTMLElement>(node),
          verb,
        );
      },
      { annotationKey, node, verb },
    );
    await obRunUntil(
      vaultId,
      async ({ page }, { reason }) => {
        return page
          .windowDocuments()
          .flatMap((doc) => [...doc.querySelectorAll<HTMLElement>(".notice")])
          .filter((node) => node.textContent.includes(reason)).length;
      },
      { reason },
      {
        ready: (value) => value === 1,
        what: "the lock notice naming the Lock Reason to appear once",
      },
    );
    expect(
      await obRun(
        vaultId,
        async ({ page }, { reason }) => {
          return page
            .windowDocuments()
            .flatMap((doc) => [...doc.querySelectorAll<HTMLElement>(".notice")])
            .filter((node) => node.textContent.includes(reason))[0]!
            .querySelectorAll<HTMLButtonElement>("button").length;
        },
        { reason },
      ),
      `a press on ${verb} offers a button`,
    ).toBe(0);
  }
  expect(
    await obRun(
      vaultId,
      async ({ app }, { annotationKey }) => {
        const card = app.workspace
          .getLeavesOfType("zotero-annotation-view")[0]
          ?.view?.containerEl.querySelector<HTMLElement>(
            `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
              annotationKey,
            )}]`,
          );
        if (!card) throw new Error("no annotation card");
        return !!card.querySelector<HTMLElement>(".cm-content, input");
      },
      { annotationKey },
    ),
  ).toBe(false);

  await clearNotices(vaultId);
  await obRun(
    vaultId,
    async ({ app, page }, { annotationKey }) => {
      const { press } = page;
      const card = (
        app.workspace.getLeavesOfType(
          "zotero-annotation-view",
        ) as AnnotationLeaf[]
      )[0]?.view?.containerEl.querySelector<HTMLElement>(
        `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
          annotationKey,
        )}]`,
      );
      if (!card) throw new Error("no annotation card");
      press(
        card.querySelector<HTMLElement>(
          ".clickable-icon:has(svg.lucide-more-horizontal)",
        ),
        "card menu",
      );
    },
    { annotationKey },
  );

  await obRunUntil(
    vaultId,
    async (_context, { menuItemLabel }) => {
      return !![
        ...document.querySelectorAll<HTMLElement>(".menu .menu-item"),
      ].find((node) => node.textContent.trim() === menuItemLabel);
    },
    { menuItemLabel: m.annot_view_menu_delete() },
    { what: "the lock menu item to appear in the open menu" },
  );
  await obRun(
    vaultId,
    async ({ page }, { menuItemLabel }) => {
      const { press } = page;
      press(
        [...document.querySelectorAll<HTMLElement>(".menu .menu-item")].find(
          (node) => node.textContent.trim() === menuItemLabel,
        ),
        "delete entry",
      );
    },
    { menuItemLabel: m.annot_view_menu_delete() },
  );
  await obRunUntil(
    vaultId,
    async ({ page }, { reason }) => {
      return page
        .windowDocuments()
        .flatMap((doc) => [...doc.querySelectorAll<HTMLElement>(".notice")])
        .filter((node) => node.textContent.includes(reason)).length;
    },
    { reason },
    {
      ready: (value) => value === 1,
      what: "the second lock notice naming the Lock Reason to appear",
    },
  );
  expect(
    await obRun(
      vaultId,
      async ({ page }, { reason }) => {
        return {
          buttons: page
            .windowDocuments()
            .flatMap((doc) => [...doc.querySelectorAll<HTMLElement>(".notice")])
            .filter((node) => node.textContent.includes(reason))[0]!
            .querySelectorAll<HTMLButtonElement>("button").length,
          modals: document.querySelectorAll<HTMLElement>(".modal").length,
        };
      },
      { reason },
    ),
  ).toEqual({ buttons: 0, modals: 0 });
  await obRun(
    vaultId,
    async (_context) => {
      document.body.dispatchEvent(
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
    vaultId,
    async (_context) => {
      return document.querySelectorAll<HTMLElement>(".menu").length;
    },
    undefined,
    { ready: (value) => value === 0, what: "the open menus to close" },
  );

  await reopenPdfView(vaultId, attachmentPath);

  await obRunUntil(
    vaultId,
    async ({ page }, { attachmentPath, annotationKey }) => {
      const rect = page
        .pdfView(attachmentPath)
        ?.containerEl.querySelector<HTMLElement>(
          `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(
            annotationKey,
          )}]`,
        )
        ?.getBoundingClientRect();
      return !!rect && rect.width > 0;
    },
    { attachmentPath, annotationKey },
    {
      what: "the PDF annotation mark for the locked annotation to have a width",
    },
  );
  await obRun(
    vaultId,
    async ({ page }, { attachmentPath, annotationKey }) => {
      const { tap } = page;
      const mark = page
        .pdfView(attachmentPath)
        ?.containerEl.querySelector<HTMLElement>(
          `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(
            annotationKey,
          )}]`,
        );
      if (!mark) throw new Error("no PDF annotation mark");
      const rect = mark.getBoundingClientRect();
      tap(rect.left + rect.width / 2, rect.top + rect.height / 2);
    },
    { attachmentPath, annotationKey },
  );
  await obRunUntil(
    vaultId,
    async ({ page }, { attachmentPath, annotationKey }) => {
      const mark = page
        .pdfView(attachmentPath)
        ?.containerEl.querySelector<HTMLElement>(
          `.zt-pdf-annotation-mark[data-zotero-annotation-key=${JSON.stringify(
            annotationKey,
          )}]`,
        );
      if (!mark) throw new Error("no PDF annotation mark");
      return (
        !!document.querySelector<HTMLElement>(".zt-pdf-mark-popup")! &&
        mark.classList.contains("is-selected")
      );
    },
    { attachmentPath, annotationKey },
    { what: "the PDF mark popup to open with the annotation mark selected" },
  );
  expect(
    await obRun(
      vaultId,
      async (_context) => {
        const popup =
          document.querySelector<HTMLElement>(".zt-pdf-mark-popup")!;
        const verbs: Record<
          string,
          { dimmed: boolean; tooltip: string | null }
        > = {};
        for (const id of ["color", "tags", "delete"]) {
          const node = popup.querySelector<HTMLElement>(
            `[data-zt-verb=${id}]`,
          )!;
          verbs[id] = {
            dimmed: node?.getAttribute("aria-disabled") === "true",
            tooltip: node?.getAttribute("aria-label") ?? null,
          };
        }
        return verbs;
      },
      undefined,
    ),
  ).toEqual({
    color: { dimmed: true, tooltip: reason },
    tags: { dimmed: true, tooltip: reason },
    delete: { dimmed: true, tooltip: reason },
  });
  expect(
    await obRun(
      vaultId,
      async ({ page }, { attachmentPath }) => {
        return page
          .pdfView(attachmentPath)!
          .containerEl.querySelectorAll<HTMLElement>(
            ".zt-pdf-annotation-handle",
          ).length;
      },
      { attachmentPath },
    ),
  ).toBe(0);
  for (const verb of ["color", "tags", "delete"]) {
    await clearNotices(vaultId);
    await obRun(
      vaultId,
      async ({ page }, { verb }) => {
        const { press } = page;
        press(
          document.querySelector<HTMLElement>(
            `.zt-pdf-mark-popup [data-zt-verb=${JSON.stringify(verb)}]`,
          ),
          `popup ${verb}`,
        );
      },
      { verb },
    );
    await settledGesture(vaultId, attachmentPath);
    expect(
      await obRun(
        vaultId,
        async (_context) => {
          return {
            popup: !!document.querySelector<HTMLElement>(".zt-pdf-mark-popup")!,
            menus: document.querySelectorAll<HTMLElement>(".menu").length,
            modals: document.querySelectorAll<HTMLElement>(".modal").length,
            tagSection: !!document.querySelector<HTMLElement>(
              ".zt-pdf-mark-popup input",
            )!,
            notices: document.querySelectorAll<HTMLElement>(".notice").length,
          };
        },
        undefined,
      ),
      `a press on the popup's ${verb} verb ran`,
    ).toEqual({
      popup: true,
      menus: 0,
      modals: 0,
      tagSection: false,
      notices: 0,
    });
  }

  expect(
    await obRun(
      vaultId,
      async ({ app }) => {
        const leaf = (
          app.workspace.getLeavesOfType(
            "zotero-annotation-view",
          ) as AnnotationLeaf[]
        )[0]!;
        if (!leaf) return false;
        leaf.view.gestures!.onPinCurrentItem();
        app.workspace.moveLeafToPopout(leaf);
        return true;
      },
      undefined,
    ),
  ).toBe(true);
  cleanup.defer(async () => {
    await obRun(
      vaultId,
      async ({ app }) => {
        for (const leaf of app.workspace.getLeavesOfType(
          "zotero-annotation-view",
        ) as AnnotationLeaf[])
          if (leaf.view.containerEl.win !== window) leaf.detach();
      },
      undefined,
    );
  });
  await obRunUntil(
    vaultId,
    async ({ app }, { annotationKey }) => {
      const card = (
        app.workspace.getLeavesOfType(
          "zotero-annotation-view",
        ) as AnnotationLeaf[]
      )[0]?.view?.containerEl.querySelector<HTMLElement>(
        `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
          annotationKey,
        )}]`,
      );
      return (
        !!card &&
        card.win !== window &&
        !!card.querySelector<HTMLElement>(".zt-annot-lock")!
      );
    },
    { annotationKey },
    { what: "the lock icon on the annotation card in the detached window" },
  );
  expect(
    await obRun(
      vaultId,
      async ({ app }, { annotationKey }) => {
        const card = app.workspace
          .getLeavesOfType("zotero-annotation-view")[0]
          ?.view?.containerEl.querySelector<HTMLElement>(
            `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
              annotationKey,
            )}]`,
          );
        if (!card) throw new Error("no annotation card");
        return card
          .querySelector<HTMLElement>(".zt-annot-lock")!
          .getAttribute("aria-label");
      },
      { annotationKey },
    ),
  ).toBe(m.annot_view_lock_label({ reason }));
  await selectCardAlone();
  expect(
    await dimmed(cardVerbs.colour),
    "colour is not dimmed in the pop-out window",
  ).toBe("true");
  await clearNotices(vaultId);
  await obRun(
    vaultId,
    async ({ app, page }, { annotationKey, colour }) => {
      const { press } = page;
      press(
        (
          app.workspace.getLeavesOfType(
            "zotero-annotation-view",
          ) as AnnotationLeaf[]
        )[0]?.view?.containerEl
          .querySelector<HTMLElement>(
            `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(
              annotationKey,
            )}]`,
          )!
          .querySelector<HTMLElement>(colour),
        "colour",
      );
    },
    { annotationKey, colour: cardVerbs.colour },
  );
  await obRunUntil(
    vaultId,
    async ({ page }, { reason }) => {
      return page
        .windowDocuments()
        .flatMap((doc) => [...doc.querySelectorAll<HTMLElement>(".notice")])
        .filter((node) => node.textContent.includes(reason)).length;
    },
    { reason },
    {
      ready: (value) => value === 1,
      what: "the lock notice naming the Lock Reason after the detached window press",
    },
  );
  expect(
    await obRun(
      vaultId,
      async ({ page }, { reason }) => {
        return {
          buttons: page
            .windowDocuments()
            .flatMap((doc) => [...doc.querySelectorAll<HTMLElement>(".notice")])
            .filter((node) => node.textContent.includes(reason))[0]!
            .querySelectorAll<HTMLButtonElement>("button").length,
          menus: page
            .windowDocuments()
            .reduce(
              (count, doc) =>
                count + doc.querySelectorAll<HTMLElement>(".menu").length,
              0,
            ),
        };
      },
      { reason },
    ),
  ).toEqual({ buttons: 0, menus: 0 });

  expect(await readHeldAnnotation()).toEqual(imported);
}
