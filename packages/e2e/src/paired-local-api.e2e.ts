import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { clearNotices, obRun, obRunUntil, waitFor } from "./obsidian-cli.ts";
import {
  APP_NAME,
  ATTACHMENT_ITEM,
  api,
  attachment,
  attachmentPath,
  authorizationFixture,
  baseUrl,
  closeZoteroReader,
  debuggerPort,
  digestAttachmentPdf,
  environment,
  isZoteroReaderOpen,
  openZoteroReader,
  prepareAuthorizationFixture,
  readAnnotationState,
  registerPairedRun,
  restoreAnnotationComment,
  seededAnnotation,
  serverID,
  vaultId,
  restorePairedFixture,
} from "./paired-run-fixture.ts";
import type { ZoteroRdp } from "./paired-zotero.ts";
import {
  authorizationCount,
  authorize,
  clickAuthorizationDialog,
  denyAnyAuthorizationDialog,
  dismissAuthorizationDialog,
  eraseAnnotations,
  grantRememberedKey,
  openZoteroRdp,
  resetAuthorizations,
  restorePrompt,
  stubPrompt,
  waitForAuthorizationDialog,
  zoteroFetch,
} from "./paired-zotero.ts";
import { verifyPdfReadSource } from "./pdf-read-source.ts";
import { openPdfWithAnnotationView } from "./reader-gestures.ts";

const KEY_SHAPE = expect.stringMatching(
  /^[0-9A-Za-z]{32}$/,
) as unknown as string;

