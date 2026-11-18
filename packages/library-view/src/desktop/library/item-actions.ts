// What the Library View does with the Item of a row: the operations its keys,
// its row menu and its drag run. Each runs the operation another surface
// runs: the quick switcher's note and PDF opens, the citation insert of the
// "Insert Markdown citation" command, and the `zotero://select` link of the
// citation popover.
//
// @see apps/obsidian/docs/adr/0074-library-view-rows-act-as-quick-switcher-results.md
import type { Scope } from "effect";
import { Effect, Exit } from "effect";
import type { Editor, MarkdownFileInfo, PaneType } from "obsidian";

import type { AttachmentOpenDeps } from "@zotlit/annotations/desktop/attachment-open/actions.ts";
import { pdfPickerReader } from "@zotlit/annotations/desktop/attachment-open/actions.ts";
import {
  openAttachments,
  withFixedPane,
} from "@zotlit/annotations/desktop/attachment-open/open-attachments.ts";
import { viewTargetOpener } from "@zotlit/annotations/desktop/attachment-open/view-opener.ts";
import { captureInsertion } from "@zotlit/annotations/obsidian/annot-view/async-insert.ts";
import { getInsertionEditor } from "@zotlit/annotations/obsidian/annot-view/drag-insert.ts";
import { literatureNoteAttachments } from "@zotlit/annotations/obsidian/attachment-open/literature-note.ts";
import { CitationLookup } from "@zotlit/citations/obsidian/citation-index/lookup-service.ts";
import type { Item } from "@zotlit/db";
import { InertTemplateError } from "@zotlit/notes/core/template/errors.ts";
import type { InteractiveCreationPorts } from "@zotlit/notes/desktop/note-feature/creation-view.ts";
import { openLiteratureNote } from "@zotlit/notes/desktop/note-feature/navigation.ts";
import type { NoteFeatureHandle } from "@zotlit/notes/desktop/note-feature/operations.ts";
import { Notifier, reportOutcome } from "@zotlit/obsidian-kit/notifier.ts";
import { viewRuntime } from "@zotlit/obsidian-kit/view-atoms.ts";
import type {
  ViewRegistryHandle,
  ViewServices,
} from "@zotlit/obsidian-kit/view-atoms.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import { readActionItem } from "@zotlit/zotero-reads/client/read-item.ts";
import { parseIndexedKey } from "@zotlit/zotero-types/keys";
import { itemSelectUri } from "@zotlit/zotero-types/uri";

import { lastEditor } from "#obsidian/library/last-note.ts";

/**
 * Runs one Item action at a time per call, beside the others. A failure is
 * logged here, where the gesture that started it has nothing to show.
 */
export const libraryItemCommand = viewRuntime.fn(
  (effect: Effect.Effect<void, unknown, ViewServices | Scope.Scope>) =>
    effect.pipe(
      Effect.scoped,
      recover(
        (error) =>
          Effect.logWarning("The Library View could not run an Item action", {
            error,
          }),
        Effect.void,
      ),
      withLogCategory("library-view"),
    ),
  { concurrent: true },
);

export type ItemActionsDeps = Pick<AttachmentOpenDeps, "app" | "opener"> & {
  registry: ViewRegistryHandle;
  noteFeature: Pick<NoteFeatureHandle, "renderCitation">;
  creation: InteractiveCreationPorts;
  /**
   * Hands a `zotero://` link to the system.
   * @default window.open
   */
  openUri?: (uri: string) => void;
};

/** Where a citation goes: an editor, at its selection or at `at`. */
export interface CitationTarget {
  editor: Editor;
  info: MarkdownFileInfo;
  /** The offset to insert at; the editor's selection where absent. */
  at?: number;
}

/** What a row of the Library View can do with its Item, by Indexed Key. */
export interface ItemActions {
  /** Open the Literature Note, or write it through the Profile selection. */
  openNote(indexedKey: string, pane: PaneType | boolean): void;
  /** Open the PDF in Obsidian. */
  openPdf(indexedKey: string, pane: PaneType | boolean): void;
  /** Insert the Item's citation into `target`, or the note the researcher was last in. */
  insertCitation(indexedKey: string, target?: CitationTarget): void;
  copyCitationKey(indexedKey: string): void;
  /** Select the Item in Zotero, which the system starts where it is closed. */
  showInZotero(indexedKey: string): void;
}

