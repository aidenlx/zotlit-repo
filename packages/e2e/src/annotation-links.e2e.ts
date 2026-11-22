import { DatabaseSync } from "node:sqlite";
import type { WorkspaceLeaf, FileSystemAdapter } from "obsidian";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AnnotationView } from "@zotlit/query-views/desktop/annot-view/view.tsx";
import { ATTACHMENTS } from "@zotlit/scripts/fixture";

import {
  annotationAttachment,
  annotationItem,
  annotationKeys,
  annotationSuggesterEnabled,
  attachmentAnnotations,
  e2eFixture,
  reachable,
} from "./e2e-run-fixture.ts";
import { registerEndToEndRunHooks, run } from "./e2e-run-lifecycle.ts";
import { obRun } from "./obsidian-cli.ts";
import type {
  LinkGesture,
  LinkRecorder,
  LinkSettings,
} from "./page-links-types.ts";
import type { LinkMarkdownView } from "./page-links-types.ts";
import type { PagePdfReaderView } from "./page-notes-types.ts";
import {
  addSharedFileAttachment,
  reindexed,
  SHARED,
} from "./shared-attachment.ts";

const PDF_PATH = annotationAttachment.path!;
const NOTE = "Annotation links.md";

const SECOND_PAGE = attachmentAnnotations.find(
  ({ key }) => key === "FDRFQ7C2",
)!;
const FIRST_PAGE = attachmentAnnotations.find(({ key }) => key === "PUPR5FG5")!;
const ALSO_FIRST_PAGE = attachmentAnnotations.find(
  ({ key }) => key === "Q8ZR4TDH",
)!;
const COMMENTED = attachmentAnnotations.find(({ key }) => key === "HRK7BG32")!;
const INK = attachmentAnnotations.find(({ key }) => key === "TYY6Z6ZF")!;
const RICH = attachmentAnnotations.find(({ key }) => key === "K3JRFLFQ")!;
const MISSING_PDF = ATTACHMENTS.find(({ key }) => key === "MISSNG22")!;

const FILE_URL = "%FILE_URL%";

function durableLink(
  annotationKey: string,
  pageLabel: string,
  { attachmentKey = annotationAttachment.key }: { attachmentKey?: string } = {},
): string {
  return `zotero://open/library/items/${attachmentKey}?annotation=${annotationKey}&page=${pageLabel}`;
}

const LINK_TEXT = "the quoted passage";

function citationOf(annotation: { pageLabel: string }): string {
  return `[@${annotationItem.citationKey}, {p. ${annotation.pageLabel}}]`;
}

function noteWith(url: string, properties = ""): string {
  return `${properties}# Draft\n\nAs Rougier argues, [${LINK_TEXT}](${url}).\n`;
}

interface ReaderState {
  page: number | null;
  selected: string[];
}

interface Outcome {
  drawn: boolean;
  reader: ReaderState | null;
  passed: { url: string; target: string | null }[];
  notices: string[];
  reads?: (string | null)[];
}

const INLINE_ANNOTATION =
  "{{ zt.text }} {{ zt.citation }} [Zotero]({{ zt.backlink }})";

function inlineOf(annotation: {
  key: string;
  text?: string | null;
  pageLabel: string;
}): string {
  return `${annotation.text} ${citationOf(annotation)} [Zotero](${durableLink(annotation.key, annotation.pageLabel)})`;
}

interface InsertAt {
  line?: string;
  ch?: number;
  inline?: boolean;
  typeOn?: string;
}

async function insertFromCard(
  annotationKey: string,
  { line = "", ch = 0, inline = false, typeOn }: InsertAt = {},
): Promise<string> {
  const card = `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(annotationKey)}]`;
  const reply = await obRun(
    run.vaultId,
    async (
      { app, zotlit, page },
      {
        useInline,
        inlineTemplate,
        inlineSuffix,
        notePath,
        draftContent,
        itemKey,
        cursorCh,
        cardSelector,
        annotationKey,
        typeAfter,
      },
    ) => {
      const links = page.annotationLinkTools(() => zotlit.services);
      const { until } = links;
      let text;
      {
        await using cleanup = new AsyncDisposableStack();
        links.restoreLedger(cleanup);
        if (useInline) {
          await links.inlineProfile(cleanup, {
            template: inlineTemplate,
            suffix: inlineSuffix,
          });
        }
        const { leaf, view } = await links.draft(cleanup, {
          notePath: notePath,
          content: draftContent,
        });
        const sidebar = app.workspace.getRightLeaf(false)!;
        cleanup.adopt(sidebar, (leaf) => leaf.detach());
        await sidebar.setViewState({
          type: "zotero-annotation-view",
          state: { followMode: "pinned", pinnedItemKey: itemKey },
        });
        await app.workspace.revealLeaf(sidebar);
        app.workspace.setActiveLeaf(leaf, { focus: true });
        const editor = view.editor;
        editor.setCursor({ line: editor.lastLine(), ch: cursorCh });
        const more = await until(
          () =>
            (
              sidebar.view as AnnotationView
            ).contentEl.querySelector<HTMLElement>(cardSelector),
          () => "The Annotation card did not render",
        );
        more.click();
        const item = await until(
          () =>
            [
              ...activeDocument.querySelectorAll<HTMLElement>(".menu-item"),
            ].find((el) => el.textContent.trim() === "Insert into note"),
          () => 'The card menu offers no "Insert into note"',
        );
        await page.menuReady();
        item.click();
        await until(
          () => editor.getValue().includes(annotationKey),
          () => `Nothing was inserted: ${JSON.stringify(editor.getValue())}`,
        );
        const typedAfter = typeAfter;
        if (typedAfter !== null)
          editor.cm.dispatch(editor.cm.state.replaceSelection(typedAfter), {
            userEvent: "input.type",
          });
        text = editor.getValue();
      }
      return text;
    },
    {
      useInline: inline,
      inlineTemplate: INLINE_ANNOTATION,
      inlineSuffix: `\n${INLINE_ANNOTATION}\n`,
      notePath: NOTE,
      draftContent: `# Draft\n\n${line}`,
      itemKey: annotationItem.key,
      cursorCh: ch,
      cardSelector: `${card} [aria-label="More options"]`,
      annotationKey: annotationKey,
      typeAfter: typeOn ?? null,
    },
    { timeoutMs: 60000 },
  );
  return reply;
}

interface SearchOutcome {
  text: string;
  rows: string[];
  sup: string | null;
  citationOpen: boolean;
  use: string | null;
}