describe.skipIf(!baseUrl)("Paired Run", () => {
  registerPairedRun();

  beforeAll(restorePairedFixture, 120000);

  it("starts with Better BibTeX answering, as a Zotero that has finished starting does", async () => {
    const reply = await zoteroFetch(api, "/better-bibtex/json-rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "api.ready",
        params: [],
        id: 1,
      }),
    });
    expect(reply.status).toBe(200);
  });

  it("counts ZotLit Companion as installed, as Zotero's add-on list of the paired profile names it", async () => {
    expect(
      await obRunUntil(
        vaultId!,
        async ({ zotlit }) => {
          const { bridge, zoteroPref } = zotlit.services;
          const profile = bridge.runSync(zoteroPref.current).resolvedProfileDir;
          const listed = profile
            ? (require("node:fs") as typeof import("node:fs")).readFileSync(
                `${profile}/extensions.json`,
                "utf8",
              )
            : "";
          return {
            profile: profile !== null,
            listed: listed.includes('"zotlit@aidenlx.site"'),
            installed: await bridge.runPromise(zoteroPref.companionInstalled),
          };
        },
        undefined,
        {
          what: "ZotLit Companion in the paired profile's add-on list",
          ready: (value) => value.installed,
        },
      ),
    ).toEqual({ profile: true, listed: true, installed: true });
  });

  it("writes a PDF read back to Zotero without modifying its parent", async () => {
    const readItem = async (key: string) => {
      const reply = await zoteroFetch(api, `users/0/items/${key}`);
      expect(reply.status).toBe(200);
      return (await reply.json()) as {
        version: number;
        data: { lastRead?: number; dateModified: string };
      };
    };
    const before = await readItem("RUGIER24");
    const attachmentBefore = await readItem(attachment.key);
    const saved = await obRun(
      vaultId!,
      async ({ app }) => {
        return JSON.stringify({
          layout: app.workspace.getLayout(),
          ledger: app.loadLocalStorage("zotlit-use-ledger") ?? null,
        });
      },
      undefined,
    );
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await obRun(
        vaultId!,
        async ({ app, zotlit }, { saved }: { saved: string }) => {
          await app.workspace.changeLayout(JSON.parse(saved).layout);
          app.workspace.requestActiveLeafEvents.run();
          const oldServices = zotlit.services;
          await app.plugins.disablePlugin("zotlit");
          const stillOpen = () =>
            !oldServices.bridge.closed() ||
            oldServices.bridge.runSync(oldServices.pdfAnnotationEditor.bindings)
              .length > 0;
          for (let i = 0; i < 200 && stillOpen(); i++)
            await new Promise((r) => setTimeout(r, 25));
          if (stillOpen()) throw new Error("The ZotLit services did not close");
        },
        { saved },
      );
      try {
        await authorizationFixture!.rdp.json(
          `(async()=>{const item=Zotero.Items.getByLibraryAndKey(Zotero.Libraries.userLibraryID,${JSON.stringify(attachment.key)});item.attachmentLastRead=${JSON.stringify(attachmentBefore.data.lastRead ?? null)};await item.saveTx({skipDateModifiedUpdate:true});return true;})()`,
        );
      } finally {
        await obRun(
          vaultId!,
          async ({ app }, { saved }: { saved: string }) => {
            app.saveLocalStorage("zotlit-use-ledger", JSON.parse(saved).ledger);
            await app.plugins.enablePlugin("zotlit");
          },
          { saved },
        );
      }
    });
    await obRun(
      vaultId!,
      async ({ app, zotlit, page }) => {
        app.workspace
          .getLeavesOfType(page.reader.viewType)
          .forEach((l) => l.detach());
        await zotlit.services.bridge.runPromise(
          zotlit.services.zoteroLocalApi.probe,
        );
      },
      undefined,
    );
    await clearNotices(vaultId!);
    await openPdfWithAnnotationView(vaultId!, { attachmentPath, cleanup });
    let recorded: { instant: string } | null;
    let stored = attachmentBefore;
    expect(
      await waitFor(async () => {
        recorded = await obRun(
          vaultId!,
          async ({ zotlit }) => {
            const use = zotlit.services.bridge.runSync(
              zotlit.services.useLedger.current,
            ).RUGIER24;
            return use
              ? {
                  instant: Temporal.Instant.fromEpochMilliseconds(
                    use.instant.epochMilliseconds,
                  ).toString(),
                }
              : null;
          },
          undefined,
        );
        if (!recorded) return false;
        stored = await readItem(attachment.key);
        return (
          stored.data.lastRead ===
            Math.floor(
              Temporal.Instant.from(recorded.instant).epochMilliseconds / 1000,
            ) && stored.version > attachmentBefore.version
        );
      }),
    ).toBe(true);
    expect((await readItem("RUGIER24")).data.dateModified).toBe(
      before.data.dateModified,
    );
    expect(stored.version).toBeGreaterThan(attachmentBefore.version);
    await verifyPdfReadSource(vaultId!, {
      vaultPath: environment!.vaultPath,
      api,
      cleanup,
    });
  });

  describe("Tier 1 — the Local API read contract", () => {
    it("refuses browser traffic and answers the same read when allowed", async () => {
      await expect(
        fetch(new URL("users/0/items?limit=1", api), {
          headers: { Origin: "app://obsidian.md" },
        }),
      ).rejects.toThrow();

      const allowed = await zoteroFetch(api, "users/0/items?limit=1");
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get("Zotero-Server-ID")).toBe(serverID);
    });

    it("lists the Fixture Attachment's Annotations under a stable sort", async () => {
      const keys = await annotationKeys(api, serverID, attachment.key);
      expect(keys).toContain(seededAnnotation.key);
    });

    it("serves another Attachment's Annotations for a key outside Zotero's alphabet", async () => {
      const stray = await annotationParents(api, serverID, "RGRPDF10");
      const own = await annotationParents(api, serverID, attachment.key);
      expect(new Set(stray).size).toBeGreaterThan(1);
      expect(new Set(stray)).not.toEqual(new Set(own));
      expect(stray.length).toBeGreaterThan(own.length);

      await expect(annotationKeys(api, serverID, "ZZZZZZZZ")).resolves.toEqual(
        [],
      );
    });

    it("answers 412 when the Zotero-Server-ID names another database", async () => {
      const reply = await zoteroFetch(api, "users/0/items?limit=1", {
        headers: { "Zotero-Server-ID": "AAAAAAAAAAAA" },
      });
      expect(reply.status).toBe(412);
    });
  });

  describe("Tier 2 — the authorization branches", () => {
    let rdp: ZoteroRdp;

    beforeAll(async () => {
      rdp = await openZoteroRdp(debuggerPort!);
    });

    afterEach(async () => {
      const restored = await restorePrompt(rdp);
      expect(restored).toEqual({ original: true, leftovers: [] });
      await resetAuthorizations(rdp);
    });

    afterAll(async () => {
      try {
        await prepareAuthorizationFixture();
      } finally {
        rdp[Symbol.dispose]();
      }
    });

    it("grants a one-time key for Allow", async () => {
      await resetAuthorizations(rdp);
      await stubPrompt(rdp, { allow: true, remember: false });

      const reply = await authorize(api, { serverID, appName: APP_NAME });

      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({ key: KEY_SHAPE, remember: false });
      await expect(authorizationCount(rdp)).resolves.toBe(0);
    });

    it("grants a remembered key for Always Allow", async () => {
      await resetAuthorizations(rdp);
      await stubPrompt(rdp, { allow: true, remember: true });

      const reply = await authorize(api, { serverID, appName: APP_NAME });

      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({ key: KEY_SHAPE, remember: true });
      await expect(authorizationCount(rdp)).resolves.toBe(1);
    });

    it("refuses with 403 for Deny", async () => {
      await resetAuthorizations(rdp);
      await stubPrompt(rdp, { allow: false, remember: false });

      const reply = await authorize(api, { serverID, appName: APP_NAME });

      expect(reply.status).toBe(403);
      expect(reply.body).toEqual({ denied: true });
      await expect(authorizationCount(rdp)).resolves.toBe(0);
    });

    it("answers 429 after five dialog requests in a minute", async () => {
      await resetAuthorizations(rdp);
      await stubPrompt(rdp, { allow: false, remember: false });

      for (let attempt = 0; attempt < 5; attempt++) {
        expect(
          (await authorize(api, { serverID, appName: APP_NAME })).status,
        ).toBe(403);
      }
      const limited = await authorize(api, { serverID, appName: APP_NAME });

      expect(limited.status).toBe(429);
      await expect(authorizationCount(rdp)).resolves.toBe(0);
    });

    it("keeps a request that never reaches the prompt out of the rate limit", async () => {
      await resetAuthorizations(rdp);
      await stubPrompt(rdp, { allow: true, remember: true });

      const missingServer = await zoteroFetch(api, "local/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appName: APP_NAME }),
      });
      expect(missingServer.status).toBe(428);

      const granted = await authorize(api, { serverID, appName: APP_NAME });
      expect(granted.status).toBe(200);
    });

    it("writes with a remembered key, raising no dialog", async () => {
      const key = await grantRememberedKey(api, rdp, {
        serverID,
        appName: APP_NAME,
      });

      const current = await zoteroFetch(
        api,
        `users/0/items/${seededAnnotation.key}`,
        { headers: { "Zotero-Server-ID": serverID } },
      );
      expect(current.status).toBe(200);
      const record = (await current.json()) as {
        version: number;
        data: { annotationComment?: string };
      };
      const original = record.data.annotationComment ?? "";
      await using revert = new AsyncDisposableStack();
      revert.defer(async () => {
        await restoreAnnotationComment(api, {
          serverID,
          key,
          annotationKey: seededAnnotation.key,
          comment: original,
        });
      });

      const written = await zoteroFetch(
        api,
        `users/0/items/${seededAnnotation.key}`,
        {
          method: "PATCH",
          headers: {
            "Zotero-Server-ID": serverID,
            "Zotero-API-Key": key,
            "Content-Type": "application/json",
            "If-Unmodified-Since-Version": String(record.version),
          },
          body: JSON.stringify({
            annotationComment: `${original}\nEnd-to-end Run`,
          }),
        },
      );
      expect(written.status).toBe(204);
      expect(written.headers.get("Last-Modified-Version")).not.toBeNull();
    });

    it("replaces an Annotation's whole tag list, types kept, under the version precondition", async () => {
      const key = await grantRememberedKey(api, rdp, {
        serverID,
        appName: APP_NAME,
      });
      const annotationKey = await rdp.json<string>(`(async () => {
        const attachment = ${ATTACHMENT_ITEM};
        const json = await Zotero.Annotations.toJSON(
          attachment.getAnnotations()[0],
        );
        json.key = Zotero.DataObjectUtilities.generateKey();
        delete json.tags;
        const item = await Zotero.Annotations.saveFromJSON(attachment, json);
        item.setTags([
          { tag: "probe-manual", type: 0 },
          { tag: "probe-auto", type: 1 },
          { tag: "probe-removed", type: 0 },
        ]);
        await item.saveTx();
        return item.key;
      })()`);
      await using erase = new AsyncDisposableStack();
      erase.defer(async () => {
        await eraseAnnotations(rdp, [annotationKey]);
      });
      const path = `users/0/items/${annotationKey}`;
      const readTags = async () => {
        const reply = await zoteroFetch(api, path, {
          headers: { "Zotero-Server-ID": serverID },
        });
        expect(reply.status).toBe(200);
        const record = (await reply.json()) as {
          version: number;
          data: { tags: { tag: string; type?: number }[] };
        };
        return {
          version: record.version,
          tags: record.data.tags.toSorted((a, b) => a.tag.localeCompare(b.tag)),
        };
      };
      const patchTags = (
        precondition: "body" | "header",
        version: number,
        tags: { tag: string; type: number }[],
      ) =>
        zoteroFetch(api, path, {
          method: "PATCH",
          headers: {
            "Zotero-Server-ID": serverID,
            "Zotero-API-Key": key,
            "Content-Type": "application/json",
            ...(precondition === "header" && {
              "If-Unmodified-Since-Version": String(version),
            }),
          },
          body: JSON.stringify(
            precondition === "body" ? { version, tags } : { tags },
          ),
        });

      const before = await readTags();
      expect(before.tags).toStrictEqual([
        { tag: "probe-auto", type: 1 },
        { tag: "probe-manual" },
        { tag: "probe-removed" },
      ]);

      const written = await patchTags("body", before.version, [
        { tag: "probe-manual", type: 0 },
        { tag: "probe-auto", type: 1 },
        { tag: "probe-added", type: 0 },
      ]);
      expect(written.status).toBe(204);
      const after = await readTags();
      expect(written.headers.get("Last-Modified-Version")).toBe(
        String(after.version),
      );
      expect(after.version).toBeGreaterThan(before.version);
      expect(after.tags).toStrictEqual([
        { tag: "probe-added" },
        { tag: "probe-auto", type: 1 },
        { tag: "probe-manual" },
      ]);

      const refusals = {
        body: `item version mismatch: expected ${before.version}, found ${after.version}`,
        header: `item has been modified since specified version (expected ${before.version}, found ${after.version})`,
      };
      for (const [precondition, refusal] of Object.entries(refusals)) {
        const stale = await patchTags(
          precondition as keyof typeof refusals,
          before.version,
          [{ tag: "never-stored", type: 0 }],
        );
        expect(stale.status).toBe(412);
        expect(stale.headers.get("Content-Type")).toBe("text/plain");
        expect(stale.headers.get("Last-Modified-Version")).toBeNull();
        expect(await stale.text()).toBe(refusal);
      }
      expect(await readTags()).toStrictEqual(after);
    });
  });

  describe("Tier 3 — Zotero's own dialog", () => {
    let rdp: ZoteroRdp;

    beforeAll(async () => {
      rdp = await openZoteroRdp(debuggerPort!);
    });

    afterEach(async () => {
      await denyAnyAuthorizationDialog(rdp);
      await resetAuthorizations(rdp);
    });

    afterAll(async () => {
      try {
        await prepareAuthorizationFixture();
      } finally {
        rdp[Symbol.dispose]();
      }
    });

    it("grants a one-time key when the dialog's first button is pressed", async () => {
      await resetAuthorizations(rdp);
      const pending = authorize(api, { serverID, appName: APP_NAME });

      expect(await waitForAuthorizationDialog(rdp)).toBe(true);
      await clickAuthorizationDialog(rdp, "accept");

      const reply = await pending;
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({ key: KEY_SHAPE, remember: false });
      await expect(authorizationCount(rdp)).resolves.toBe(0);
    });

    it("grants Always Allow when the dialog's second button is pressed", async () => {
      await resetAuthorizations(rdp);
      const pending = authorize(api, { serverID, appName: APP_NAME });

      expect(await waitForAuthorizationDialog(rdp)).toBe(true);
      await clickAuthorizationDialog(rdp, "cancel");

      const reply = await pending;
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({ key: KEY_SHAPE, remember: true });
      await expect(authorizationCount(rdp)).resolves.toBe(1);
    });

    it("refuses when the dialog's third button is pressed", async () => {
      await resetAuthorizations(rdp);
      const pending = authorize(api, { serverID, appName: APP_NAME });

      expect(await waitForAuthorizationDialog(rdp)).toBe(true);
      await clickAuthorizationDialog(rdp, "extra1");

      const reply = await pending;
      expect(reply.status).toBe(403);
      expect(reply.body).toEqual({ denied: true });
      await expect(authorizationCount(rdp)).resolves.toBe(0);
    });

    it("grants Always Allow when the dialog is dismissed", async () => {
      await resetAuthorizations(rdp);
      const pending = authorize(api, { serverID, appName: APP_NAME });

      expect(await waitForAuthorizationDialog(rdp)).toBe(true);
      await dismissAuthorizationDialog(rdp);

      const reply = await pending;
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({ key: KEY_SHAPE, remember: true });
      await expect(authorizationCount(rdp)).resolves.toBe(1);
    });
  });

  describe("Tier 4 — native concurrent writes", () => {
    let rdp: ZoteroRdp;
    let key = "";
    let cleanup: AsyncDisposableStack | null = null;

    beforeAll(async () => {
      const resources = new AsyncDisposableStack();
      cleanup = resources;
      rdp = resources.use(await openZoteroRdp(debuggerPort!));
      const pdfDigestBefore = await digestAttachmentPdf();
      expect(pdfDigestBefore).toHaveLength(64);
      resources.defer(async () => {
        expect(await digestAttachmentPdf()).toBe(pdfDigestBefore);
      });
      const readerWasOpen = await isZoteroReaderOpen(rdp);
      const readerTabID = await openZoteroReader(rdp);
      if (!readerWasOpen) {
        resources.defer(async () => {
          await closeZoteroReader(rdp, readerTabID);
        });
      }
      resources.defer(async () => {
        await resetAuthorizations(rdp);
      });
      await resetAuthorizations(rdp);
      resources.defer(async () => {
        await restorePrompt(rdp);
      });
      key = await grantRememberedKey(api, rdp, {
        serverID,
        appName: `${APP_NAME} concurrency`,
      });
      resources.defer(async () => {
        await eraseConcurrencyAnnotations(rdp);
      });
      resources.defer(async () => {
        await restoreConcurrencyHooks(rdp);
      });
    }, 120000);

    afterEach(async () => {
      await restoreConcurrencyHooks(rdp);
    });

    afterAll(async () => {
      try {
        await cleanup?.disposeAsync();
      } finally {
        await prepareAuthorizationFixture();
      }
    }, 120000);

    it("records whether a native PATCH loses a concurrent Reader comment", async () => {
      const annotation = await createConcurrencyAnnotation(
        rdp,
        "Concurrency PATCH baseline",
      );
      const readerComment = "Reader concurrent comment";
      const apiComment = "Local API concurrent comment";
      const paused = await pauseReaderCommentSave(
        rdp,
        annotation.key,
        readerComment,
      );
      expect(paused).toEqual({
        version: annotation.version,
        comment: readerComment,
      });

      const patched = await zoteroFetch(
        api,
        `users/0/items/${annotation.key}`,
        {
          method: "PATCH",
          headers: {
            "Zotero-Server-ID": serverID,
            "Zotero-API-Key": key,
            "Content-Type": "application/json",
            "If-Unmodified-Since-Version": String(annotation.version),
          },
          body: JSON.stringify({ annotationComment: apiComment }),
        },
      );
      expect(patched.status).toBe(204);

      const readerOutcome = await releaseReaderCommentSave(rdp, annotation.key);
      expect(readerOutcome).toEqual({ ok: true });
      const final = await readAnnotationState(api, serverID, annotation.key);

      expect(final).toMatchObject({
        status: 200,
        comment: apiComment,
      });
      expect(final.version).toBeGreaterThan(annotation.version);
      expect(final.comment).not.toBe(readerComment);
      console.info("Native PATCH concurrency evidence", {
        initialVersion: annotation.version,
        apiStatus: patched.status,
        readerOutcome,
        final,
        readerComment,
        apiComment,
      });
    }, 120000);

    it("records whether DELETE honors a Reader change after its version check", async () => {
      const annotation = await createConcurrencyAnnotation(
        rdp,
        "Concurrency DELETE baseline",
      );
      const readerComment = "Reader comment before paused delete";
      await pauseAnnotationErase(rdp, annotation.key);

      const deleting = zoteroFetch(api, `users/0/items/${annotation.key}`, {
        method: "DELETE",
        headers: {
          "Zotero-Server-ID": serverID,
          "Zotero-API-Key": key,
          "If-Unmodified-Since-Version": String(annotation.version),
        },
      });
      expect(
        await waitFor(() => annotationErasePaused(rdp, annotation.key)),
      ).toBe(true);

      await saveReaderComment(rdp, annotation.key, readerComment);
      let afterReader = await readAnnotationState(
        api,
        serverID,
        annotation.key,
      );
      await waitFor(async () => {
        afterReader = await readAnnotationState(api, serverID, annotation.key);
        return afterReader.comment === readerComment;
      });
      expect(afterReader).toMatchObject({
        status: 200,
        comment: readerComment,
      });
      expect(afterReader.version).toBeGreaterThan(annotation.version);

      await releaseAnnotationErase(rdp, annotation.key);
      const deleted = await deleting;
      expect(deleted.status).toBe(204);
      const final = await readAnnotationState(api, serverID, annotation.key);
      expect(final).toEqual({
        status: 404,
        version: null,
        comment: null,
      });
      console.info("Native DELETE concurrency evidence", {
        initialVersion: annotation.version,
        afterReader,
        deleteStatus: deleted.status,
        final,
        readerComment,
      });
    }, 120000);
  });
});

