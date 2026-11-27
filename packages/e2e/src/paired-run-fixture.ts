import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { afterAll, beforeAll, expect, inject } from "vitest";

import { ANNOTATIONS, ATTACHMENTS } from "@zotlit/scripts/fixture";

import { prepareRunWindow } from "./background-throttling.ts";
import { obRun, obRunUntil } from "./obsidian-cli.ts";
import type {} from "./paired-setup.ts";
import type { ZoteroRdp } from "./paired-zotero.ts";
import {
  eraseAnnotations,
  grantRememberedKey,
  heldAnnotationKeys,
  openZoteroRdp,
  readServerID,
  restorePrompt,
  zoteroFetch,
} from "./paired-zotero.ts";
import { registerRunVaultGuard } from "./run-vault-guard.ts";

export const effectPath = createRequire(
  join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "apps",
    "obsidian",
    "package.json",
  ),
).resolve("effect");

export const attachment = ATTACHMENTS.find(({ key }) => key === "RGRPDF24")!;

export const attachmentPath = attachment.path!;

export const seededAnnotation = ANNOTATIONS.find(
  ({ parentItemID }) => parentItemID === attachment.itemID,
)!;

export const SEEDED_KEYS = ANNOTATIONS.map(({ key }) => key);

export const APP_NAME = "ZotLit End-to-end Run";

export const environment = inject("pairedEnvironment");

export const vaultId = environment?.vaultId ?? null;

export const baseUrl = environment?.baseUrl ?? null;

export const debuggerPort = environment?.debuggerPort ?? null;

export const api = baseUrl!;

export let serverID = "";

export let authorizationFixture: { secret: string; rdp: ZoteroRdp } | undefined;

export let m: typeof import("@zotlit/plugin-messages/messages.ts");

export function registerPairedRun(): void {
  registerRunVaultGuard(() => vaultId!, { leftovers: false });

  beforeAll(async () => {
    m = await import("@zotlit/plugin-messages/messages.ts");
    serverID = await readServerID(api);
    authorizationFixture = {
      secret: await obRun(
        vaultId!,
        async ({ app }) => {
          return app.secretStorage.getSecret(
            "zotlit-zotero-write-authorization",
          )!;
        },
        undefined,
      ),
      rdp: await openZoteroRdp(debuggerPort!),
    };
  });

  beforeAll(async () => {
    await prepareRunWindow(vaultId!);
    await obRun(vaultId!, async ({ page }) => {
      await page.reader.setTakeover(false);
    });
  });

  afterAll(() => {
    authorizationFixture?.rdp[Symbol.dispose]();
  });
}

export const prepareAuthorizationFixture = async (): Promise<void> => {
  if (!authorizationFixture) return;
  const { secret, rdp } = authorizationFixture;
  await restorePrompt(rdp);
  const key = await grantRememberedKey(api, rdp, {
    serverID,
    appName: "ZotLit Fixture",
  });
  await obRun(
    vaultId!,
    async (
      { app },
      { secret, keyName }: { secret: string; keyName: string },
    ) => {
      const record = JSON.parse(secret);
      record.key = keyName;
      app.secretStorage.setSecret(
        "zotlit-zotero-write-authorization",
        JSON.stringify(record),
      );
    },
    { secret, keyName: key },
  );
};

