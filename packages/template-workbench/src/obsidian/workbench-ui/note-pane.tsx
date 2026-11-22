import type {
  WorkbenchDocumentController,
  WorkbenchSliceRange,
} from "#core/document/index.ts";
import { MapMode, StateEffect } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { useAtomValue } from "@effect/atom-react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { useUniqueId } from "@zotlit/ui";

import {
  PreviewWidget,
  boxAt,
  boxField,
  boxRanges,
  revealSourceOnClick,
} from "./editor-boxes.ts";
import { useWorkbenchHost } from "./host.tsx";
import { editorChip, chipIcon } from "./look.ts";
import { usePartialBoxes } from "./partial-boxes.tsx";
import type { PartialPlaceholderHost } from "./partial-boxes.tsx";
import { SliceEditor } from "./slice-editor.tsx";
import type { SuggestionSource } from "./slice-editor.tsx";

import { documentRevision } from "#core/document/atoms.ts";
import { noteRegions } from "#core/document/index.ts";

const notePaneAnnotationBox = cn(
  editorChip,
  "zt:inline-flex zt:max-w-full zt:items-center zt:gap-1 zt:rounded-md zt:p-0.5 zt:ps-2 zt:align-middle",
);
const notePaneAnnotationToggle = chipIcon;
const notePaneAnnotationEdit = chipIcon;
const notePaneAnnotationPreview =
  "zt:mx-2 zt:my-1 zt:cursor-default zt:rounded-md zt:border zt:border-border zt:bg-background zt:p-2 zt:font-sans zt:text-sm zt:whitespace-normal zt:select-text";
const notePanePending = "zt:text-xs zt:text-muted-foreground";

export interface NotePaneProps {
  controller: WorkbenchDocumentController;
  reveal?: WorkbenchSliceRange | null;
  onSelection?: (selection: WorkbenchSliceRange) => void;
  suggest?: SuggestionSource;
  preview: string | null;
  previewHint?: string | null;
  formatProblem: string | null;
  annotationSelector?: ReactNode;
  onOpenAnnotation: () => void;
  partials?: PartialPlaceholderHost;
}

export function NotePane({
  controller,
  reveal,
  onSelection,
  suggest,
  partials,
  ...example
}: NotePaneProps) {
  useAtomValue(documentRevision(controller));
  const host = useRef<HTMLDivElement>(null);
  const previewId = useUniqueId();
  const [opened, setOpened] = useState<{
    controller: WorkbenchDocumentController;
    line: number;
  } | null>(null);
  const expanded = opened?.controller === controller ? opened.line : null;
  const localLine =
    expanded === null ? null : expanded - controller.sliceRange("note").from;
  const boxes = useMemo(
    () =>
      new Map<number, HTMLElement>(
        controller.noteRegions.annotationCalls.map((_, index) => [
          index,
          document.createElement("span"),
        ]),
      ),
    [controller],
  );
  const previewHost = useMemo(() => document.createElement("div"), []);
  const managedStart = m.workbench_managed_start();
  const managedEnd = m.workbench_managed_end();
  const partialBoxes = usePartialBoxes(controller, "note", partials);
  const noteExtensions = useMemo(
    () =>
      noteBoxes(boxes, previewHost, {
        labels: { start: managedStart, end: managedEnd },
      }),
    [boxes, previewHost, managedStart, managedEnd],
  );
  const extensions = useMemo(
    () => [noteExtensions, partialBoxes.extensions],
    [noteExtensions, partialBoxes.extensions],
  );
  useEffect(
    () =>
      controller.subscribe(({ transaction, docChanged }) => {
        if (!docChanged) return;
        const { doc } = transaction.state;
        const lines = new Set(
          controller.noteRegions.annotationCalls.map(
            ({ call }) => doc.lineAt(call.to).to,
          ),
        );
        setOpened((current) => {
          if (current?.controller !== controller) return current;
          const position = transaction.changes.mapPos(
            current.line,
            -1,
            MapMode.TrackDel,
          );
          const line = position === null ? null : doc.lineAt(position).to;
          return line !== null && lines.has(line) ? { controller, line } : null;
        });
      }),
    [controller],
  );
  useEffect(() => {
    const element = host.current?.querySelector<HTMLElement>(".cm-editor");
    const view = element && EditorView.findFromDOM(element);
    view?.dispatch({ effects: expandPreview.of(localLine) });
  }, [localLine, extensions]);
  useEffect(() => {
    const element = host.current?.querySelector<HTMLElement>(".cm-editor");
    if (element) EditorView.findFromDOM(element)?.requestMeasure();
  }, [example.preview, example.previewHint, example.formatProblem]);
  return (
    <div ref={host} data-part="note-pane">
      <SliceEditor
        controller={controller}
        slice="note"
        label={m.workbench_tab_note()}
        extensions={extensions}
        reveal={reveal}
        suggest={suggest}
        onSelection={onSelection}
      />
      {controller.noteRegions.annotationCalls.map(({ call }, index) => {
        const line = controller.state.doc.lineAt(call.to).to;
        return createPortal(
          <AnnotationPlaceholder
            expanded={expanded === line}
            previewId={previewId}
            onToggle={(pressed) =>
              setOpened(pressed ? { controller, line } : null)
            }
            onOpenAnnotation={example.onOpenAnnotation}
          />,
          boxAt(boxes, index),
          String(index),
        );
      })}
      {expanded !== null &&
        createPortal(
          <AnnotationPreview {...example} id={previewId} />,
          previewHost,
        )}
      {partialBoxes.boxes}
    </div>
  );
}