async function annotationRecords(
  api: string,
  serverID: string,
  attachmentKey: string,
): Promise<{ key: string; data: { parentItem: string } }[]> {
  const query = new URLSearchParams({
    itemType: "annotation",
    sort: "dateAdded",
    direction: "asc",
  });
  const reply = await zoteroFetch(
    api,
    `users/0/items/${attachmentKey}/children?${query.toString()}`,
    { headers: { "Zotero-Server-ID": serverID } },
  );
  expect(reply.status).toBe(200);
  return (await reply.json()) as {
    key: string;
    data: { parentItem: string };
  }[];
}

async function annotationKeys(
  api: string,
  serverID: string,
  attachmentKey: string,
): Promise<string[]> {
  return (await annotationRecords(api, serverID, attachmentKey)).map(
    ({ key }) => key,
  );
}

async function annotationParents(
  api: string,
  serverID: string,
  attachmentKey: string,
): Promise<string[]> {
  return (await annotationRecords(api, serverID, attachmentKey)).map(
    ({ data }) => data.parentItem,
  );
}

interface ConcurrencyAnnotation {
  key: string;
  version: number;
}

function createConcurrencyAnnotation(
  rdp: ZoteroRdp,
  comment: string,
): Promise<ConcurrencyAnnotation> {
  return rdp.json<ConcurrencyAnnotation>(`(async () => {
    const attachment = ${ATTACHMENT_ITEM};
    const seeded = attachment.getAnnotations()[0];
    const json = await Zotero.Annotations.toJSON(seeded);
    json.key = Zotero.DataObjectUtilities.generateKey();
    json.comment = ${JSON.stringify(comment)};
    const item = await Zotero.Annotations.saveFromJSON(attachment, json);
    globalThis.__zlConcurrencyKeys ??= [];
    globalThis.__zlConcurrencyKeys.push(item.key);
    return { key: item.key, version: item.clientVersion };
  })()`);
}