async function searchAndInsert(
  typed: string,
  choose: string,
  { line = "", ch = 0, inline = false, typeOn }: InsertAt = {},
): Promise<SearchOutcome> {
  const reply = await obRun(
    run.vaultId,
    async (
      { app, zotlit, page },
      {
        useInline,
        inlineTemplate,
        inlineSuffix,
        notePath,
        draftContent,
        itemKey,
        cursorCh,
        typedText,
        queryText,
        querySource,
        chosenText,
        typeAfter,
      },
    ) => {
      const links = page.annotationLinkTools(() => zotlit.services);
      const { until } = links;
      const suggesters = app.workspace.editorSuggest.suggests;
      const annotations = suggesters.find(
        (s) => s.constructor.name === "AnnotationEditorSuggest",
      );
      const citations = suggesters.find(
        (s) => s.constructor.name === "CitationEditorSuggest",
      );
      if (!annotations)
        throw new Error("No Annotation Suggester is registered");
      let outcome;
      {
        await using cleanup = new AsyncDisposableStack();
        links.restoreLedger(cleanup);
        if (useInline) {
          await links.inlineProfile(cleanup, {
            template: inlineTemplate,
            suffix: inlineSuffix,
          });
        }
        const { leaf, view } = await links.draft(cleanup, {
          notePath: notePath,
          content: draftContent,
        });
        cleanup.defer(() => annotations.close());
        const ledger = () =>
          zotlit.services.bridge.runSync(
            zotlit.services.useLedger.get(itemKey),
          );
        const before = ledger()?.instant.epochMilliseconds ?? null;
        app.workspace.setActiveLeaf(leaf, { focus: true });
        const editor = view.editor;
        editor.setCursor({ line: editor.lastLine(), ch: cursorCh });
        editor.focus();
        editor.cm.dispatch(editor.cm.state.replaceSelection(typedText), {
          userEvent: "input.type",
        });
        const query = queryText.slice(querySource.indexOf("[>") + 2);
        const rows = () => [
          ...annotations.suggestEl.querySelectorAll(".suggestion-item"),
        ];
        const row = await until(
          () =>
            annotations.isOpen &&
            annotations.context?.query === query &&
            rows().find(
              (el) =>
                !el.closest("[aria-busy]") &&
                el.textContent.includes(chosenText),
            ),
          () =>
            `The Annotation Suggester showed no row for ${JSON.stringify(query)}: ${JSON.stringify(rows().map((el) => el.textContent))}`,
        );
        const shown = rows().map((el) => el.textContent);
        const sup = row.querySelector("sup")?.textContent ?? null;
        const citationOpen = !!citations?.isOpen;
        row.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await until(
          () => {
            const value = editor.getValue();
            return !value.includes("[>") && value.includes("zotero://");
          },
          () => `Nothing was inserted: ${JSON.stringify(editor.getValue())}`,
        );
        const typedAfter = typeAfter;
        if (typedAfter !== null)
          editor.cm.dispatch(editor.cm.state.replaceSelection(typedAfter), {
            userEvent: "input.type",
          });
        const text = editor.getValue();
        const after = ledger();
        const use =
          after && after.instant.epochMilliseconds !== before
            ? after.kind
            : null;
        outcome = { text, rows: shown, sup, citationOpen, use };
      }
      return outcome;
    },
    {
      useInline: inline,
      inlineTemplate: INLINE_ANNOTATION,
      inlineSuffix: `\n${INLINE_ANNOTATION}\n`,
      notePath: NOTE,
      draftContent: `# Draft\n\n${line}`,
      itemKey: annotationItem.key,
      cursorCh: ch,
      typedText: typed,
      queryText: typed,
      querySource: typed,
      chosenText: choose,
      typeAfter: typeOn ?? null,
    },
    { timeoutMs: 60000 },
  );
  return reply;
}

interface Scenario {
  note: string;
  url: string;
  gesture: LinkGesture | "external" | "chip" | "block-chip";
  captureOff?: boolean;
  linkSettings?: LinkSettings;
  lands?: ReaderState;
  bound?: string;
  reads?: boolean;
}