function AnnotationPlaceholder({
  expanded,
  previewId,
  onToggle,
  onOpenAnnotation,
}: {
  expanded: boolean;
  previewId: string;
  onToggle: (pressed: boolean) => void;
  onOpenAnnotation: () => void;
}) {
  const previewTooltip = tooltipAttrs(m.workbench_annotation_preview());
  const editTooltip = tooltipAttrs(m.workbench_annotation_edit_format());
  return (
    <span
      data-annotation-box
      data-part="annotation-box"
      className={notePaneAnnotationBox}
    >
      <span
        data-part="annotation-label"
        className="zt:min-w-0 zt:whitespace-normal"
      >
        {m.workbench_annotation_slot()}
      </span>
      <span
        data-part="annotation-actions"
        className="zt:inline-flex zt:shrink-0 zt:items-center"
      >
        <button
          type="button"
          data-part="annotation-toggle"
          data-state={expanded ? "active" : "inactive"}
          className={notePaneAnnotationToggle}
          {...previewTooltip}
          aria-pressed={expanded}
          aria-controls={expanded ? previewId : undefined}
          onClick={() => onToggle(!expanded)}
        >
          <Icon name="eye" />
        </button>
        <button
          type="button"
          data-part="annotation-edit"
          className={notePaneAnnotationEdit}
          {...editTooltip}
          onClick={onOpenAnnotation}
        >
          <Icon name="pencil" />
        </button>
      </span>
    </span>
  );
}

function AnnotationPreview({
  id,
  preview,
  previewHint = null,
  formatProblem,
  annotationSelector,
}: Pick<
  NotePaneProps,
  "preview" | "previewHint" | "formatProblem" | "annotationSelector"
> & {
  id: string;
}) {
  const Markdown = useWorkbenchHost().markdown;
  return (
    <div
      id={id}
      data-annotation-preview
      data-part="annotation-preview"
      className={notePaneAnnotationPreview}
    >
      <div data-part="annotation-selector" className="zt:mb-2">
        {annotationSelector}
      </div>
      {formatProblem !== null && (
        <p
          data-part="annotation-problem"
          className="zt:mb-2 zt:border-s-2 zt:border-(--text-error) zt:ps-2 zt:text-xs zt:text-muted-foreground"
        >
          {formatProblem}
        </p>
      )}
      {preview !== null ? (
        <Suspense
          fallback={
            <p data-part="pending" className={notePanePending}>
              {m.workbench_result_pending()}
            </p>
          }
        >
          <Markdown
            surface="annotation"
            markdown={preview}
            properties={[]}
            showMarkdown={false}
          />
        </Suspense>
      ) : (
        formatProblem === null && (
          <p data-part="pending" className={notePanePending}>
            {previewHint ?? m.workbench_result_pending()}
          </p>
        )
      )}
    </div>
  );
}

const expandPreview = StateEffect.define<number | null>();

function noteBoxes(
  boxes: Map<number, HTMLElement>,
  previewHost: HTMLElement,
  { labels }: { labels: { start: string; end: string } },
): Extension {
  function build(
    { doc, selection }: EditorState,
    expanded: number | null,
  ): DecorationSet {
    const body = doc.toString();
    const { annotationCalls, managedBlock } = noteRegions(body, {
      from: 0,
      to: body.length,
    });
    const ranges = boxRanges(
      annotationCalls.map(({ call }) => call),
      boxes,
      selection,
    );
    const selected = ({ from, to }: WorkbenchSliceRange) =>
      selection.ranges.some((range) => range.from <= to && range.to >= from);
    if (managedBlock) {
      const last = doc.lineAt(managedBlock.range.to).number;
      for (
        let line = doc.lineAt(managedBlock.range.from).number;
        line <= last;
        line += 1
      ) {
        ranges.push(
          Decoration.line({
            attributes: {
              "data-part": "managed-line",
              class: "zt-template-workbench-managed",
            },
          }).range(doc.line(line).from),
        );
      }
      for (const [tag, label] of [
        [managedBlock.open, labels.start],
        [managedBlock.close, labels.end],
      ] as const) {
        if (selected(tag)) continue;
        ranges.push(
          Decoration.replace({
            widget: new LabelWidget(label, tag),
          }).range(tag.from, tag.to),
        );
      }
    }
    if (
      expanded !== null &&
      annotationCalls.some(({ call }) => doc.lineAt(call.to).to === expanded)
    ) {
      ranges.push(
        Decoration.widget({
          widget: new PreviewWidget(previewHost),
          block: true,
          side: 1,
        }).range(expanded),
      );
    }
    return Decoration.set(ranges, true);
  }

  return boxField(expandPreview, build);
}

const MANAGED_LABEL = cn(
  editorChip,
  "zt:inline-block zt:cursor-(--cursor-clickable) zt:px-2 zt:py-0.5 zt:select-none",
);

class LabelWidget extends WidgetType {
  readonly label: string;
  readonly range: WorkbenchSliceRange;

  constructor(label: string, range: WorkbenchSliceRange) {
    super();
    this.label = label;
    this.range = range;
  }

  eq(other: LabelWidget): boolean {
    return (
      other.label === this.label &&
      other.range.from === this.range.from &&
      other.range.to === this.range.to
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("span");
    element.dataset.part = "managed-label";
    element.className = MANAGED_LABEL;
    element.textContent = this.label;
    revealSourceOnClick(element, view, this.range);
    return element;
  }
}