function pauseReaderCommentSave(
  rdp: ZoteroRdp,
  annotationKey: string,
  comment: string,
): Promise<{ version: number; comment: string }> {
  return rdp.json(`(async () => {
    const item = Zotero.Items.getByLibraryAndKey(
      Zotero.Libraries.userLibraryID,
      ${JSON.stringify(annotationKey)},
    );
    const reader = Zotero.Reader._readers.find(
      (candidate) => candidate.itemID === ${ATTACHMENT_ITEM}.id,
    );
    await reader._initPromise;
    const json = await reader._getAnnotation(item);
    json.comment = ${JSON.stringify(comment)};
    json.onlyTextOrComment = true;
    const original = item._initSave;
    const reached = Promise.withResolvers();
    const release = Promise.withResolvers();
    const state = {
      kind: "reader-save",
      item,
      original,
      reached: false,
      release: release.resolve,
      completed: null,
    };
    globalThis.__zlConcurrencyHook = state;
    item._initSave = async function (env) {
      const proceed = await original.call(this, env);
      if (!state.reached) {
        state.reached = true;
        reached.resolve();
        await release.promise;
      }
      return proceed;
    };
    state.completed = reader._internalReader
      ._onSaveAnnotations([json], () => {})
      .then(() => ({ ok: true }), (error) => ({ ok: false, error: String(error) }));
    await reached.promise;
    return { version: item.clientVersion, comment: item.annotationComment };
  })()`);
}

