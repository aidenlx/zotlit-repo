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
import { literatureNoteAttachments } from "@zotlit/annotations/obsidian/attachment-open/literature-note.ts";
import { CitationLookup } from "@zotlit/citations/obsidian/citation-index/lookup-service.ts";
import type { Item } from "@zotlit/db";
import { InertTemplateError } from "@zotlit/notes/core/template/errors.ts";
import type { InteractiveCreationPorts } from "@zotlit/notes/desktop/note-feature/creation-view.ts";
import { openLiteratureNote } from "@zotlit/notes/desktop/note-feature/navigation.ts";
import type { NoteFeatureHandle } from "@zotlit/notes/desktop/note-feature/operations.ts";
import { Notifier, reportOutcome } from "@zotlit/obsidian-kit/notifier.ts";
import type { VaultDisk } from "@zotlit/obsidian-kit/obsidian-vault-disk.ts";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { viewRuntime } from "@zotlit/obsidian-kit/view-atoms.ts";
import type {
  ViewRegistryHandle,
  ViewServices,
} from "@zotlit/obsidian-kit/view-atoms.ts";
import { scopedBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";
import { recover } from "@zotlit/plugin-kernel/effect-cause.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { filterTag } from "@zotlit/plugin-kernel/effect-stream.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import { readActionItem } from "@zotlit/zotero-reads/client/read-item.ts";
import { parseIndexedKey } from "@zotlit/zotero-types/keys";
import { itemSelectUri } from "@zotlit/zotero-types/uri";

import { lastEditor } from "#obsidian/library/last-note.ts";

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
  openUri?: (uri: string) => void;
};

export interface CitationTarget {
  editor: Editor;
  info: MarkdownFileInfo;
  at?: number;
}

export interface ItemActions {
  openNote(indexedKey: string, pane: PaneType | boolean): void;
  openPdf(indexedKey: string, pane: PaneType | boolean): void;
  insertCitation(indexedKey: string, target?: CitationTarget): void;
  copyCitationKey(indexedKey: string): void;
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
          const workspace = yield* Workspace;
          const bridge = yield* scopedBridge;
          const into = target ?? (yield* editorTarget(workspace));
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
                watchChanges: (validate) =>
                  bridge.subscribe(
                    filterTag(
                      workspace.changes,
                      "active-leaf-change",
                      "layout-change",
                    ),
                    validate,
                  ),
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

const editorTarget = Effect.fnUntraced(function* (
  workspace: Workspace["Service"],
): Effect.fn.Return<CitationTarget | null> {
  const info =
    (yield* workspace.insertionEditor) ??
    lastEditor(
      yield* workspace.markdownViews,
      (yield* workspace.getActiveFile)?.path,
      yield* workspace.lastOpenFiles,
    );
  if (!info?.file || !info.editor) return null;
  return { editor: info.editor, info };
});

declare module "@zotlit/obsidian-kit/view-atoms.ts" {
  interface ViewServiceRegistry {
    VaultDisk: VaultDisk;
  }
}
