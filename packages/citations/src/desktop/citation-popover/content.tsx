import type { Inlines } from "#core/pandoc/ast.ts";
import type {
  AmbiguousCitationBlock,
  CitationEntryBlock,
  CitationPopoverBlock,
  UnresolvedCitationBlock,
} from "#obsidian/citation-popover/blocks.ts";
import type { ProfilePresentationFailure } from "#obsidian/pandoc/document-presentation.ts";
import type { IconName } from "obsidian";
import type { MouseEvent, ReactNode } from "react";

import { Button } from "@zotlit/obsidian-kit/components/obsidian/button.tsx";
import { IconButton } from "@zotlit/obsidian-kit/components/obsidian/icon-button.tsx";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { CitationPopoverActions } from "./actions.ts";

import { AmbiguousCandidates } from "#obsidian/citation-index/ambiguous-candidates.tsx";
import { InlineContent } from "#obsidian/pandoc/inline-content.tsx";

export interface CitationPopoverContentProps {
  blocks: readonly CitationPopoverBlock[];
  note?: Inlines;
  profileFailure?: ProfilePresentationFailure;
  actions: CitationPopoverActions;
  pending?: boolean;
  unavailable?: "database" | "item";
}

export function CitationPopoverContent({
  blocks,
  note,
  profileFailure,
  actions,
  pending = false,
  unavailable,
}: CitationPopoverContentProps) {
  if (unavailable) {
    return (
      <div className={cn(blockClass, "zt:text-destructive")} role="status">
        {unavailable === "database"
          ? m.citation_popover_database_unavailable()
          : m.citation_popover_item_unavailable()}
      </div>
    );
  }
  return (
    <>
      {profileFailure && (
        <ProfileFailure failure={profileFailure} actions={actions} />
      )}
      {note?.length ? (
        <NoteCitation
          note={note}
          blocks={blocks}
          actions={actions}
          pending={pending}
        />
      ) : (
        <EntryStack blocks={blocks} actions={actions} pending={pending} />
      )}
    </>
  );
}

function ProfileFailure({
  failure,
  actions,
}: {
  failure: ProfilePresentationFailure;
  actions: CitationPopoverActions;
}) {
  return (
    <div
      className={cn(blockClass, "zt:text-destructive")}
      data-citation-popover-profile-error
    >
      {m.notice_imported_note_profile_unknown({
        stamp: failure.diagnostic.stamp,
        target: failure.target,
      })}
      <Button
        data-profile-recovery
        onClick={() => {
          actions.onDone();
          actions.onSwitchProfile(failure.target);
        }}
      >
        {m.profile_switch_recovery()}
      </Button>
    </div>
  );
}

function EntryStack({
  blocks,
  actions,
  pending,
}: {
  blocks: readonly CitationPopoverBlock[];
  actions: CitationPopoverActions;
  pending: boolean;
}) {
  return (
    <>
      {blocks.map((block, index) => (
        <div
          key={`${block.citekey}-${index}`}
          className={blockClass}
          data-citation-popover-block={block.citekey ?? ""}
        >
          {block.kind === "entry" ? (
            <>
              <Entry block={block} />
              <EntryActions block={block} actions={actions} />
            </>
          ) : (
            <Broken block={block} pending={pending} />
          )}
        </div>
      ))}
    </>
  );
}

