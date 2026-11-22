import type { ReferenceSource } from "#obsidian/citation-index/service.ts";
import type { DocumentPresentationFailure } from "#obsidian/pandoc/document-presentation.ts";
import type { PandocEngineStatus } from "#obsidian/pandoc/service.ts";
import type { ReferenceEntry } from "#obsidian/references/entries.ts";
import type { ReferencesCopyBlock } from "#obsidian/references/state.ts";
import { useAtomValue } from "@effect/atom-react";
import type { IconName } from "obsidian";
import type { MouseEvent, ReactNode } from "react";

import { Button } from "@zotlit/obsidian-kit/components/obsidian/button.tsx";
import { IconButton } from "@zotlit/obsidian-kit/components/obsidian/icon-button.tsx";
import { SidebarToolbar } from "@zotlit/obsidian-kit/components/sidebar-toolbar.tsx";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { openResourcePackPage } from "@zotlit/plugin-services/obsidian/managed-binary/pack-platform.ts";
import { packStatusSentence } from "@zotlit/plugin-services/obsidian/managed-binary/pack-row.ts";

import { useReferenceActions } from "./actions.ts";
import { useReferencesModel } from "./model.ts";

import { AmbiguousCandidates } from "#obsidian/citation-index/ambiguous-candidates.tsx";
import { InlineContent } from "#obsidian/pandoc/inline-content.tsx";
import { engineUsable } from "#obsidian/pandoc/service.ts";

