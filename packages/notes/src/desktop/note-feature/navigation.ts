import type { ProfileDialogServices } from "#desktop/profile/dialogs.ts";
import type { ProfileOperationError } from "#obsidian/profile/service.ts";
import type { TemplateFailure } from "#obsidian/template/service.ts";
import type { Cause } from "effect";
import { Effect } from "effect";
import type { RpcClientError } from "effect/rpc";
import type { PaneType, TFile, WorkspaceLeaf } from "obsidian";

import type { Item } from "@zotlit/db";
import { Workspace } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import type { OpenLinkFailed } from "@zotlit/obsidian-kit/obsidian-workspace.ts";
import { NoteIndex } from "@zotlit/plugin-services/obsidian/note-index/service.ts";
import { UseLedger } from "@zotlit/plugin-services/obsidian/use-ledger/service.ts";
import { readActionItem } from "@zotlit/zotero-reads/client/read-item.ts";
import { ZoteroReads } from "@zotlit/zotero-reads/client/service.ts";
import type {
  DbUnavailable,
  SnapshotExpired,
} from "@zotlit/zotero-reads/contract/rpc.ts";

import type { CompanionLinkOptions } from "./companion-view.ts";
import type { InteractiveCreationPorts } from "./creation-view.ts";
import { createNoteInteractively } from "./creation-view.ts";
import type { CompanionNoteTarget } from "./operations.ts";
import { NoteFeature } from "./service.ts";
import {
  resolveLiteratureNoteWithWarning,
  updateWithNotice,
  updateNoteToast,
} from "./update-single.ts";

export type LiteratureNoteOutcome =
  | { readonly outcome: "refused"; readonly target: CompanionNoteTarget }
  | { readonly outcome: "opened-as-is"; readonly target: CompanionNoteTarget }
  | { readonly outcome: "opened"; readonly file: TFile }
  | { readonly outcome: "metadata-no-note" }
  | { readonly outcome: "item-not-found" }
  | { readonly outcome: "created"; readonly file: TFile }
  | { readonly outcome: "not-created" };

type LiteratureNoteOptions =
  | ({ readonly source: "companion" } & CompanionLinkOptions)
  | {
      readonly source: "interactive";
      readonly item?: Item;
      readonly paneType: PaneType | boolean;
    }
  | {
      readonly source: "interactive";
      readonly item?: Item;
      readonly beside: WorkspaceLeaf;
    };

export const openLiteratureNote = Effect.fn("LiteratureNoteNavigation.open")(
  function* (
    deps: InteractiveCreationPorts,
    indexedKey: string,
    options: LiteratureNoteOptions,
  ): Effect.fn.Return<
    LiteratureNoteOutcome,
    | ProfileOperationError
    | DbUnavailable
    | SnapshotExpired
    | RpcClientError.RpcClientError
    | TemplateFailure
    | OpenLinkFailed
    | Cause.UnknownError,
    Workspace | NoteIndex | UseLedger | ZoteroReads | ProfileDialogServices
  > {
    const workspace = yield* Workspace;
    const noteFeature = yield* NoteFeature;
    const open = Effect.fnUntraced(function* (file: TFile) {
      const beside =
        options.source === "interactive" && "beside" in options
          ? options.beside
          : null;
      if (
        beside ||
        (options.source === "interactive" &&
          "paneType" in options &&
          !options.paneType)
      ) {
        const existing = (yield* workspace.leavesOfType("markdown")).find(
          (leaf) => leaf.getViewState().state?.file === file.path,
        );
        if (existing) {
          yield* workspace.revealLeaf(existing);
          yield* workspace.setActiveLeaf(existing, { focus: true });
          return;
        }
      }
      if (beside) yield* workspace.setActiveLeaf(beside, { focus: false });
      const navigate = workspace.openLinkText(file.path, "", {
        newLeaf: beside
          ? "split"
          : "paneType" in options
            ? (options.paneType ?? false)
            : false,
        state: { active: true },
      });
      return yield* options.source === "companion" &&
      options.action === "update"
        ? (yield* UseLedger).withoutNoteUse(file, navigate)
        : navigate;
    });
    const target: CompanionNoteTarget =
      options.source === "companion"
        ? yield* noteFeature.resolveCompanionNote(indexedKey, {
            profile: options.profile,
          })
        : yield* Effect.gen(function* () {
            const index = yield* NoteIndex;
            yield* index.whenIndexed;
            const files = yield* index.getNotesByItemKey(indexedKey);
            const [file, ...rest] = files;
            return file
              ? {
                  outcome: "existing" as const,
                  files: [file, ...rest] as const,
                }
              : { outcome: "create" as const };
          });
    if (target.outcome === "refused") return { outcome: "refused", target };
    if (target.outcome === "existing") {
      const file = resolveLiteratureNoteWithWarning(target.files)!;
      yield* open(file);
      if (target.keptProfile || target.diagnostic)
        return { outcome: "opened-as-is", target };
      if (options.source === "companion" && options.action === "update") {
        const scope = options.scope ?? "full";
        yield* updateWithNotice(
          file,
          { indexedKey, scope },
          updateNoteToast(scope, { app: deps.app }),
        );
      }
      return { outcome: "opened", file };
    }
    if (
      options.source === "companion" &&
      options.action === "update" &&
      options.scope === "metadata"
    )
      return { outcome: "metadata-no-note" };
    const item =
      options.source === "interactive"
        ? (options.item ?? (yield* readActionItem(indexedKey)))
        : (yield* (yield* ZoteroReads).reads.ItemsByIndexedKeys({
            indexedKeys: [indexedKey],
          })).get(indexedKey);
    if (!item) return { outcome: "item-not-found" };
    const file = yield* createNoteInteractively(deps, item, {
      ...(options.source === "companion" && {
        headless: options.profile,
        direct: true,
      }),
    });
    if (!file) return { outcome: "not-created" };
    yield* open(file);
    return { outcome: "created", file };
  },
);
