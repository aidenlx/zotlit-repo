import type { FileSystemAdapter } from "obsidian";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";

import { ANNOTATIONS } from "@zotlit/scripts/fixture";

import { obRun, obRunUntil, waitFor } from "./obsidian-cli.ts";
import type { PairedScope } from "./page-paired-types.ts";
import {
  ATTACHMENT_ITEM,
  api,
  attachment,
  attachmentPath,
  closeZoteroReader,
  debuggerPort,
  digestAttachmentPdf,
  openZoteroReader,
  prepareAuthorizationFixture,
  restorePairedFixture,
  restoreWriteOutcomeProbe,
  SEEDED_KEYS,
  serverID,
  setLocalApi,
  vaultId,
} from "./paired-run-fixture.ts";
import type { ZoteroRdp } from "./paired-zotero.ts";
import {
  eraseAnnotations,
  heldAnnotationKeys,
  openZoteroRdp,
  readerAnnotation,
  readerSettled,
  zoteroFetch,
} from "./paired-zotero.ts";
import {
  openPdfWithAnnotationView,
  settledGesture,
} from "./reader-gestures.ts";

export let rdp: ZoteroRdp;

export let readerTabID = "";

let pdfDigestBefore = "";

export let cleanup: AsyncDisposableStack;

export function setReaderTabID(tabID: string): void {
  readerTabID = tabID;
}

export function registerPairedReaderSession(): void {
  beforeAll(async () => {
    cleanup = new AsyncDisposableStack();
    rdp = cleanup.use(await openZoteroRdp(debuggerPort!));
    await prepareAuthorizationFixture();
    pdfDigestBefore = await digestAttachmentPdf();
    expect(pdfDigestBefore).toHaveLength(64);
    await eraseAnnotations(rdp, await madeSince(SEEDED_KEYS));
    readerTabID = await openZoteroReader(rdp);
    cleanup.defer(async () => {
      await closeZoteroReader(rdp, readerTabID);
    });

    await openPdfWithAnnotationView(vaultId!, { attachmentPath, cleanup });

    let resolution: { kind: string; attachmentKey?: string } | undefined;
    await waitFor(async () => {
      resolution = await obRun(
        vaultId!,
        async (
          { app, zotlit },
          { attachmentPath }: { attachmentPath: string },
        ) => {
          return ((z) =>
            z.bridge.runSync(
              z.attachmentResolver.resolve(
                (app.vault.adapter as FileSystemAdapter).getFullPath(
                  attachmentPath,
                ),
              ),
            ))(zotlit.services);
        },
        { attachmentPath },
      ).catch(() => resolution);
      return resolution !== undefined && resolution.kind !== "pending";
    });
    expect(
      resolution,
      "the Fixture PDF does not resolve inside the run's vault",
    ).toMatchObject({ kind: "resolved", attachmentKey: attachment.key });
    expect(
      await obRun(
        vaultId!,
        async ({ zotlit }) => {
          return zotlit.services.bridge.runSync(
            zotlit.services.localServer.available,
          );
        },
        undefined,
      ),
      "Live Updates is not listening; a Zotero-side edit cannot reach Obsidian",
    ).toBe(true);

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
        what: "the Annotation Source for the attachment to be the Zotero Local API",
      },
    );
  }, 120000);

  afterEach(async () => {
    await restoreWriteOutcomeProbe(vaultId!);
  });

  afterAll(async () => {
    try {
      await cleanup.disposeAsync();
    } finally {
      await restorePairedFixture();
    }
  }, 120000);
}

export function registerPdfUnchangedCase(): void {
  it("leaves the Attachment's PDF byte-identical", async () => {
    expect(await digestAttachmentPdf()).toBe(pdfDigestBefore);
  });
}

export const annotationKeys = () => heldAnnotationKeys(rdp, ATTACHMENT_ITEM);

export const madeSince = async (held: readonly string[]) =>
  (await annotationKeys()).filter((key) => !held.includes(key));

interface StoredMark {
  version: number;
  data: {
    annotationPosition: string;
    annotationSortIndex: string;
    annotationText?: string;
  };
}