function NoteCitation({
  note,
  blocks,
  actions,
  pending,
}: {
  note: Inlines;
  blocks: readonly CitationPopoverBlock[];
  actions: CitationPopoverActions;
  pending: boolean;
}) {
  return (
    <div className={blockClass} data-citation-popover-note>
      <div className={cn(entryTextClass, "zt:text-foreground zt:select-text")}>
        <InlineContent nodes={note} />
      </div>
      <div className="zt:flex zt:flex-col zt:gap-1">
        {blocks.map((block, index) => (
          <div
            key={`${block.citekey}-${index}`}
            className="zt:grid zt:grid-cols-[max-content_minmax(0,1fr)] zt:items-center zt:gap-x-2"
            data-citation-popover-block={block.citekey ?? ""}
          >
            <span className={cn(gutterClass, themeHook.entrySerial)}>
              {serialLabel(block, pending)}
            </span>
            {block.kind === "entry" ? (
              <EntryActions block={block} actions={actions} />
            ) : (
              <Broken block={block} pending={pending} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Broken({
  block,
  pending,
}: {
  block: UnresolvedCitationBlock | AmbiguousCitationBlock;
  pending: boolean;
}) {
  if (block.kind === "unresolved") {
    if (pending) {
      return (
        <div className={cn(entryTextClass, "zt:text-muted-foreground")}>
          {m.references_citekey_pending({ citekey: block.citekey })}
        </div>
      );
    }
    return (
      <div className={cn(entryTextClass, "zt:text-destructive")}>
        {m.references_citekey_unresolved({ citekey: block.citekey })}
      </div>
    );
  }
  return (
    <div className="zt:flex zt:flex-col zt:gap-1">
      <div className={cn(entryTextClass, "zt:text-destructive")}>
        {m.references_citekey_ambiguous({ citekey: block.citekey })}
      </div>
      <AmbiguousCandidates
        candidates={block.candidates}
        textClass={entryTextClass}
      />
    </div>
  );
}

function serialLabel(block: CitationPopoverBlock, pending: boolean): ReactNode {
  const serial = block.kind === "entry" ? block.serial : undefined;
  return (
    serial ?? (pending && block.kind === "unresolved" ? PENDING : NO_ENTRY)
  );
}

const blockClass =
  "zt-citation-popover-block zt:flex zt:flex-col zt:gap-1 zt:border-t zt:border-border zt:px-3 zt:py-2 zt:first:border-t-0";

const entryTextClass =
  "zt:font-content zt:text-sm zt:leading-snug zt:break-words";

const gutterClass =
  "zt:min-w-5 zt:text-right zt:text-xs zt:text-muted-foreground zt:tabular-nums";

const NO_ENTRY = "⚠";

const PENDING = "…";

function Entry({ block }: { block: CitationEntryBlock }) {
  const gutter = entryGutter(block);
  return (
    <div
      className={cn(
        "zt:grid zt:items-baseline zt:gap-x-2",
        gutter === null
          ? "zt:grid-cols-[minmax(0,1fr)]"
          : "zt:grid-cols-[max-content_minmax(0,1fr)]",
      )}
    >
      {gutter !== null && <span className={gutterClass}>{gutter}</span>}
      <div className={cn(entryTextClass, "zt:text-foreground zt:select-text")}>
        {block.content === null ? (
          block.summary
        ) : (
          <InlineContent nodes={block.content} />
        )}
      </div>
    </div>
  );
}

function entryGutter(block: CitationEntryBlock): ReactNode {
  if (block.marker) return <InlineContent nodes={block.marker} />;
  return block.serial ?? null;
}

function EntryActions({
  block,
  actions,
}: {
  block: CitationEntryBlock;
  actions: CitationPopoverActions;
}) {
  return (
    <div
      className="zt:flex zt:items-center zt:gap-0.5"
      data-citation-popover-actions
    >
      <EntryAction
        icon="file-text"
        label={m.references_open_note()}
        onClick={(event) => {
          actions.onOpenNote(block, event);
          actions.onDone();
        }}
      />
      <EntryAction
        icon="external-link"
        label={m.references_open_in_zotero()}
        onClick={() => {
          actions.onOpenInZotero(block);
          actions.onDone();
        }}
      />
      <EntryAction
        icon="library"
        label={m.library_view_show_in_library()}
        onClick={() => {
          actions.onShowInLibrary(block);
          actions.onDone();
        }}
      />
      {(block.attachments === "unreadable" || block.attachments.length > 0) && (
        <EntryAction
          icon="paperclip"
          label={m.references_open_attachment()}
          onClick={(event) => {
            actions.onOpenAttachment(block, event);
            actions.onDone();
          }}
        />
      )}
    </div>
  );
}

const compactIconButton = "zt:p-1 zt:[--icon-size:var(--icon-xs)]";

function EntryAction({
  icon,
  label,
  onClick,
}: {
  icon: IconName;
  label: string;
  onClick: (event: MouseEvent<HTMLElement>) => void;
}) {
  return (
    <IconButton
      icon={icon}
      onClick={onClick}
      onAuxClick={(event) => {
        if (event.button === 1) onClick(event);
      }}
      className={compactIconButton}
      {...tooltipAttrs(label)}
    />
  );
}
