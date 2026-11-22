import { createServer } from "node:net";
import { join } from "node:path";
import { afterAll } from "vitest";

import {
  ANNOTATIONS,
  ATTACHMENTS,
  DEMO_ATTACHMENTS,
  DEMO_ITEMS,
  discardFixture,
  getFixtureLayout,
  ITEMS,
  LITERATURE_NOTE_PROFILES,
  NOTES,
} from "@zotlit/scripts/fixture";
import type { FixtureItem } from "@zotlit/scripts/fixture";
import { getWorkspaceRoot } from "@zotlit/scripts/package-roots";

import {
  e2eVaultDir,
  isObsidianReachable,
  vaultScript,
} from "./vault-script.ts";
import type { VaultScript } from "./vault-script.ts";

const workspaceRoot = await getWorkspaceRoot(import.meta.dirname);
const e2eVaultPath = e2eVaultDir(workspaceRoot, "fixture-vault");
const e2eFixture = getFixtureLayout(
  join(workspaceRoot, ".scratch", "e2e-fixture"),
);
const offlineZotero = createServer((socket) => socket.destroy());
await new Promise<void>((resolve, reject) => {
  offlineZotero.once("error", reject);
  offlineZotero.listen(0, "127.0.0.1", resolve);
});
afterAll(() => offlineZotero[Symbol.asyncDispose]());
const offlineZoteroAddress = offlineZotero.address();
if (offlineZoteroAddress === null || typeof offlineZoteroAddress === "string")
  throw new Error("Offline Zotero endpoint did not receive a TCP port");

const PROFILE_WRITERS = new Set(["open", "sync"]);
const fixtureVaultScript = vaultScript(workspaceRoot, e2eFixture.root);
const runVaultScript: VaultScript = (args) =>
  fixtureVaultScript(
    PROFILE_WRITERS.has(args[0]!)
      ? [...args, `--zotero-http-port=${offlineZoteroAddress.port}`]
      : args,
  );

const targetItem = ITEMS.find((item) => item.itemID === 1)!;

const MY_LIBRARY_DOCUMENT = {
  node: { kind: "library", library: { type: "personal" } },
  facets: [],
  search: "",
  sort: [{ property: "dateModified", direction: "DESC" }],
};
const createTargetItem = ITEMS.find((item) => item.itemID === 2)!;
const defaultProfileTargetItem = ITEMS.find((item) => item.itemID === 6)!;
const booksProfileTargetItem = ITEMS.find((item) => item.itemID === 7)!;
const booksProfile = LITERATURE_NOTE_PROFILES[0];
const annotationAttachment = ATTACHMENTS.find(({ key }) => key === "RGRPDF24")!;
const attachmentAnnotations = ANNOTATIONS.filter(
  ({ parentItemID }) => parentItemID === annotationAttachment.itemID,
);
const annotationKeys = attachmentAnnotations.map(({ key }) => key);
const copiedAnnotation = ANNOTATIONS.find(({ key }) => key === "FDRFQ7C2")!;
const annotationItem = ITEMS.find(({ key }) => key === "RUGIER24")!;
const positionDocumentItem = ITEMS.find(({ key }) => key === "SAKIMA22")!;
const attachmentTags = [
  ...new Set(
    attachmentAnnotations.flatMap(
      ({ tags }) => tags?.map(({ name }) => name) ?? [],
    ),
  ),
].sort();
const annotationKeysByPage = Map.groupBy(
  attachmentAnnotations,
  ({ position }) => ("pageIndex" in position ? position.pageIndex : -1),
);

afterAll(() => discardFixture(e2eFixture));

const reachable = await isObsidianReachable(workspaceRoot);
const annotationSuggesterEnabled =
  process.env.ANNOTATION_SUGGESTER_ENABLED === "true";
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

const readingState = {
  read: (item: FixtureItem) =>
    ATTACHMENTS.some(
      (attachment) =>
        attachment.parentItemID === item.itemID && attachment.lastRead != null,
    ),
  annotated: (item: FixtureItem) => {
    const ids = new Set(
      ATTACHMENTS.filter(
        ({ parentItemID }) => parentItemID === item.itemID,
      ).map(({ itemID }) => itemID),
    );
    return ANNOTATIONS.some(({ parentItemID }) => ids.has(parentItemID));
  },
  noted: (item: FixtureItem) => !DEMO_ITEMS.includes(item),
  pdf: (item: FixtureItem) =>
    ATTACHMENTS.some(
      (attachment) =>
        attachment.parentItemID === item.itemID &&
        attachment.contentType === "application/pdf" &&
        attachment.linkMode !== "linked_url" &&
        attachment.sourceAsset !== null &&
        !DEMO_ATTACHMENTS.includes(attachment),
    ),
};

export function fixtureActivity(item: FixtureItem): string {
  const attachments = ATTACHMENTS.filter(
    (entry) => entry.parentItemID === item.itemID,
  );
  return [
    item.dateAdded ?? item.dateModified,
    ...attachments.flatMap((entry) =>
      entry.lastRead === undefined
        ? []
        : [
            Temporal.Instant.fromEpochMilliseconds(entry.lastRead * 1000)
              .toString()
              .slice(0, 19)
              .replace("T", " "),
          ],
    ),
    ...NOTES.filter(
      (entry) => entry.parentItemID === item.itemID && !entry.trashed,
    ).map((entry) => entry.dateModified),
    ...ANNOTATIONS.filter((entry) =>
      attachments.some(
        (attachment) => attachment.itemID === entry.parentItemID,
      ),
    ).map((entry) => entry.dateModified),
  ]
    .toSorted()
    .at(-1)!;
}

export {
  annotationSuggesterEnabled,
  annotationAttachment,
  annotationItem,
  annotationKeys,
  annotationKeysByPage,
  attachmentAnnotations,
  attachmentTags,
  booksProfile,
  booksProfileTargetItem,
  BYTE_ORDER_MARK,
  copiedAnnotation,
  createTargetItem,
  defaultProfileTargetItem,
  e2eFixture,
  e2eVaultPath,
  MY_LIBRARY_DOCUMENT,
  positionDocumentItem,
  reachable,
  readingState,
  runVaultScript,
  targetItem,
  workspaceRoot,
};