export function seededMark(
  annotationKey: string,
  { image }: { image: boolean },
) {
  const path = `users/0/items/${annotationKey}`;
  const seeded = ANNOTATIONS.find(({ key }) => key === annotationKey)!;
  const seed = {
    annotationPosition: JSON.stringify(seeded.position),
    annotationSortIndex: seeded.sortIndex,
    ...(seeded.text !== null && { annotationText: seeded.text }),
  };
  const where = () => ({
    rdp,
    attachmentKey: attachment.key,
    annotationKey,
  });
  const stored = async (): Promise<StoredMark> =>
    (await (
      await zoteroFetch(api, path, {
        headers: { "Zotero-Server-ID": serverID },
      })
    ).json()) as StoredMark;
  const settled = () => readerSettled(where(), { api, serverID, image });
  return {
    seeded,
    seed,
    stored,
    settled,
    held: () => readerAnnotation(where()),
    restore: async (): Promise<void> => {
      await settled();
      const current = await stored();
      const drifted = Object.entries(seed).some(
        ([field, value]) =>
          current.data[field as keyof StoredMark["data"]] !== value,
      );
      if (drifted) {
        const apiKey = await obRun(
          vaultId!,
          async ({ app }) => {
            return JSON.parse(
              app.secretStorage.getSecret("zotlit-zotero-write-authorization")!,
            ).key;
          },
          undefined,
        );
        const restored = await zoteroFetch(api, path, {
          method: "PATCH",
          headers: {
            "Zotero-Server-ID": serverID,
            "Zotero-API-Key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ version: current.version, ...seed }),
        });
        // oxlint-disable-next-line vitest/no-conditional-expect -- only a Reader that rewrote the seed in the live Zotero needs the restoring PATCH; the unconditional check below proves the seed is back either way.
        expect(restored.status).toBe(204);
        await settled();
      }
      expect((await stored()).data).toMatchObject(seed);
      await obRun(
        vaultId!,
        async ({ zotlit }, { attachmentKey }: { attachmentKey: string }) => {
          await zotlit.services.bridge.runPromise(
            zotlit.services.annotationRepository.refresh(attachmentKey),
          );
        },
        { attachmentKey: attachment.key },
      );
    },
  };
}

export const pressKey = (key: string, modifiers: Record<string, boolean>) =>
  obRun(
    vaultId!,
    async (
      { page: pageHelpers },
      {
        keyName,
        modifiers,
        attachmentPath,
      }: {
        keyName: string;
        modifiers: Record<string, boolean>;
        attachmentPath: string;
      },
    ) => {
      const event = new KeyboardEvent("keydown", {
        key: keyName,
        ...modifiers,
        bubbles: true,
        cancelable: true,
      });
      pageHelpers.pdfView(attachmentPath)!.containerEl.dispatchEvent(event);
      return { prevented: event.defaultPrevented };
    },
    { keyName: key, modifiers, attachmentPath },
  );

const pressChord = (
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
      { page: pageHelpers },
      {
        keyName,
        modifierState,
        attachmentPath,
      }: {
        keyName: string;
        modifierState: {
          ctrlKey?: boolean;
          metaKey?: boolean;
          shiftKey?: boolean;
        };
        attachmentPath: string;
      },
    ) => {
      const event = new KeyboardEvent("keydown", {
        key: keyName,
        ...modifierState,
        bubbles: true,
        cancelable: true,
      });
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
        (pageHelpers.pdfView(attachmentPath)!.scope! as PairedScope).handleKey(
          event,
          context,
        ) === false;
      return { handled };
    },
    { keyName: key, modifierState: modifiers, attachmentPath },
  );

export const poll = { timeout: 10_000, interval: 250 };

export const platformKey =
  process.platform === "darwin" ? "metaKey" : "ctrlKey";

export const undoKey = () => pressChord("z", { [platformKey]: true });

export const redoKey = () =>
  pressChord("z", { [platformKey]: true, shiftKey: true });

export const stepSettled = () =>
  obRun(
    vaultId!,
    async ({ zotlit }) => {
      const services = zotlit.services;
      await Promise.all(
        services.bridge
          .runSync(services.pdfAnnotationEditor.bindings)
          .map((binding) => binding.stepped),
      );
      return "stepped";
    },
    undefined,
  );

export const whileEditingNotLive = async (gesture: () => Promise<void>) => {
  {
    await using restoreLocalApi = new AsyncDisposableStack();
    restoreLocalApi.defer(async () => {
      await setLocalApi(rdp, true);
    });
    await setLocalApi(rdp, false);
    await obRunUntil(
      vaultId!,
      async ({ zotlit }, { attachmentKey }: { attachmentKey: string }) => {
        const { annotationRepository: repository, bridge } = zotlit.services;
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

    await gesture();
    await settledGesture(vaultId!, attachmentPath);
  }
  await obRunUntil(
    vaultId!,
    async ({ zotlit }, { attachmentKey }: { attachmentKey: string }) => {
      const { annotationRepository: repository, bridge } = zotlit.services;
      await bridge.runPromise(repository.probe);
      return bridge.runSync(repository.capabilityFor(attachmentKey)).kind;
    },
    { attachmentKey: attachment.key },
    {
      ready: (value) => value === "writable",
      what: "the attachment's annotation capability to report writable",
    },
  );
};