export async function digestAttachmentPdf(): Promise<string> {
  const file = join(environment!.vaultPath, attachmentPath);
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

export async function restoreAnnotationComment(
  api: string,
  options: {
    serverID: string;
    key: string;
    annotationKey: string;
    comment: string;
  },
): Promise<void> {
  const path = `users/0/items/${options.annotationKey}`;
  const current = await zoteroFetch(api, path, {
    headers: { "Zotero-Server-ID": options.serverID },
  });
  const { version } = (await current.json()) as { version: number };
  const reverted = await zoteroFetch(api, path, {
    method: "PATCH",
    headers: {
      "Zotero-Server-ID": options.serverID,
      "Zotero-API-Key": options.key,
      "Content-Type": "application/json",
      "If-Unmodified-Since-Version": String(version),
    },
    body: JSON.stringify({ annotationComment: options.comment }),
  });
  expect(reverted.status).toBe(204);
}

export function readerAnnotationColor(
  rdp: ZoteroRdp,
  key: string,
  color: string,
): Promise<boolean> {
  return rdp.json<boolean>(`(() => {
    const attachment = ${ATTACHMENT_ITEM};
    const reader = Zotero.Reader._readers.find(
      (candidate) => candidate.itemID === attachment.id,
    );
    if (!reader) return false;
    return reader._item
      .getAnnotations()
      .some(
        (annotation) =>
          annotation.key === ${JSON.stringify(key)} &&
          annotation.annotationColor === ${JSON.stringify(color)},
      );
  })()`);
}

export async function annotationColor(
  api: string,
  serverID: string,
  key: string,
): Promise<string | null> {
  const reply = await zoteroFetch(api, `users/0/items/${key}`, {
    headers: { "Zotero-Server-ID": serverID },
  });
  if (reply.status !== 200) return null;
  const record = (await reply.json()) as {
    data: { annotationColor?: string };
  };
  return record.data.annotationColor ?? null;
}

export async function restoreWriteOutcomeProbe(vaultId: string): Promise<void> {
  await obRun(
    vaultId,
    async ({ page: pageHelpers }) => {
      const probe = pageHelpers.scratch.__zotlitWriteOutcomeProbe;
      if (!probe) return "clean";
      try {
        probe.release?.();
        await probe.pending;
      } finally {
        probe.api.authorizedSend = probe.authorizedSend;
        probe.api.listAnnotations = probe.listAnnotations;
        delete pageHelpers.scratch.__zotlitWriteOutcomeProbe;
      }
      return "restored";
    },
    undefined,
  );
}

export const ATTACHMENT_ITEM = `Zotero.Items.getByLibraryAndKey(
  Zotero.Libraries.userLibraryID,
  ${JSON.stringify(attachment.key)},
)`;

export function isZoteroReaderOpen(rdp: ZoteroRdp): Promise<boolean> {
  return rdp.json<boolean>(`Zotero.Reader._readers.some(
    (candidate) => candidate.itemID === ${ATTACHMENT_ITEM}.id,
  )`);
}

export function openZoteroReader(rdp: ZoteroRdp): Promise<string> {
  return rdp.json<string>(`(async () => {
    const reader = await Zotero.Reader.open(${ATTACHMENT_ITEM}.id);
    return reader.tabID;
  })()`);
}

export function closeZoteroReader(
  rdp: ZoteroRdp,
  tabID: string,
): Promise<string> {
  return rdp.json<string>(`(() => {
    Zotero.Reader.getByTabID(${JSON.stringify(tabID)})?.close();
    return "closed";
  })()`);
}

export function readerHoldsAnnotation(
  rdp: ZoteroRdp,
  key: string,
): Promise<boolean> {
  return rdp.json<boolean>(`(() => {
    const attachment = ${ATTACHMENT_ITEM};
    const reader = Zotero.Reader._readers.find(
      (candidate) => candidate.itemID === attachment.id,
    );
    if (!reader) return false;
    // The reader's own item answers the serialized Annotations it renders
    // from, each carrying its key — the set the Reader draws, not a database
    // query standing in for it.
    return reader._item
      .getAnnotations()
      .some((annotation) => annotation.key === ${JSON.stringify(key)});
  })()`);
}

export async function restorePairedFixture(): Promise<void> {
  const { rdp } = authorizationFixture!;
  await closeZoteroReaders(rdp);
  await setLocalApi(rdp, true);
  const held = await heldAnnotationKeys(rdp, ATTACHMENT_ITEM);
  await eraseAnnotations(
    rdp,
    held.filter((key) => !SEEDED_KEYS.includes(key)),
  );
  await prepareAuthorizationFixture();
}

function closeZoteroReaders(rdp: ZoteroRdp): Promise<number> {
  return rdp.json<number>(`(async () => {
    for (const reader of [...Zotero.Reader._readers]) reader.close();
    for (let i = 0; i < 100 && Zotero.Reader._readers.length > 0; i++)
      await Zotero.Promise.delay(50);
    return Zotero.Reader._readers.length;
  })()`);
}

export function setLocalApi(rdp: ZoteroRdp, enabled: boolean): Promise<string> {
  return rdp.json<string>(`(() => {
    Zotero.Prefs.set("httpServer.localAPI.enabled", ${String(enabled)});
    return "set";
  })()`);
}

export interface WireTag {
  tag: string;
  type?: number;
}

export function spelledTags(tags: readonly WireTag[]): string[] {
  return tags.map(({ tag, type }) => `${tag}:${type ?? 0}`).toSorted();
}

export async function annotationTags(
  api: string,
  serverID: string,
  annotationKey: string,
): Promise<string[]> {
  const reply = await zoteroFetch(api, `users/0/items/${annotationKey}`, {
    headers: { "Zotero-Server-ID": serverID },
  });
  expect(reply.status).toBe(200);
  const record = (await reply.json()) as { data: { tags: WireTag[] } };
  return spelledTags(record.data.tags);
}

export async function setAnnotationTags(
  rdp: ZoteroRdp,
  annotationKey: string,
  tags: readonly WireTag[],
): Promise<void> {
  await rdp.json(`(async () => {
    const item = Zotero.Items.getByLibraryAndKey(
      Zotero.Libraries.userLibraryID,
      ${JSON.stringify(annotationKey)},
    );
    item.setTags(${JSON.stringify(tags)});
    await item.saveTx();
    return "saved";
  })()`);
  await obRunUntil(
    vaultId!,
    async (
      { zotlit },
      {
        attachmentKey,
        annotationKey,
      }: { attachmentKey: string; annotationKey: string },
    ) => {
      const { annotationRepository: repository, bridge } = zotlit.services;
      const list = await bridge.runPromise(repository.refresh(attachmentKey));
      const record = list?.annotations.find(
        (annotation) => annotation.key === annotationKey,
      );
      return (record?.tagDetails ?? [])
        .map(({ name, type }) => `${name}:${type}`)
        .toSorted();
    },
    { attachmentKey: attachment.key, annotationKey },
    {
      ready: (value) => isDeepStrictEqual(value, spelledTags(tags)),
      what: "the stored tags on the annotation to match the spelled tag set",
    },
  );
}

export function cardTagEditor(annotationKey: string) {
  return {
    ...tagEditorIn({ kind: "card", annotationKey }),
    press: (target: string) =>
      obRunUntil(
        vaultId!,
        async (
          { app, page: pageHelpers },
          {
            annotationKey,
            selector,
          }: { annotationKey: string; selector: string },
        ) => {
          const { press } = pageHelpers;
          const target = app.workspace
            .getLeavesOfType("zotero-annotation-view")
            .map((leaf) =>
              leaf.view.containerEl.querySelector<HTMLElement>(
                `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(annotationKey)}]`,
              ),
            )
            .find(Boolean)
            ?.querySelector<HTMLElement>(selector);
          if (!target) return "absent";
          press(target, selector);
          return "pressed";
        },
        { annotationKey, selector: target },
        {
          ready: (value) => value === "pressed",
          what: "the control matching the selector inside the annotation card to press",
        },
      ),
    toggle: ".clickable-icon:has(svg.lucide-tag)",
    cardTags: () =>
      obRun(
        vaultId!,
        async ({ app }, { annotationKey }: { annotationKey: string }) => {
          return [
            ...(app.workspace
              .getLeavesOfType("zotero-annotation-view")
              .map((leaf) =>
                leaf.view.containerEl.querySelector<HTMLElement>(
                  `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(annotationKey)}]`,
                ),
              )
              .find(Boolean)
              ?.querySelectorAll<HTMLElement>("[aria-pressed]") ?? []),
          ].map((chip) => chip.textContent);
        },
        { annotationKey },
      ),
  };
}

export function tagEditorIn(
  root: { kind: "popup" } | { kind: "card"; annotationKey: string },
) {
  return {
    editorReady: () =>
      obRunUntil(
        vaultId!,
        async (
          { app },
          {
            root,
          }: {
            root: { kind: "popup" } | { kind: "card"; annotationKey: string };
          },
        ) => {
          return !!(
            root.kind === "popup"
              ? document.querySelector<HTMLElement>(
                  ".zt-pdf-mark-popup [data-zt-section=tags]",
                )
              : app.workspace
                  .getLeavesOfType("zotero-annotation-view")
                  .map((leaf) =>
                    leaf.view.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key="${root.annotationKey}"]`,
                    ),
                  )
                  .find(Boolean)
          )?.querySelector<HTMLInputElement>(
            ".zt-annot-tag-input:not([readonly])",
          );
        },
        { root },
        {
          what: "the editable tag input in the PDF mark popup or annotation card",
        },
      ),
    editorChips: () =>
      obRun(
        vaultId!,
        async (
          { app },
          {
            root,
          }: {
            root: { kind: "popup" } | { kind: "card"; annotationKey: string };
          },
        ) => {
          return [
            ...((root.kind === "popup"
              ? document.querySelector<HTMLElement>(
                  ".zt-pdf-mark-popup [data-zt-section=tags]",
                )
              : app.workspace
                  .getLeavesOfType("zotero-annotation-view")
                  .map((leaf) =>
                    leaf.view.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key="${root.annotationKey}"]`,
                    ),
                  )
                  .find(Boolean)
            )?.querySelectorAll<HTMLInputElement>(
              "[data-slot=tags-input-item-text]",
            ) ?? []),
          ].map((chip) => chip.textContent);
        },
        { root },
      ),
    type: (text: string, { enter }: { enter: boolean }) =>
      obRun(
        vaultId!,
        async (
          { app },
          {
            root,
            text,
            enter,
          }: {
            root: { kind: "popup" } | { kind: "card"; annotationKey: string };
            text: string;
            enter: boolean;
          },
        ) => {
          const field = (
            root.kind === "popup"
              ? document.querySelector<HTMLElement>(
                  ".zt-pdf-mark-popup [data-zt-section=tags]",
                )
              : app.workspace
                  .getLeavesOfType("zotero-annotation-view")
                  .map((leaf) =>
                    leaf.view.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key="${root.annotationKey}"]`,
                    ),
                  )
                  .find(Boolean)
          )!.querySelector<HTMLInputElement>(".zt-annot-tag-input");
          field!.value = text;
          field!.dispatchEvent(new Event("input", { bubbles: true }));
          if (enter)
            field!.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Enter",
                bubbles: true,
                cancelable: true,
              }),
            );
          return "typed";
        },
        { root, text, enter },
      ),
    remove: (name: string) =>
      obRun(
        vaultId!,
        async (
          { app, page: pageHelpers },
          {
            root,
            name,
          }: {
            root: { kind: "popup" } | { kind: "card"; annotationKey: string };
            name: string;
          },
        ) => {
          const { press } = pageHelpers;
          const chip = [
            ...(root.kind === "popup"
              ? document.querySelector<HTMLElement>(
                  ".zt-pdf-mark-popup [data-zt-section=tags]",
                )
              : app.workspace
                  .getLeavesOfType("zotero-annotation-view")
                  .map((leaf) =>
                    leaf.view.containerEl.querySelector<HTMLElement>(
                      `.zt-annot-card[data-zotero-annotation-key="${root.annotationKey}"]`,
                    ),
                  )
                  .find(Boolean))!.querySelectorAll<HTMLInputElement>(
              "[data-slot=tags-input-item]",
            ),
          ].find(
            (item) =>
              item.querySelector<HTMLInputElement>(
                "[data-slot=tags-input-item-text]",
              )?.textContent === name,
          );
          if (!chip) return "absent";
          press(
            chip.querySelector<HTMLInputElement>(
              "[data-slot=tags-input-item-remove]",
            ),
            `remove ${name}`,
          );
          return "removed";
        },
        { root, name },
      ),
  };
}

export async function readAnnotationState(
  api: string,
  serverID: string,
  annotationKey: string,
): Promise<{ status: number; version: number | null; comment: string | null }> {
  const response = await zoteroFetch(api, `users/0/items/${annotationKey}`, {
    headers: { "Zotero-Server-ID": serverID },
  });
  if (response.status === 404) {
    return { status: 404, version: null, comment: null };
  }
  expect(response.status).toBe(200);
  const record = (await response.json()) as {
    version: number;
    data: { annotationComment?: string };
  };
  return {
    status: response.status,
    version: record.version,
    comment: record.data.annotationComment ?? "",
  };
}