export function References() {
  const actions = useReferenceActions();
  const {
    entries,
    listMode,
    engine,
    engineHintDismissed,
    formattingFailed,
    documentPresentationError,
    dbReady,
  } = useAtomValue(useReferencesModel().state);
  const numbered = listMode.kind === "minimal";
  const serials = listMode.kind === "bibliography" && listMode.entrySerials;
  const guttered =
    numbered ||
    serials ||
    (listMode.kind === "bibliography" && listMode.hasEntryMarkers);

  return (
    <div className="zt:flex zt:h-full zt:flex-col zt:overflow-hidden">
      <Toolbar />
      <div
        className="zt:flex zt:min-h-0 zt:flex-1 zt:flex-col zt:overflow-y-auto"
        data-references-scroll
      >
        <EngineSurface status={engine} hintDismissed={engineHintDismissed} />
        {documentPresentationError !== null && engineUsable(engine) && (
          <Banner
            tone="warning"
            title={documentPresentationTitle(documentPresentationError)}
          >
            {documentPresentationBody(documentPresentationError)}
            {documentPresentationError.property === "profile" && (
              <Button
                data-profile-recovery
                onClick={() =>
                  actions.onSwitchProfile(documentPresentationError.target)
                }
              >
                {m.profile_switch_recovery()}
              </Button>
            )}
          </Banner>
        )}
        {formattingFailed && engineUsable(engine) && (
          <Banner tone="warning" title={m.references_format_failed_title()}>
            {m.references_format_failed_body()}
          </Banner>
        )}
        {entries.length === 0 ? (
          <div
            className="zt:mx-auto zt:my-2 zt:px-4 zt:py-6 zt:text-center zt:text-sm zt:text-faint"
            data-references-empty
          >
            {dbReady ? m.references_empty() : m.references_db_unavailable()}
          </div>
        ) : (
          <ul
            className={cn(
              "zt:grid zt:gap-x-2 zt:text-sm",
              guttered
                ? "zt:grid-cols-[max-content_minmax(0,1fr)_max-content]"
                : "zt:grid-cols-[minmax(0,1fr)_max-content]",
            )}
          >
            {entries.map((entry) => (
              <Reference
                key={entry.id}
                entry={entry}
                numbered={numbered}
                serials={serials}
                guttered={guttered}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Toolbar() {
  const actions = useReferenceActions();
  const copy = useAtomValue(useReferencesModel().state).copy;
  const copyReady = copy.kind === "ready";

  return (
    <SidebarToolbar className="zt:shrink-0">
      <SidebarToolbar.Actions className="zt:w-full">
        <IconButton
          icon="clipboard-copy"
          data-references-copy-bibliography
          disabled={!copyReady}
          {...tooltipAttrs(
            copyReady
              ? m.references_copy_bibliography()
              : copyBlockedReason(copy.reason),
          )}
          onClick={() => {
            if (copy.kind === "ready") {
              void actions.onCopyBibliography(copy.target);
            }
          }}
        />
        <IconButton
          icon="book-type"
          data-references-change-style
          {...tooltipAttrs(m.references_change_style())}
          onClick={actions.onChangeStyle}
        />
      </SidebarToolbar.Actions>
    </SidebarToolbar>
  );
}

function documentPresentationTitle(
  failure: DocumentPresentationFailure,
): string {
  switch (failure.property) {
    case "language":
      return m.references_document_language_failed_title();
    case "profile":
      return m.references_document_profile_failed_title();
    case "profile-style":
      return m.references_profile_style_failed_title();
    case "style":
      return m.references_document_style_failed_title();
  }
}

function documentPresentationBody(
  failure: DocumentPresentationFailure,
): string {
  switch (failure.property) {
    case "language":
      return m.references_document_language_failed_body();
    case "profile":
      return m.notice_imported_note_profile_unknown({
        stamp: failure.diagnostic.stamp,
        target: failure.target,
      });
    case "profile-style":
      return m.references_profile_style_failed_body({
        style: failure.styleId,
      });
    case "style":
      return m.references_document_style_failed_body();
  }
}

function copyBlockedReason(reason: ReferencesCopyBlock): string {
  switch (reason) {
    case "no-note":
      return m.references_copy_blocked_no_note();
    case "no-references":
      return m.references_copy_blocked_no_references();
    case "pending":
      return m.references_copy_blocked_pending();
    case "unavailable":
      return m.references_copy_blocked_unavailable();
    case "failed":
      return m.references_copy_blocked_failed();
    case "errors":
      return m.references_copy_blocked_errors();
  }
}

const revealOnHover =
  "zt:opacity-0 zt:transition-opacity zt:delay-0 zt:duration-150 zt:group-focus-within:opacity-100 zt:group-hover:opacity-100 zt:group-hover:delay-100";

const compactIconButton = "zt:p-1 zt:[--icon-size:var(--icon-xs)]";

function Reference({
  entry,
  numbered,
  serials,
  guttered,
}: {
  entry: ReferenceEntry;
  numbered: boolean;
  serials: boolean;
  guttered: boolean;
}) {
  const actions = useReferenceActions();
  const pending =
    useAtomValue(useReferencesModel().state).citekeyResolution === null;
  const presentation = referencePresentation(entry, {
    numbered,
    serials,
    pending,
  });
  const { source } = presentation;
  const occurrenceCount = entry.occurrences.length;

  return (
    <li className="zt:group zt:col-span-full zt:grid zt:grid-cols-subgrid zt:items-baseline zt:border-b zt:border-border zt:px-3 zt:py-2">
      {guttered && (
        <span
          className={cn(
            "zt:min-w-5 zt:text-right zt:text-xs zt:text-muted-foreground zt:tabular-nums",
            presentation.warning && "zt:text-destructive",
          )}
        >
          {presentation.gutter}
        </span>
      )}
      <div className="zt:min-w-0">
        <div className="zt:select-text">
          <ReferenceBody entry={entry} pending={pending} />
        </div>
        <div className="zt:grid zt:grid-rows-[0fr] zt:transition-[grid-template-rows] zt:delay-0 zt:duration-150 zt:ease-out zt:group-focus-within:grid-rows-[1fr] zt:group-hover:grid-rows-[1fr] zt:group-hover:delay-100">
          <div className={cn("zt:overflow-hidden", revealOnHover)}>
            <div className="zt:flex zt:items-center zt:gap-0.5 zt:pt-1">
              <EntryAction
                icon="file-text"
                label={presentation.noteLabel}
                disabled={presentation.noteDisabled}
                onClick={() => actions.onOpenNote(entry)}
              />
              {source && (
                <>
                  <EntryAction
                    icon="external-link"
                    label={m.references_open_in_zotero()}
                    onClick={() => actions.onOpenInZotero(source)}
                  />
                  <EntryAction
                    icon="library"
                    label={m.library_view_show_in_library()}
                    onClick={() => actions.onShowInLibrary(source)}
                  />
                  {source.attachments.length > 0 && (
                    <EntryAction
                      icon="paperclip"
                      label={m.references_open_attachment()}
                      onClick={(event) =>
                        actions.onOpenAttachment(source, event)
                      }
                    />
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="zt:relative zt:self-start">
        <EntryAction
          icon="chevron-right"
          label={m.references_go_to_occurrence({ count: occurrenceCount })}
          onClick={() => actions.onSelect(entry)}
        />
        {occurrenceCount > 1 && (
          <span
            aria-hidden
            className="zt:pointer-events-none zt:absolute zt:top-0 zt:left-0 zt:text-[0.625rem] zt:leading-none zt:text-muted-foreground zt:tabular-nums"
          >
            {occurrenceCount}
          </span>
        )}
      </div>
    </li>
  );
}

function referencePresentation(
  entry: ReferenceEntry,
  {
    numbered,
    serials,
    pending,
  }: { numbered: boolean; serials: boolean; pending: boolean },
): {
  gutter: ReactNode;
  warning: boolean;
  noteLabel: string;
  noteDisabled: boolean;
  source: ReferenceSource | undefined;
} {
  switch (entry.kind) {
    case "rendered":
      return {
        gutter: entry.marker ? (
          <InlineContent nodes={entry.marker} />
        ) : serials ? (
          entry.serial
        ) : undefined,
        warning: false,
        noteLabel: m.references_open_note(),
        noteDisabled: false,
        source: entry.source,
      };
    case "summary":
      return {
        gutter: numbered ? entry.refNumber : undefined,
        warning: false,
        noteLabel: m.references_open_note(),
        noteDisabled: false,
        source: entry.source,
      };
    case "unrendered":
      return {
        gutter: "⚠",
        warning: true,
        noteLabel: m.references_open_note(),
        noteDisabled: false,
        source: entry.source,
      };
    case "unreadable":
      return {
        gutter: "⚠",
        warning: true,
        noteLabel: m.references_db_unavailable(),
        noteDisabled: true,
        source: undefined,
      };
    case "ineligible":
      return {
        gutter: "⚠",
        warning: true,
        noteLabel: m.references_item_ineligible({ key: entry.key }),
        noteDisabled: true,
        source: undefined,
      };
    case "missing":
      return {
        gutter: "⚠",
        warning: true,
        noteLabel: m.references_open_note_missing(),
        noteDisabled: true,
        source: undefined,
      };
    case "unresolved":
      if (pending) {
        return {
          gutter: "…",
          warning: false,
          noteLabel: m.references_open_note_pending(),
          noteDisabled: true,
          source: undefined,
        };
      }
      return {
        gutter: "⚠",
        warning: true,
        noteLabel:
          "annotationKey" in entry
            ? m.references_annotation_unresolved({
                annotationKey: entry.annotationKey,
              })
            : m.references_open_note_unresolved(),
        noteDisabled: true,
        source: undefined,
      };
    case "ambiguous":
      return {
        gutter: "⚠",
        warning: true,
        noteLabel: m.references_open_note_ambiguous(),
        noteDisabled: true,
        source: undefined,
      };
    case "malformed":
      return {
        gutter: "⚠",
        warning: true,
        noteLabel:
          entry.occurrences[0]!.kind === "annotation"
            ? m.references_annotation_link_invalid()
            : m.references_open_note_invalid_fragment(),
        noteDisabled: true,
        source: undefined,
      };
  }
}

function ReferenceBody({
  entry,
  pending,
}: {
  entry: ReferenceEntry;
  pending: boolean;
}) {
  const textClass = "zt:font-content zt:text-sm zt:leading-snug zt:break-words";
  switch (entry.kind) {
    case "rendered":
      return (
        <span className={cn(textClass, "zt:text-foreground")}>
          <InlineContent nodes={entry.content} />
        </span>
      );
    case "summary":
    case "unrendered":
      return (
        <span className={cn(textClass, "zt:text-foreground")}>
          {entry.source.summary}
        </span>
      );
    case "unreadable":
      return <span>{m.references_db_unavailable()}</span>;
    case "ineligible":
      return <span>{m.references_item_ineligible({ key: entry.key })}</span>;
    case "missing":
      return (
        <span className={cn(textClass, "zt:text-destructive")}>
          {m.references_item_missing({
            linkpath: entry.linkpath ?? `@${entry.occurrences[0]!.raw}`,
          })}
        </span>
      );
    case "unresolved":
      if (pending) {
        return (
          <span className={cn(textClass, "zt:text-muted-foreground")}>
            {"annotationKey" in entry
              ? m.references_annotation_pending({
                  annotationKey: entry.annotationKey,
                })
              : m.references_citekey_pending({ citekey: entry.citekey })}
          </span>
        );
      }
      return (
        <span className={cn(textClass, "zt:text-destructive")}>
          {"annotationKey" in entry
            ? m.references_annotation_unresolved({
                annotationKey: entry.annotationKey,
              })
            : m.references_citekey_unresolved({ citekey: entry.citekey })}
        </span>
      );
    case "ambiguous":
      return (
        <div className="zt:flex zt:flex-col zt:gap-1">
          <span className={cn(textClass, "zt:text-destructive")}>
            {m.references_citekey_ambiguous({ citekey: entry.citekey })}
          </span>
          <AmbiguousCandidates
            candidates={entry.candidates}
            textClass={textClass}
          />
        </div>
      );
    case "malformed":
      return (
        <span className={cn(textClass, "zt:text-destructive")}>
          {entry.occurrences[0]!.kind === "annotation"
            ? m.references_annotation_link_invalid()
            : m.references_citation_fragment_invalid()}
        </span>
      );
  }
}

function EntryAction({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: IconName;
  label: string;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  disabled?: boolean;
}) {
  return (
    <IconButton
      icon={icon}
      onClick={onClick}
      disabled={disabled}
      className={compactIconButton}
      {...tooltipAttrs(label)}
    />
  );
}

function EngineSurface({
  status,
  hintDismissed,
}: {
  status: PandocEngineStatus;
  hintDismissed: boolean;
}) {
  const actions = useReferenceActions();

  if (status === null) return null;
  switch (status.kind) {
    case "ready":
      return null;
    case "pack-absent":
      return hintDismissed ? null : (
        <Banner
          title={m.references_engine_hint_title()}
          action={
            <Button variant="cta" onClick={openResourcePackPage}>
              {m.settings_resource_pack_open()}
            </Button>
          }
          onDismiss={actions.onDismissEngineHint}
        >
          {m.references_engine_hint_body()}
        </Banner>
      );
    case "pack-outdated":
    case "plugin-outdated":
    case "pack-damaged":
    case "failed":
      return (
        <Banner
          tone="warning"
          title={m.references_engine_failed_title()}
          action={
            <Button variant="cta" onClick={actions.onOpenEngineSettings}>
              {m.references_engine_open_settings()}
            </Button>
          }
        >
          {packStatusSentence(status)}
        </Banner>
      );
  }
}

function Banner({
  tone = "normal",
  title,
  action,
  onDismiss,
  children,
}: {
  tone?: "normal" | "warning";
  title: string;
  action?: ReactNode;
  onDismiss?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="zt:relative zt:flex zt:shrink-0 zt:flex-col zt:gap-2 zt:bg-muted zt:p-3 zt:ps-6 zt:text-sm zt:leading-snug"
      data-references-banner
    >
      <div>
        <div
          className={cn(
            "zt:font-medium",
            onDismiss && "zt:pe-6",
            tone === "warning" && "zt:text-warning",
          )}
        >
          {title}
        </div>
        {children}
      </div>
      {action && <div className="zt:flex zt:justify-end">{action}</div>}
      {onDismiss && (
        <IconButton
          className={cn("zt:absolute zt:end-2 zt:top-2", compactIconButton)}
          icon="x"
          onClick={onDismiss}
          {...tooltipAttrs(m.references_engine_hint_dismiss())}
        />
      )}
    </div>
  );
}