async function follow({
  note,
  url,
  gesture,
  captureOff = false,
  linkSettings = {},
  lands,
  bound = annotationAttachment.key,
  reads = false,
}: Scenario): Promise<Outcome> {
  const reply = await obRun(
    run.vaultId,
    async (
      { app, zotlit, page },
      {
        observedPdfPath,
        fileUrlPath,
        requestedUrl,
        urlPlaceholder,
        captureDisabled,
        changedSettings,
        requestedGesture,
        notePath,
        noteContent,
        notePlaceholder,
        readPdfPath,
        itemKey,
        linkText,
        expectedLanding,
        bindingPdfPath,
        bindingKey,
        bindingLabel,
        reportReads,
      },
    ) => {
      const links = page.annotationLinkTools(() => zotlit.services);
      const { deadline, within, until } = links;
      const s = zotlit.services;
      const observe = () => {
        const pdf = app.workspace
          .getLeavesOfType(page.reader.viewType)
          .map(({ view }) => view as PagePdfReaderView)
          .find((view) => view.file?.path === observedPdfPath);
        return {
          drawn: !!pdf?.containerEl.querySelector(".zt-pdf-annotation-mark"),
          reader: pdf
            ? {
                page: pdf.reader ? pdf.reader.state.get().pageIndex + 1 : null,
                selected: [
                  ...new Set(
                    [
                      ...pdf.containerEl.querySelectorAll<HTMLElement>(
                        ".zt-pdf-annotation-mark.is-selected",
                      ),
                    ].map((mark) => mark.dataset.zoteroAnnotationKey!),
                  ),
                ],
              }
            : null,
          passed: page.scratch.links!.passed.slice(),
          notices: page
            .windowDocuments()
            .flatMap((doc) =>
              [...doc.querySelectorAll(".notice")].map(
                (notice) => notice.textContent,
              ),
            ),
        };
      };
      let outcome;
      {
        await using cleanup = new AsyncDisposableStack();
        links.restoreLedger(cleanup);
        const layout = app.workspace.getLayout();
        cleanup.defer(async () => {
          for (const leaf of app.workspace.getLeavesOfType(
            page.reader.viewType,
          ))
            leaf.detach();
          await app.workspace.changeLayout(layout);
        });
        const captureSetting = s.bridge.runSync(s.settings.current)[
          "reader.open-file-links"
        ];
        cleanup.defer(() => {
          s.bridge.runSync(
            s.settings.update({ "reader.open-file-links": captureSetting }),
          );
        });
        page.scratch.links!.passed = [];
        for (const doc of page.windowDocuments())
          for (const notice of doc.querySelectorAll(".notice")) notice.remove();
        const fileUrl = require("url").pathToFileURL(
          (app.vault.adapter as FileSystemAdapter).getFullPath(fileUrlPath),
        ).href;
        const url = requestedUrl.replaceAll(urlPlaceholder, fileUrl);
        if (captureDisabled)
          s.bridge.runSync(
            s.settings.update({ "reader.open-file-links": false }),
          );
        links.applySettings(cleanup, changedSettings);
        const gesture = requestedGesture;
        const shown =
          gesture === "chip"
            ? null
            : await links.showNote(cleanup, {
                notePath: notePath,
                content: noteContent.replaceAll(notePlaceholder, fileUrl),
                gesture:
                  gesture === "external"
                    ? "live-preview"
                    : gesture === "block-chip"
                      ? "reading"
                      : gesture,
              });
        const view = shown?.view;
        const reads: (string | null)[] = [];
        let replayed = false;
        cleanup.defer(
          s.bridge.subscribe(s.useLedger.changes, () => {
            if (!replayed) {
              replayed = true;
              return;
            }
            const [newest] =
              Object.entries(s.bridge.runSync(s.useLedger.uses)).sort(
                ([, a], [, b]) => b - a,
              )[0] ?? [];
            if (
              newest !== undefined &&
              s.bridge.runSync(s.useLedger.get(newest))?.kind === "read"
            ) {
              const attachment = s.bridge
                .runSync(s.pdfAnnotationEditor.bindings)
                .find((b) => b.filePath === readPdfPath)?.attachment;
              reads.push(
                attachment?.kind === "resolved"
                  ? attachment.attachmentKey
                  : null,
              );
            }
          }),
        );
        if (gesture === "external") {
          window.open(url, "_external");
        } else if (gesture === "chip" || gesture === "block-chip") {
          let root: HTMLElement;
          if (gesture === "chip") {
            const sidebar = cleanup.adopt(
              app.workspace.getRightLeaf(false)!,
              (leaf) => leaf.detach(),
            );
            await sidebar.setViewState({
              type: "zotero-annotation-view",
              state: { followMode: "pinned", pinnedItemKey: itemKey },
            });
            await app.workspace.revealLeaf(sidebar);
            root = (sidebar.view as AnnotationView).contentEl;
          } else {
            root = view!.containerEl;
          }
          const card = `.zt-annot-card[data-zotero-annotation-key=${JSON.stringify(new URL(url).searchParams.get("annotation"))}]`;
          const scope =
            gesture === "block-chip" ? ".block-language-zotquery " : "";
          const link = await until(
            () =>
              root.querySelector<HTMLElement>(
                `${scope}${card} a.zt-annot-page-chip`,
              ),
            () => "The card drew no page chip",
          );
          link.scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: "instant",
          });
          const box = link.getBoundingClientRect();
          link.dispatchEvent(
            new MouseEvent("click", {
              clientX: box.left + box.width / 2,
              clientY: box.top + box.height / 2,
              bubbles: true,
              cancelable: true,
              button: 0,
              view: link.ownerDocument.defaultView,
            }),
          );
        } else {
          const { link, x, y } = await links.linkTarget(view!, {
            url,
            gesture,
            linkText: linkText,
          });
          const init = {
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
            button: 0,
            view: link.ownerDocument.defaultView,
          };
          link.dispatchEvent(
            new MouseEvent("mousedown", { ...init, buttons: 1 }),
          );
          link.dispatchEvent(new MouseEvent("mouseup", init));
          link.dispatchEvent(new MouseEvent("click", init));
        }
        const lands = expectedLanding;
        if (lands === null) {
          await until(
            () => page.scratch.links!.passed.length > 0,
            () => "No link reached the system handler",
          );
        } else {
          const binding = await until(
            () =>
              s.bridge
                .runSync(s.pdfAnnotationEditor.bindings)
                .find(
                  (b) =>
                    b.filePath === bindingPdfPath &&
                    b.attachment.kind === "resolved" &&
                    b.attachment.attachmentKey === bindingKey,
                ),
            () =>
              `No reader named the Attachment ${bindingLabel}: ${JSON.stringify(s.bridge.runSync(s.pdfAnnotationEditor.bindings).map((b) => b.attachment))}`,
          );
          for (
            let read = binding.refreshed, end = deadline();
            ;
            read = binding.refreshed
          ) {
            await within(read, end, "The reader never drew its last read");
            if (read === binding.refreshed) break;
          }
          await until(
            () => {
              const now = observe();
              return now.drawn && JSON.stringify(now.reader) === lands;
            },
            () => `The reader did not land: ${JSON.stringify(observe())}`,
          );
        }
        outcome = { ...observe(), ...(reportReads ? { reads } : {}) };
      }
      return outcome;
    },
    {
      observedPdfPath: PDF_PATH,
      fileUrlPath: PDF_PATH,
      requestedUrl: url,
      urlPlaceholder: FILE_URL,
      captureDisabled: captureOff,
      changedSettings: linkSettings,
      requestedGesture: gesture,
      notePath: NOTE,
      noteContent: note,
      notePlaceholder: FILE_URL,
      readPdfPath: PDF_PATH,
      itemKey: annotationItem.key,
      linkText: LINK_TEXT,
      expectedLanding: lands === undefined ? null : JSON.stringify(lands),
      bindingPdfPath: PDF_PATH,
      bindingKey: bound,
      bindingLabel: bound,
      reportReads: reads,
    },
    { timeoutMs: 60000 },
  );
  return reply;
}

interface SharedTabsOutcome {
  reads: (string | null)[];
  restored: string | null;
  besideRestored: string[];
  besideSecond: string[];
  passed: string[];
}

