import type { HeldTags } from "#obsidian/annot-view/card-controls.ts";
import type { HeldDraftActions } from "#obsidian/annot-view/editor-sheet.ts";
import type {
  EndTagSession,
  TagEditorProps,
} from "#obsidian/annot-view/tag-editor.tsx";
import type {
  AnnotationRecord,
  TagDraft,
} from "#obsidian/annotation-repository/service.ts";
import type { RefObject } from "react";
import { useMemo } from "react";

import { cn } from "@zotlit/obsidian-kit/utils.ts";

import { tagChipVariants } from "#core/annot-view/tag-chip.ts";
import { shownTagNames } from "#obsidian/annot-view/card-controls.ts";
import {
  autoTags,
  HeldTagsPanel,
  TagEditor,
} from "#obsidian/annot-view/tag-editor.tsx";

export interface TagSectionProps {
  annotation: AnnotationRecord;
  draft: TagDraft | null;
  tagging: boolean;
  readOnly: boolean;
  hint: string | null;
  held: HeldTags | null;
  heldActions: HeldDraftActions;
  libraryNames: () => Promise<readonly string[]>;
  onChange: (names: readonly string[]) => void;
  onClose: () => void;
  within: HTMLElement;
}

export function tagSectionShows({
  annotation,
  draft,
  tagging,
  held,
}: Pick<
  TagSectionProps,
  "annotation" | "draft" | "tagging" | "held"
>): boolean {
  return (
    tagging || held !== null || shownTagNames(annotation, draft).length > 0
  );
}

export interface MarkPopupTagSectionProps extends TagSectionProps {
  sectionRef: RefObject<HTMLDivElement | null>;
  endSession: RefObject<EndTagSession | null>;
  suggestRef: RefObject<HTMLElement | null>;
}

export function MarkPopupTagSection({
  sectionRef,
  ...props
}: MarkPopupTagSectionProps) {
  const panel = props.held !== null && !(props.tagging && !props.readOnly);
  return (
    <div
      ref={sectionRef}
      className={cn(
        !panel && "zt:w-0 zt:min-w-[max(100%,12em)] zt:px-1.5 zt:pb-1.5",
        "zt:not-nth-2:-mt-1",
      )}
      data-zt-section="tags"
    >
      <TagSection {...props} />
    </div>
  );
}

function TagSection({
  annotation,
  draft,
  tagging,
  readOnly,
  hint,
  held,
  heldActions,
  libraryNames,
  onChange,
  onClose,
  within,
  endSession,
  suggestRef,
}: TagSectionProps & Pick<TagEditorProps, "endSession" | "suggestRef">) {
  const auto = useMemo(() => autoTags(annotation), [annotation]);
  if (tagging && !readOnly) {
    return (
      <TagEditor
        names={shownTagNames(annotation, draft)}
        auto={auto}
        hint={hint}
        libraryNames={libraryNames}
        onChange={onChange}
        onClose={onClose}
        endSession={endSession}
        within={within}
        suggestRef={suggestRef}
      />
    );
  }
  if (held) {
    return <HeldTagsPanel held={held} surface="popup" actions={heldActions} />;
  }
  return (
    <div className="zt:flex zt:flex-wrap zt:gap-1">
      {shownTagNames(annotation, draft).map((tag) => (
        <span
          key={tag}
          className={tagChipVariants({
            state: "resting",
            density: "dense",
            truncate: true,
            class: "zt:cursor-default",
          })}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}
