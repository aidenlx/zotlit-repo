import type {
  WorkbenchDocumentController,
  WorkbenchSliceRange,
} from "#core/document/index.ts";
// Annotation format editing, example selection, and access to the source section.
import type { AnnotationExample } from "#core/render/index.ts";
import { useAtomSet, useAtomValue } from "@effect/atom-react";

import { isPageNumber } from "@zotlit/db";
import { useObsidianApp } from "@zotlit/obsidian-kit/app-context.ts";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { selectionControl } from "@zotlit/obsidian-kit/components/obsidian/selection-control.ts";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { useUniqueId } from "@zotlit/ui";

import { useWorkbenchModel } from "./editor.tsx";
import { bar, templateWorkbenchButton } from "./look.ts";
import { usePartialBoxes } from "./partial-boxes.tsx";
import type { PartialPlaceholderHost } from "./partial-boxes.tsx";
import { SampleSuggester } from "./sample-suggester.tsx";
import type { SampleOption } from "./sample-suggester.tsx";
import { SliceEditor } from "./slice-editor.tsx";
import type { SliceEditorProps } from "./slice-editor.tsx";
import { chooseWorkbenchOption } from "./suggester.ts";

import { documentRevision } from "#core/document/atoms.ts";
import { SAMPLE_ANNOTATIONS } from "#core/render/index.ts";

const sampleSuggesterTrigger = selectionControl({ kind: "icon" });
const annotationSectionBar = cn(bar, "zt:mb-2");
const annotationPrimaryAction = cn(templateWorkbenchButton, "zt:ms-auto");
const annotationSectionGo = cn(templateWorkbenchButton, "zt:ms-auto");

export function AnnotationSampleBar({
  id,
  current,
  example,
  onSelect,
  hideLabel = false,
  compact = false,
}: {
  id?: string;
  current: readonly Pick<AnnotationExample, "id" | "root">[];
  example: Pick<AnnotationExample, "id" | "root"> | null;
  onSelect: (id: string) => void;
  /** Native headers already identify the selected annotation. */
  hideLabel?: boolean;
  compact?: boolean;
}) {
  const app = useObsidianApp();
  const command = useWorkbenchModel().choose(useUniqueId());
  const open = useAtomValue(command).waiting;
  const choose = useAtomSet(command);
  const title = example
    ? m.workbench_change_annotation()
    : m.workbench_choose_annotation();
  const groups = [
    {
      heading: m.workbench_annotation_from_item(),
      options: current.map((example) => annotationOption(example)),
      empty: m.workbench_annotation_empty(),
    },
    {
      heading: m.workbench_sample_examples(),
      options: SAMPLE_ANNOTATIONS.map((example) => annotationOption(example)),
    },
  ];
  return (
    <div
      data-part="sample-bar"
      data-state={compact || hideLabel ? "compact" : "labelled"}
      className="zt:flex zt:items-center zt:gap-2"
    >
      {hideLabel || compact ? (
        <button
          id={id}
          type="button"
          data-part="trigger"
          className={sampleSuggesterTrigger}
          {...tooltipAttrs(title)}
          aria-label={title}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={(event) => {
            choose({
              choose: chooseWorkbenchOption(app, {
                anchor: event.currentTarget,
                title,
                selected: example?.id ?? "",
                groups: groups.map((group) => ({
                  label: group.heading,
                  empty: group.empty,
                  options: group.options.map((option) => ({
                    id: option.value,
                    label: option.label,
                    hint: option.description,
                  })),
                })),
              }),
              chosen: onSelect,
            });
          }}
        >
          <Icon name="search" />
        </button>
      ) : (
        <SampleSuggester
          id={id}
          title={m.workbench_choose_annotation()}
          label={
            example
              ? annotationOption(example).label
              : m.workbench_choose_annotation()
          }
          selected={example?.id ?? ""}
          groups={groups}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

export function annotationOption({
  id,
  root,
}: Pick<AnnotationExample, "id" | "root">): SampleOption {
  const type = m.workbench_annotation_type({
    type: typeof root.type === "string" ? root.type : "unknown",
  });
  const content = root.text || root.comment;
  const parent = root.parentItem as Record<string, unknown> | null;
  const tags = (root.tags ?? []) as readonly { name: string }[];
  return {
    value: id,
    label:
      typeof content === "string" && content.length > 0
        ? `${type}: ${content}`
        : type,
    description: [
      parent?.title,
      typeof root.pageLabel !== "string"
        ? null
        : isPageNumber(root.pageLabel)
          ? m.workbench_annotation_page({ page: root.pageLabel })
          : root.pageLabel,
      root.text ? root.comment : null,
      ...tags.map(({ name }) => `#${name}`),
    ]
      .filter((value) => typeof value === "string" && value.length > 0)
      .join(m.workbench_selection_separator()),
  };
}

export function AnnotationPane({
  controller,
  problem,
  partials,
  ...editor
}: Pick<
  SliceEditorProps,
  "controller" | "reveal" | "suggest" | "onSelection"
> & {
  problem: string | null;
  /** The Shared Partials this section's calls name, previewed as an annotation. */
  partials?: PartialPlaceholderHost;
}) {
  const problemId = useUniqueId();
  useAtomValue(documentRevision(controller));
  const boxes = usePartialBoxes(controller, "annotation", partials);
  if (
    !controller.annotationSection ||
    controller.problems.some(
      ({ code }) => code === "missing-annotation-section",
    )
  ) {
    return <AnnotationSectionBar controller={controller} onGo={() => {}} />;
  }
  return (
    <>
      {problem && (
        <p
          id={problemId}
          role="status"
          data-part="problem"
          className="zt:mb-2 zt:text-xs zt:text-(--text-error)"
        >
          {problem}
        </p>
      )}
      <div data-part="pane" className="zt:flex zt:min-w-0 zt:flex-col zt:gap-3">
        <SliceEditor
          {...editor}
          controller={controller}
          slice="annotation"
          label={m.workbench_annotation_label()}
          extensions={boxes.extensions}
          invalid={problem !== null}
          describedBy={problem ? problemId : undefined}
        />
        {boxes.boxes}
      </div>
    </>
  );
}

/**
 * Advanced's own bar over the whole file: the section it holds, or the repair
 * action for the document that has none.
 */
export function AnnotationSectionBar({
  controller,
  onGo,
}: {
  controller: WorkbenchDocumentController;
  onGo: (header: WorkbenchSliceRange) => void;
}) {
  useAtomValue(documentRevision(controller));
  const section = controller.annotationSection;
  // A document mid-repair can hold the section ranges it had, so the refusal
  // the parser raises decides which of the two actions the bar offers.
  const missing = controller.problems.some(
    ({ code }) => code === "missing-annotation-section",
  );
  return (
    <div data-part="section-bar" className={annotationSectionBar}>
      <span data-part="heading" className="zt:font-semibold">
        {m.workbench_section_heading()}
      </span>
      {missing ? (
        <>
          <span data-part="hint" className="zt:text-muted-foreground">
            {m.workbench_section_missing()}
          </span>
          <button
            type="button"
            data-part="primary-action"
            className={annotationPrimaryAction}
            disabled={controller.readOnly}
            onClick={() => controller.repairAnnotationSection()}
          >
            {m.workbench_section_repair()}
          </button>
        </>
      ) : (
        section && (
          <button
            type="button"
            data-part="section-go"
            className={annotationSectionGo}
            onClick={() => onGo({ ...section.header })}
          >
            {m.workbench_section_go()}
          </button>
        )
      )}
    </div>
  );
}