async function sharedTabs(): Promise<SharedTabsOutcome> {
  const cardsOf = (keys: readonly string[]) => JSON.stringify([...keys].sort());
  const reply = await obRun(
    run.vaultId,
    async (
      { app, zotlit, page },
      {
        pdfPath,
        initialKey,
        reloadedKey,
        targetAttachment,
        targetAnnotation,
        targetPage,
        followedKey,
        secondKey,
        restoredCards,
        secondCards,
      },
    ) => {
      const links = page.annotationLinkTools(() => zotlit.services);
      const { deadline, within, until } = links;
      const services = () => zotlit.services;
      const file = app.vault.getFileByPath(pdfPath)!;
      const attachmentOf = (leaf: WorkspaceLeaf) =>
        services().bridge.runSync(
          services().pdfAnnotationEditor.sessionFor(leaf.view),
        )?.target?.attachmentKey ?? null;
      const boundTo = (leaf: WorkspaceLeaf, key: string, what: string) =>
        until(
          () => attachmentOf(leaf) === key,
          () => `${what} never named ${key}: ${attachmentOf(leaf)}`,
        );
      let outcome;
      {
        await using cleanup = new AsyncDisposableStack();
        links.restoreLedger(cleanup);
        const layout = app.workspace.getLayout();
        cleanup.defer(async () => {
          for (const leaf of app.workspace.getLeavesOfType(
            page.reader.viewType,
          ))
            leaf.detach();
          await app.workspace.changeLayout(layout);
        });
        page.scratch.links!.passed = [];
        const restored = app.workspace.getLeaf("tab");
        cleanup.adopt(restored, (leaf) => leaf.detach());
        await restored.setViewState({
          type: page.reader.viewType,
          state: { file: file.path },
          active: true,
        });
        await boundTo(restored, initialKey, "The first tab");
        await app.plugins.disablePlugin("zotlit");
        await app.plugins.enablePlugin("zotlit");
        await within(
          services().bridge.runPromise(services().attachmentResolver.indexed),
          deadline(),
          "The Attachment index was not built again",
        );
        await boundTo(restored, reloadedKey, "The tab ZotLit found open");
        const reads: (string | null)[] = [];
        const ledger = services().useLedger;
        let replayed = false;
        cleanup.defer(
          services().bridge.subscribe(ledger.changes, () => {
            if (!replayed) {
              replayed = true;
              return;
            }
            const [newest] =
              Object.entries(services().bridge.runSync(ledger.uses)).sort(
                ([, a], [, b]) => b - a,
              )[0] ?? [];
            if (
              newest !== undefined &&
              services().bridge.runSync(ledger.get(newest))?.kind === "read"
            ) {
              const attachment = services().bridge.runSync(
                services().pdfAnnotationEditor.bindingFor(restored.view),
              )?.attachment;
              reads.push(
                attachment?.kind === "resolved"
                  ? attachment.attachmentKey
                  : null,
              );
            }
          }),
        );
        app.workspace.setActiveLeaf(restored, { focus: true });
        const opened = await services().bridge.runPromise(
          services().targetOpener.open(
            {
              kind: "annotation",
              attachmentKey: targetAttachment,
              annotationKey: targetAnnotation,
              pageIndex: 0,
              pageLabel: targetPage,
            },
            false,
          ),
        );
        if (opened.kind !== "reader")
          throw new Error(`The open went elsewhere: ${JSON.stringify(opened)}`);
        await boundTo(restored, followedKey, "The tab ZotLit found open");
        const second = app.workspace.getLeaf("tab");
        cleanup.adopt(second, (leaf) => leaf.detach());
        await second.setViewState({
          type: page.reader.viewType,
          state: { file: file.path },
          active: true,
        });
        await boundTo(second, secondKey, "The second tab");
        const sidebar = app.workspace.getRightLeaf(false)!;
        cleanup.adopt(sidebar, (leaf) => leaf.detach());
        await sidebar.setViewState({
          type: "zotero-annotation-view",
          state: { followMode: "active-tab" },
        });
        await app.workspace.revealLeaf(sidebar);
        const cards = () =>
          [
            ...new Set(
              [
                ...(
                  sidebar.view as AnnotationView
                ).contentEl.querySelectorAll<HTMLElement>(
                  ".zt-annot-card[data-zotero-annotation-key]",
                ),
              ].map((el) => el.dataset.zoteroAnnotationKey!),
            ),
          ].sort();
        const beside = (leaf: WorkspaceLeaf, expected: string) => {
          app.workspace.setActiveLeaf(leaf, { focus: true });
          return until(
            () => JSON.stringify(cards()) === expected && cards(),
            () =>
              `The Annotation View beside the tab showed ${JSON.stringify(cards())}, not ${expected}`,
          );
        };
        const besideRestored = await beside(restored, restoredCards);
        const besideSecond = await beside(second, secondCards);
        outcome = {
          reads,
          restored: attachmentOf(restored),
          besideRestored,
          besideSecond,
          passed: page.scratch.links!.passed.map(({ url }) => url),
        };
      }
      return outcome;
    },
    {
      pdfPath: PDF_PATH,
      initialKey: annotationAttachment.key,
      reloadedKey: annotationAttachment.key,
      targetAttachment: SHARED.attachmentKey,
      targetAnnotation: SHARED.annotationKey,
      targetPage: FIRST_PAGE.pageLabel,
      followedKey: SHARED.attachmentKey,
      secondKey: annotationAttachment.key,
      restoredCards: cardsOf([SHARED.annotationKey]),
      secondCards: cardsOf(annotationKeys),
    },
    { timeoutMs: 120000 },
  );
  return reply;
}

function rewriteAnnotationText(
  databasePath: string,
  annotationKey: string,
  text: string,
): Disposable {
  const write = (value: string | null) => {
    using database = new DatabaseSync(databasePath);
    database
      .prepare(
        "update itemAnnotations set text = ? where itemID = (select itemID from items where key = ?)",
      )
      .run(value, annotationKey);
  };
  const original = attachmentAnnotations.find(
    ({ key }) => key === annotationKey,
  )!.text;
  write(text);
  return { [Symbol.dispose]: () => write(original ?? null) };
}

async function reread(annotationKey: string, text: string): Promise<void> {
  await obRun(
    run.vaultId,
    async (
      { zotlit, page },
      { attachmentKey, annotationKey, expectedText, annotationLabel },
    ) => {
      const links = page.annotationLinkTools(() => zotlit.services);
      const { sleep, deadline, past } = links;
      const s = zotlit.services;
      await s.bridge.runPromise(s.zoteroReads.refresh);
      const holds = async () =>
        (
          await s.bridge.runPromise(s.annotationRepository.read(attachmentKey))
        )?.annotations.find(({ key }) => key === annotationKey)?.text ===
        expectedText;
      for (const end = deadline(); !(await holds()); await sleep(100))
        if (past(end))
          throw new Error(
            `The repository never read the new text of ${annotationLabel}`,
          );
      return true;
    },
    {
      attachmentKey: annotationAttachment.key,
      annotationKey: annotationKey,
      expectedText: text,
      annotationLabel: annotationKey,
    },
    { timeoutMs: 60000 },
  );
}