function releaseReaderCommentSave(
  rdp: ZoteroRdp,
  annotationKey: string,
): Promise<{ ok: boolean; error?: string }> {
  return rdp.json(`(async () => {
    const state = globalThis.__zlConcurrencyHook;
    if (!state || state.kind !== "reader-save" || state.item.key !== ${JSON.stringify(annotationKey)}) {
      throw new Error("No matching Reader save is paused");
    }
    state.release();
    const outcome = await state.completed;
    state.item._initSave = state.original;
    delete globalThis.__zlConcurrencyHook;
    return outcome;
  })()`);
}

function saveReaderComment(
  rdp: ZoteroRdp,
  annotationKey: string,
  comment: string,
): Promise<string> {
  return rdp.json(`(async () => {
    const item = Zotero.Items.getByLibraryAndKey(
      Zotero.Libraries.userLibraryID,
      ${JSON.stringify(annotationKey)},
    );
    const reader = Zotero.Reader._readers.find(
      (candidate) => candidate.itemID === ${ATTACHMENT_ITEM}.id,
    );
    await reader._initPromise;
    const json = await reader._getAnnotation(item);
    json.comment = ${JSON.stringify(comment)};
    json.onlyTextOrComment = true;
    await reader._internalReader._onSaveAnnotations([json], () => {});
    return "saved";
  })()`);
}