export function itemActions(deps: ItemActionsDeps): ItemActions {
  const run = (
    effect: Effect.Effect<void, unknown, ViewServices | Scope.Scope>,
  ): void => deps.registry.set(libraryItemCommand, effect);
  const resolveCitation = (item: Item) =>
    Effect.gen(function* () {
      const citationKey =
        "citationKey" in item.fields ? item.fields.citationKey : null;
      const notice = (message: string) => ({
        kind: "notice" as const,
        message,
      });
      if (!citationKey) return notice(m.notice_no_citekey({ key: item.key }));
      const lookup = yield* CitationLookup;
      if ((yield* lookup.current).status === "pending")
        return notice(m.notice_citekey_not_ready());
      const answer = yield* lookup
        .read({ citekeys: [citationKey] })
        .pipe(Effect.option);
      if (answer._tag === "None") return notice(m.notice_citekey_not_ready());
      if (answer.value.resolve(citationKey).kind === "ambiguous")
        return notice(
          m.notice_citekey_ambiguous_insert({ citekey: citationKey }),
        );
      const rendered = yield* Effect.sync(() => {
        try {
          return deps.noteFeature.renderCitation(
            [{ citationKey, item }],
            "main",
          );
        } catch (error) {
          if (error instanceof InertTemplateError) return notice(error.message);
          throw error;
        }
      });
      if (rendered === null) return notice(m.notice_template_not_ready());
      return typeof rendered === "string"
        ? { kind: "insert" as const, text: rendered }
        : rendered;
    });
  return {
    openNote: (indexedKey, pane) =>
      run(
        Effect.asVoid(
          openLiteratureNote(deps.creation, indexedKey, {
            source: "interactive",
            paneType: pane,
          }),
        ),
      ),
    openPdf: (indexedKey, pane) =>
      run(
        Effect.gen(function* () {
          const attachments = yield* literatureNoteAttachments(indexedKey);
          openAttachments(attachments, {
            reader: withFixedPane(
              pdfPickerReader(viewTargetOpener(deps.registry, deps.opener)),
              pane,
            ),
            app: deps.app,
          });
        }),
      ),
    insertCitation: (indexedKey, target) =>
      run(
        Effect.gen(function* () {
          const into = target ?? editorTarget(deps);
          if (!into) {
            yield* Notifier.use((notifier) =>
              notifier.show(m.library_view_cite_no_note()),
            );
            return;
          }
          const { editor, info } = into;
          const file = info.file;
          const at = into.at;
          const insertion = yield* Effect.acquireDisposable(
            Effect.sync(() =>
              captureInsertion({
                editor,
                info,
                ...(at !== undefined && { range: { from: at, to: at } }),
                isCurrent: () => info.file === file && info.editor === editor,
                workspace: deps.app.workspace,
              }),
            ),
          );
          const item = yield* readActionItem(indexedKey);
          if (!item) return;
          const outcome = yield* resolveCitation(item);
          if (outcome.kind === "notice") {
            yield* Notifier.use((notifier) => notifier.show(outcome.message));
            return;
          }
          if (
            outcome.text.length > 0 &&
            insertion.commit(outcome.text, { kind: "citation" })
          )
            yield* (yield* UseLedger).record(indexedKey, "cited");
        }),
      ),
    copyCitationKey: (indexedKey) =>
      run(
        Effect.gen(function* () {
          const item = yield* readActionItem(indexedKey);
          if (!item) return;
          const citationKey =
            "citationKey" in item.fields ? item.fields.citationKey : null;
          if (!citationKey) {
            yield* Notifier.use((notifier) =>
              notifier.show(m.notice_no_citekey({ key: item.key })),
            );
            return;
          }
          const copied = yield* Effect.exit(
            Effect.tryPromise(() => navigator.clipboard.writeText(citationKey)),
          );
          yield* reportOutcome(copied, {
            success: () => m.graph_citations_citekey_copied(),
            error: () => m.graph_citations_citekey_copy_failed(),
          });
          if (Exit.isSuccess(copied))
            yield* (yield* UseLedger).record(indexedKey, "cited");
        }),
      ),
    showInZotero: (indexedKey) => {
      const parsed = parseIndexedKey(indexedKey);
      if (!parsed) return;
      (deps.openUri ?? ((uri) => window.open(uri)))(
        itemSelectUri(parsed.key, parsed.groupID),
      );
    },
  };
}

/**
 * The note the researcher was last in: the one an annotation insert finds,
 * else, while the Library View is the active tab, the note in Source mode
 * or Live Preview that was active last.
 */
function editorTarget({
  app,
}: Pick<ItemActionsDeps, "app">): CitationTarget | null {
  const info = getInsertionEditor(app) ?? lastEditor(app.workspace);
  if (!info?.file || !info.editor) return null;
  return { editor: info.editor, info };
}