interface HoverOutcome {
  popover: boolean;
  text: string | null;
  color: string | null;
  image: boolean;
  sup: string | null;
  crossed?: {
    same: boolean;
    moved: boolean;
    text: string | null;
  };
}

const CONTROL_URL = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);

interface HoverScenario {
  url: string;
  gesture: "live-preview" | "reading" | "source";
  hoverAction?: "off" | "popover" | "page-preview";
  pagePreviewMod?: boolean;
  pandocOff?: boolean;
  linkSettings?: LinkSettings;
  image?: boolean;
  mod?: boolean;
  absent?: boolean;
  crossToUrl?: boolean;
}

async function hover({
  url,
  gesture,
  hoverAction,
  pagePreviewMod,
  pandocOff = false,
  linkSettings = {},
  image = false,
  mod = false,
  absent = false,
  crossToUrl = false,
}: HoverScenario): Promise<HoverOutcome> {
  const note =
    absent && url !== CONTROL_URL
      ? `${noteWith(url)}\nSee also [the control](${CONTROL_URL}).\n`
      : noteWith(url);
  const reply = await obRun(
    run.vaultId,
    async (
      { app, zotlit, page },
      {
        requestedUrl,
        requestedHover,
        disablePandoc,
        changedSettings,
        previewModifier,
        notePath,
        noteContent,
        noteGesture,
        targetGesture,
        linkText,
        hoverMeta,
        hoverCtrl,
        expectAbsent,
        controlUrl,
        expectImage,
        unavailableText,
        crossUrl,
        crossMeta,
        crossCtrl,
      },
    ) => {
      const links = page.annotationLinkTools(() => zotlit.services);
      const { sleep, until } = links;
      const s = zotlit.services;
      let outcome: HoverOutcome;
      {
        await using cleanup = new AsyncDisposableStack();
        const layout = app.workspace.getLayout();
        cleanup.defer(async () => {
          await app.workspace.changeLayout(layout);
        });
        const hoverAction = s.bridge.runSync(s.settings.current)[
          "citation.hover-action"
        ];
        cleanup.defer(() => {
          s.bridge.runSync(
            s.settings.update({ "citation.hover-action": hoverAction }),
          );
        });
        const pandoc = s.bridge.runSync(s.settings.current)[
          "citation.pandoc-citations"
        ];
        cleanup.defer(() => {
          s.bridge.runSync(
            s.settings.update({ "citation.pandoc-citations": pandoc }),
          );
        });
        const url = requestedUrl;
        const changedHover = requestedHover;
        if (changedHover !== null)
          s.bridge.runSync(
            s.settings.update({ "citation.hover-action": changedHover }),
          );
        if (disablePandoc)
          s.bridge.runSync(
            s.settings.update({ "citation.pandoc-citations": false }),
          );
        links.applySettings(cleanup, changedSettings);
        const previewMod = previewModifier;
        if (previewMod !== null) {
          const pagePreview = (
            app.internalPlugins.getEnabledPluginById("page-preview") as {
              options?: {
                "zotlit-citekey"?: boolean;
              };
            } | null
          )?.options;
          if (!pagePreview)
            throw new Error("The Page preview core plugin is off");
          const rowSet = Object.hasOwn(pagePreview, "zotlit-citekey"),
            row = pagePreview["zotlit-citekey"];
          cleanup.defer(() => {
            if (rowSet) pagePreview["zotlit-citekey"] = row;
            else delete pagePreview["zotlit-citekey"];
          });
          pagePreview["zotlit-citekey"] = previewMod;
        }
        const { file, view } = await links.showNote(cleanup, {
          notePath: notePath,
          content: noteContent,
          gesture: noteGesture,
        });
        const { link, x, y } = await links.linkTarget(view, {
          url,
          gesture: targetGesture,
          linkText: linkText,
        });
        cleanup.defer(() => view.hoverPopover?.hide());
        link.dispatchEvent(
          new MouseEvent("mouseover", {
            clientX: x,
            clientY: y,
            bubbles: true,
            metaKey: hoverMeta,
            ctrlKey: hoverCtrl,
            view: link.ownerDocument.defaultView,
          }),
        );
        const opened = (view: LinkMarkdownView) =>
          view.hoverPopover?.hoverEl.isConnected ? view.hoverPopover : null;
        if (expectAbsent) {
          s.bridge.runSync(
            s.settings.update({ "citation.hover-action": "popover" }),
          );
          const control = app.workspace.getLeaf("split", "vertical");
          cleanup.adopt(control, (leaf) => leaf.detach());
          await control.setViewState({
            type: "markdown",
            state: { file: file.path, mode: "preview" },
          });
          cleanup.defer(() =>
            (control.view as LinkMarkdownView).hoverPopover?.hide(),
          );
          const controlLink = await until(
            () =>
              [
                ...(
                  control.view as LinkMarkdownView
                ).previewMode.containerEl.querySelectorAll("a.external-link"),
              ].find((a) => a.getAttribute("href") === controlUrl),
            () => "The control link did not render",
          );
          controlLink.dispatchEvent(
            new MouseEvent("mouseover", {
              bubbles: true,
              view: controlLink.ownerDocument.defaultView,
            }),
          );
          await until(
            () => opened(control.view as LinkMarkdownView),
            () => "The control hover opened no popover",
          );
          outcome = {
            popover:
              !!opened(view) ||
              link.ownerDocument.querySelectorAll(".hover-popover").length !==
                1,
            text: null,
            color: null,
            image: false,
            sup: null,
          };
        } else {
          const popover = await until(
            () => opened(view),
            () => "No popover opened over the link",
          );
          const content = () =>
            popover.hoverEl.isConnected
              ? popover.hoverEl.querySelector(".zt-citation-popover-content")
              : null;
          await until(
            () =>
              content()?.querySelector("[data-annotation-key]") ||
              content()?.textContent?.includes(unavailableText),
            () =>
              `The popover never drew the Annotation: ${popover.hoverEl.outerHTML.slice(0, 300)}`,
          );
          const painted = () =>
            [...content()!.querySelectorAll("img")].find(
              (img) =>
                img.src.startsWith("blob:") &&
                img.complete &&
                img.naturalWidth > 0,
            );
          if (expectImage)
            await until(
              painted,
              () =>
                `The popover painted no Excerpt Image: ${content()!.outerHTML.slice(0, 300)}`,
            );
          const colored = content()!.querySelector<HTMLElement>(
            '[style*="--zt-annot-color"]',
          );
          outcome = {
            popover: true,
            text: content()!.textContent,
            color: colored
              ? colored.style.getPropertyValue("--zt-annot-color")
              : null,
            image: !!painted(),
            sup: content()!.querySelector("sup")?.textContent ?? null,
          };
          if (crossUrl) {
            const before = popover.hoverEl.getBoundingClientRect();
            const urlEl = [
              ...link.closest(".cm-line")!.querySelectorAll(".cm-url"),
            ].find((el) => !el.classList.contains("cm-formatting"));
            if (!urlEl) throw new Error("The link shows no URL");
            const urlBox = urlEl.getClientRects()[0]!;
            urlEl.dispatchEvent(
              new MouseEvent("mouseover", {
                clientX: urlBox.left + Math.min(urlBox.width / 2, 12),
                clientY: urlBox.top + urlBox.height / 2,
                bubbles: true,
                relatedTarget: link,
                metaKey: crossMeta,
                ctrlKey: crossCtrl,
                view: urlEl.ownerDocument.defaultView,
              }),
            );
            await sleep(500);
            const after = popover.hoverEl.getBoundingClientRect();
            outcome.crossed = {
              same: opened(view) === popover,
              moved: before.left !== after.left || before.top !== after.top,
              text: content()?.textContent ?? null,
            };
          }
        }
      }
      return outcome;
    },
    {
      requestedUrl: url,
      requestedHover: hoverAction ?? null,
      disablePandoc: pandocOff,
      changedSettings: linkSettings,
      previewModifier: pagePreviewMod ?? null,
      notePath: NOTE,
      noteContent: note,
      noteGesture: gesture,
      targetGesture: gesture,
      linkText: LINK_TEXT,
      hoverMeta: mod,
      hoverCtrl: mod,
      expectAbsent: absent,
      controlUrl: CONTROL_URL,
      expectImage: image,
      unavailableText: run.m.annotation_popover_unavailable(),
      crossUrl: crossToUrl,
      crossMeta: mod,
      crossCtrl: mod,
    },
    { timeoutMs: 90000 },
  );
  return reply;
}