function pauseAnnotationErase(
  rdp: ZoteroRdp,
  annotationKey: string,
): Promise<string> {
  return rdp.json(`(() => {
    const item = Zotero.Items.getByLibraryAndKey(
      Zotero.Libraries.userLibraryID,
      ${JSON.stringify(annotationKey)},
    );
    const original = item.eraseTx;
    const release = Promise.withResolvers();
    const completed = Promise.withResolvers();
    const state = {
      kind: "erase",
      item,
      original,
      reached: false,
      release: release.resolve,
      completed: completed.promise,
    };
    globalThis.__zlConcurrencyHook = state;
    item.eraseTx = async function (options) {
      state.reached = true;
      await release.promise;
      try {
        return await original.call(this, options);
      }
      finally {
        completed.resolve();
      }
    };
    return "armed";
  })()`);
}

function annotationErasePaused(
  rdp: ZoteroRdp,
  annotationKey: string,
): Promise<boolean> {
  return rdp.json(`(() => {
    const state = globalThis.__zlConcurrencyHook;
    return Boolean(
      state?.kind === "erase" &&
      state.item.key === ${JSON.stringify(annotationKey)} &&
      state.reached
    );
  })()`);
}

function releaseAnnotationErase(
  rdp: ZoteroRdp,
  annotationKey: string,
): Promise<string> {
  return rdp.json(`(async () => {
    const state = globalThis.__zlConcurrencyHook;
    if (!state || state.kind !== "erase" || state.item.key !== ${JSON.stringify(annotationKey)}) {
      throw new Error("No matching erase is paused");
    }
    state.release();
    await state.completed;
    state.item.eraseTx = state.original;
    delete globalThis.__zlConcurrencyHook;
    return "released";
  })()`);
}

function restoreConcurrencyHooks(rdp: ZoteroRdp): Promise<string> {
  return rdp.json(`(async () => {
    const state = globalThis.__zlConcurrencyHook;
    if (!state) return "clean";
    state.release();
    if (state.reached && state.completed) await state.completed;
    if (state.kind === "reader-save") state.item._initSave = state.original;
    if (state.kind === "erase") state.item.eraseTx = state.original;
    delete globalThis.__zlConcurrencyHook;
    return "restored";
  })()`);
}

function eraseConcurrencyAnnotations(rdp: ZoteroRdp): Promise<string> {
  return rdp.json(`(async () => {
    for (const key of globalThis.__zlConcurrencyKeys ?? []) {
      const item = Zotero.Items.getByLibraryAndKey(
        Zotero.Libraries.userLibraryID,
        key,
      );
      if (item) await item.eraseTx();
    }
    delete globalThis.__zlConcurrencyKeys;
    return "erased";
  })()`);
}