describe.skipIf(!reachable)("Annotation links", () => {
  registerEndToEndRunHooks();

  beforeAll(async () => {
    expect(
      await obRun(
        run.vaultId,
        async ({ app, zotlit, page }) => {
          await app.plugins.disablePlugin("zotlit");
          const s: LinkRecorder = (page.scratch.links = {
            native: window.open,
            passed: [],
            stopAnchor: (event) => {
              const anchor =
                event.target instanceof Element
                  ? event.target.closest('a[href^="zotero:"]')
                  : null;
              if (
                anchor?.closest(
                  '.workspace-leaf-content[data-type="zotero-annotation-view"]',
                )
              )
                event.preventDefault();
            },
          });
          window.addEventListener("click", s.stopAnchor, true);
          window.open = function (
            this: Window,
            ...args: Parameters<Window["open"]>
          ) {
            const [url, target] = args;
            if (String(url).startsWith("zotero:")) {
              s.passed.push({ url: String(url), target: target ?? null });
              return null;
            }
            return s.native.apply(this, args);
          };
          await app.plugins.enablePlugin("zotlit");
          const timeout = new Promise<string>((resolve) =>
            setTimeout(() => resolve("not indexed"), 20000),
          );
          return await Promise.race([
            zotlit.services.bridge
              .runPromise(zotlit.services.attachmentResolver.indexed)
              .then(() => "indexed"),
            timeout,
          ]);
        },
        undefined,
        { timeoutMs: 60000 },
      ),
      "the Attachment index is built with no lookup asking for it",
    ).toBe("indexed");
  }, 120000);

  afterAll(async () => {
    await obRun(run.vaultId, async ({ app, page }) => {
      const s = page.scratch.links;
      if (!s) return true;
      await app.plugins.disablePlugin("zotlit");
      window.removeEventListener("click", s.stopAnchor, true);
      window.open = s.native;
      delete page.scratch.links;
      await app.plugins.enablePlugin("zotlit");
      return true;
    });
  }, 120000);

  it("opens the reader on the Annotation a link names, clicked in Live Preview", async () => {
    const url = durableLink(SECOND_PAGE.key, SECOND_PAGE.pageLabel);
    const lands = { page: 2, selected: [SECOND_PAGE.key] };

    const outcome = await follow({
      note: noteWith(url),
      url,
      gesture: "live-preview",
      lands,
    });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
  }, 120000);

  it("opens the reader on the Annotation a link names, clicked in Reading view", async () => {
    const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);
    const lands = { page: 1, selected: [FIRST_PAGE.key] };

    const outcome = await follow({
      note: noteWith(url),
      url,
      gesture: "reading",
      lands,
    });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
  }, 120000);

  it("opens the reader on the Annotation a link names, clicked in a Properties value", async () => {
    const url = durableLink(ALSO_FIRST_PAGE.key, ALSO_FIRST_PAGE.pageLabel);
    const lands = { page: 1, selected: [ALSO_FIRST_PAGE.key] };

    const outcome = await follow({
      note: noteWith(
        durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        `---\nsource: "${url}"\n---\n`,
      ),
      url,
      gesture: "properties",
      lands,
    });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
  }, 120000);

  it("lands on the page alone for an Annotation Zotero no longer has", async () => {
    const url = durableLink("ZZZZZZZ2", SECOND_PAGE.pageLabel);
    const lands = { page: 2, selected: [] };

    const outcome = await follow({
      note: noteWith(url),
      url,
      gesture: "reading",
      lands,
    });

    expect(outcome).toEqual({
      drawn: true,
      reader: lands,
      passed: [],
      notices: [],
    });
  }, 120000);

  it("inserts an Annotation with its durable link, which lands when clicked", async () => {
    const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);
    const lands = { page: 1, selected: [FIRST_PAGE.key] };

    const inserted = await insertFromCard(FIRST_PAGE.key);

    expect(inserted).toContain(`Page [${FIRST_PAGE.pageLabel}](${url})`);
    expect(inserted).toContain(`${FIRST_PAGE.text} ${citationOf(FIRST_PAGE)}`);
    expect(inserted).not.toContain("file://");
    expect(inserted).not.toContain("zt-annotation=");

    const outcome = await follow({
      note: inserted,
      url,
      gesture: "reading",
      lands,
    });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
  }, 120000);

  it.skipIf(!annotationSuggesterEnabled)(
    "searches annotations from the cursor and inserts the chosen one",
    async () => {
      const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);

      const outcome = await searchAndInsert(
        "[>MESSAGE tag:visualization color:blue",
        FIRST_PAGE.text!,
      );

      expect(outcome.citationOpen).toBe(false);
      expect(outcome.rows).toEqual([
        expect.stringContaining(
          `${run.m.annot_view_page({ page: FIRST_PAGE.pageLabel })} · ${annotationItem.title}`,
        ),
      ]);
      expect(outcome.rows[0]).toContain(FIRST_PAGE.text!);
      expect(outcome.text).toContain(FIRST_PAGE.text!);
      expect(outcome.text).toContain(`Page [${FIRST_PAGE.pageLabel}](${url})`);
      expect(outcome.text).toContain(
        `${FIRST_PAGE.text} ${citationOf(FIRST_PAGE)}`,
      );
      expect(outcome.text).not.toContain("[>");
      expect(outcome.use).toBe("cited");
    },
    120000,
  );

  it.skipIf(!annotationSuggesterEnabled)(
    "finds an Annotation by its comment, and its row shows the comment",
    async () => {
      const outcome = await searchAndInsert(
        "[>figures hard",
        COMMENTED.comment!,
      );

      expect(outcome.rows).toEqual([
        expect.stringContaining(COMMENTED.comment!),
      ]);
    },
    120000,
  );

  it("draws an Annotation's rich text in its popover", async () => {
    const text = `${RICH.text} E = mc<sup>2</sup>`;
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(() => reread(RICH.key, RICH.text!));
    cleanup.use(rewriteAnnotationText(e2eFixture.databasePath, RICH.key, text));
    await reread(RICH.key, text);

    const hovered = await hover({
      url: durableLink(RICH.key, RICH.pageLabel),
      gesture: "reading",
    });

    expect(hovered).toMatchObject({ popover: true, sup: "2" });
    expect(hovered.text).not.toContain("<sup>");
  }, 180000);

  it.skipIf(!annotationSuggesterEnabled)(
    "draws an Annotation's rich text in its suggestion row",
    async () => {
      const text = `${RICH.text} E = mc<sup>2</sup>`;
      await using cleanup = new AsyncDisposableStack();
      cleanup.defer(() => reread(RICH.key, RICH.text!));
      cleanup.use(
        rewriteAnnotationText(e2eFixture.databasePath, RICH.key, text),
      );
      await reread(RICH.key, text);

      const searched = await searchAndInsert(
        "[>classically defined",
        "E = mc2",
      );

      expect(searched.sup).toBe("2");
      expect(searched.rows.join("")).not.toContain("<sup>");
    },
    180000,
  );

  it("places a one-line Annotation from its card right after a word, typing on", async () => {
    const text = await insertFromCard(FIRST_PAGE.key, {
      line: "As argued",
      ch: 9,
      inline: true,
      typeOn: "next",
    });

    expect(text).toBe(`# Draft\n\nAs argued ${inlineOf(FIRST_PAGE)} next`);
  }, 120000);

  it.skipIf(!annotationSuggesterEnabled)(
    "places a one-line Annotation from the Annotation Suggester right after a word, typing on",
    async () => {
      const outcome = await searchAndInsert(
        "[>MESSAGE tag:visualization color:blue",
        FIRST_PAGE.text!,
        { line: "As argued", ch: 9, inline: true, typeOn: "next" },
      );

      expect(outcome.text).toBe(
        `# Draft\n\nAs argued${inlineOf(FIRST_PAGE)} next`,
      );
    },
    120000,
  );

  it("opens the reader on the Annotation from its card's page chip", async () => {
    const url = durableLink(SECOND_PAGE.key, SECOND_PAGE.pageLabel);
    const lands = { page: 2, selected: [SECOND_PAGE.key] };

    const outcome = await follow({ note: "", url, gesture: "chip", lands });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
  }, 120000);

  it("hands a card's page chip to Zotero while the reader's open-file-links setting is off", async () => {
    const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);

    const outcome = await follow({
      note: "",
      url,
      gesture: "chip",
      captureOff: true,
    });

    expect(outcome).toMatchObject({
      reader: null,
      passed: [expect.objectContaining({ url })],
    });
  }, 120000);

  it("hands a card's page chip to Zotero while annotation links are set to open in Zotero", async () => {
    const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);

    const outcome = await follow({
      note: "",
      url,
      gesture: "chip",
      linkSettings: { "reader.open-annotation-links": false },
    });

    expect(outcome).toMatchObject({
      reader: null,
      passed: [expect.objectContaining({ url })],
    });
  }, 120000);

  it("hands a query block card's page chip to Zotero while annotation links are set to open in Zotero", async () => {
    const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);

    const outcome = await follow({
      note: [
        "```zotquery",
        "views:",
        "  - type: annotations",
        "    name: Annotations",
        "    from: annotations",
        `    filters: attachment.indexedKey == ${JSON.stringify(annotationAttachment.key)}`,
        "```",
        "",
      ].join("\n"),
      url,
      gesture: "block-chip",
      linkSettings: { "reader.open-annotation-links": false },
    });

    expect(outcome).toMatchObject({
      reader: null,
      passed: [expect.objectContaining({ url })],
    });
  }, 120000);

  it("opens the reader on the Annotation of the second Attachment of a shared PDF", async () => {
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await reindexed("unresolved");
    });
    cleanup.use(
      addSharedFileAttachment(e2eFixture.databasePath, FIRST_PAGE.key),
    );
    expect(await reindexed("resolved")).toBe(annotationAttachment.key);
    const url = durableLink(SHARED.annotationKey, FIRST_PAGE.pageLabel, {
      attachmentKey: SHARED.attachmentKey,
    });
    const lands = { page: 1, selected: [SHARED.annotationKey] };

    const outcome = await follow({
      note: noteWith(url),
      url,
      gesture: "reading",
      lands,
      bound: SHARED.attachmentKey,
      reads: true,
    });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
    expect(outcome.reads).toEqual([SHARED.attachmentKey]);
  }, 180000);

  it("rebinds a tab ZotLit found open to the other Attachment an open names, and the Annotation View follows each of two tabs on the shared PDF", async () => {
    await using cleanup = new AsyncDisposableStack();
    cleanup.defer(async () => {
      await reindexed("unresolved");
    });
    cleanup.use(
      addSharedFileAttachment(e2eFixture.databasePath, FIRST_PAGE.key),
    );
    expect(await reindexed("resolved")).toBe(annotationAttachment.key);

    const outcome = await sharedTabs();

    expect(outcome.reads.at(0)).toBe(annotationAttachment.key);
    expect(outcome.reads.at(-1)).toBe(SHARED.attachmentKey);
    expect(outcome).toMatchObject({
      restored: SHARED.attachmentKey,
      besideRestored: [SHARED.annotationKey],
      besideSecond: [...annotationKeys].sort(),
      passed: [],
    });
  }, 180000);

  it("still lands an Attachment File Link that carries an Annotation Anchor", async () => {
    const url = `${FILE_URL}#page=2&zt-annotation=${SECOND_PAGE.key}`;
    const lands = { page: 2, selected: [SECOND_PAGE.key] };

    const outcome = await follow({
      note: noteWith(url),
      url,
      gesture: "reading",
      lands,
    });

    expect(outcome).toMatchObject({ reader: lands, passed: [] });
  }, 120000);

  describe("hands the click to Zotero", () => {
    it.each([
      ["a PDF this computer does not hold", MISSING_PDF.key, "ZZZZZZZ2"],
      ["an Attachment Zotero does not know", "ZZZZZZZ3", FIRST_PAGE.key],
    ])(
      "for %s",
      async (_, attachmentKey, annotationKey) => {
        const url = durableLink(annotationKey, "1", { attachmentKey });

        const outcome = await follow({
          note: noteWith(url),
          url,
          gesture: "reading",
        });

        expect(outcome).toEqual({
          drawn: false,
          reader: null,
          passed: [expect.objectContaining({ url })],
          notices: [],
        });
      },
      120000,
    );

    it("while the reader's open-file-links setting is off", async () => {
      const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);

      const outcome = await follow({
        note: noteWith(url),
        url,
        gesture: "reading",
        captureOff: true,
      });

      expect(outcome).toMatchObject({
        reader: null,
        passed: [expect.objectContaining({ url })],
      });
    }, 120000);

    it("while annotation links are set to open in Zotero", async () => {
      const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);

      const outcome = await follow({
        note: noteWith(url),
        url,
        gesture: "reading",
        linkSettings: { "reader.open-annotation-links": false },
      });

      expect(outcome).toMatchObject({
        reader: null,
        passed: [expect.objectContaining({ url })],
      });
    }, 120000);

    it("for Obsidian's explicit external target", async () => {
      const url = durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel);

      const outcome = await follow({
        note: noteWith(url),
        url,
        gesture: "external",
      });

      expect(outcome).toMatchObject({
        reader: null,
        passed: [{ url, target: "_external" }],
      });
    }, 120000);
  });

  describe("shows the Annotation a hovered link names", () => {
    it.each(["live-preview", "reading"] as const)(
      "with its text, page label and colour in %s",
      async (gesture) => {
        const outcome = await hover({
          url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
          gesture,
        });

        expect(outcome).toMatchObject({
          popover: true,
          color: FIRST_PAGE.color,
          image: false,
        });
        expect(outcome.text).toContain(FIRST_PAGE.text);
        expect(outcome.text).toContain(
          run.m.annot_view_page({ page: FIRST_PAGE.pageLabel }),
        );
      },
      120000,
    );

    it("with its comment", async () => {
      const outcome = await hover({
        url: durableLink(COMMENTED.key, COMMENTED.pageLabel),
        gesture: "reading",
      });

      expect(outcome.text).toContain(COMMENTED.comment);
    }, 120000);

    it.each([
      ["an image", "live-preview", SECOND_PAGE],
      ["an ink", "reading", INK],
    ] as const)(
      "with the Excerpt Image of %s Annotation",
      async (_, gesture, annotation) => {
        const outcome = await hover({
          url: durableLink(annotation.key, annotation.pageLabel),
          gesture,
          image: true,
        });

        expect(outcome).toMatchObject({ popover: true, image: true });
      },
      120000,
    );

    it("as the popover under Page Preview, with Mod held", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "reading",
        hoverAction: "page-preview",
        mod: true,
      });

      expect(outcome.text).toContain(FIRST_PAGE.text);
    }, 120000);

    it("under Page Preview without Mod", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "reading",
        hoverAction: "page-preview",
      });

      expect(outcome.text).toContain(FIRST_PAGE.text);
    }, 120000);

    it("under Page Preview without Mod once ZotLit's Page preview row asks for none", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "live-preview",
        hoverAction: "page-preview",
        pagePreviewMod: false,
      });

      expect(outcome.text).toContain(FIRST_PAGE.text);
    }, 120000);

    it("in Source mode with Mod held", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "source",
        mod: true,
      });

      expect(outcome.text).toContain(FIRST_PAGE.text);
    }, 120000);

    it("in one place in Source mode while the pointer crosses from the text to the URL", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "source",
        mod: true,
        crossToUrl: true,
      });

      expect(outcome.text).toContain(FIRST_PAGE.text);
      expect(outcome.crossed).toEqual({
        same: true,
        moved: false,
        text: outcome.text,
      });
    }, 120000);

    it("in Source mode without Mod", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "source",
      });

      expect(outcome.text).toContain(FIRST_PAGE.text);
    }, 120000);

    it("while Pandoc citations are off", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "live-preview",
        pandocOff: true,
      });

      expect(outcome.text).toContain(FIRST_PAGE.text);
    }, 120000);

    it("while annotation links are set to open in Zotero", async () => {
      const outcome = await hover({
        url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
        gesture: "live-preview",
        linkSettings: { "reader.open-annotation-links": false },
      });

      expect(outcome.text).toContain(FIRST_PAGE.text);
    }, 120000);

    it.each(["live-preview", "reading"] as const)(
      "while the citation Hover Action is off, in %s",
      async (gesture) => {
        const outcome = await hover({
          url: durableLink(FIRST_PAGE.key, FIRST_PAGE.pageLabel),
          gesture,
          hoverAction: "off",
        });

        expect(outcome.text).toContain(FIRST_PAGE.text);
      },
      120000,
    );

    it("with nothing for a Zotero link that names no Annotation", async () => {
      const outcome = await hover({
        url: `zotero://select/library/items/${annotationAttachment.key}`,
        gesture: "reading",
        absent: true,
      });

      expect(outcome.popover).toBe(false);
    }, 120000);

    it.each([
      ["an Annotation Zotero no longer has", durableLink("ZZZZZZZ2", "1")],
      [
        "an Attachment Zotero does not know",
        durableLink(FIRST_PAGE.key, "1", { attachmentKey: "ZZZZZZZ3" }),
      ],
    ])(
      "as unavailable for %s",
      async (_, url) => {
        const outcome = await hover({ url, gesture: "live-preview" });

        expect(outcome.popover).toBe(true);
        expect(outcome.text).toContain(run.m.annotation_popover_unavailable());
      },
      120000,
    );
  });
});
