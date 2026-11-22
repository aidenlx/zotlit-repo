import "./preview-panel.css";
import type { WorkbenchDocumentKind } from "#core/document/index.ts";
import type { PartialContext, RenderDiagnostic } from "#core/render/index.ts";
import type {
  ResultMode,
  TemplateRoot,
} from "#obsidian/workbench-ui/index.tsx";
import { useAtomValue } from "@effect/atom-react";
import type { ComponentProps } from "react";

import { IconButton } from "@zotlit/obsidian-kit/components/obsidian/icon-button.tsx";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { TemplateWorkbenchView } from "./view.tsx";

import {
  DEFAULT_PARTIAL_CONTEXT,
  isPartialContext,
} from "#core/render/index.ts";
import { PreviewMarkdown } from "#desktop/view/preview/markdown.tsx";
import {
  citationVariantLabel,
  partialContextLabel,
  PreviewFilenameLabel,
  previewFilename,
  ResultBody,
  setPreview,
} from "#obsidian/workbench-ui/index.tsx";
import {
  paneCover,
  selectionHint,
  templateWorkbenchButton,
} from "#obsidian/workbench-ui/look.ts";

export function previewTarget(
  kind: WorkbenchDocumentKind,
  root: TemplateRoot,
): {
  readonly mode: ResultMode;
  readonly caller: PartialContext;
  readonly citationSet: boolean;
  readonly annotationMode: boolean;
} {
  const mode: ResultMode =
    kind === "citation"
      ? "citation"
      : kind === "partial"
        ? "partial"
        : root === "annotation"
          ? "annotation"
          : "note";
  const caller = isPartialContext(root) ? root : DEFAULT_PARTIAL_CONTEXT;
  return {
    mode,
    caller,
    citationSet:
      mode === "citation" || (mode === "partial" && caller === "citation"),
    annotationMode:
      mode === "annotation" || (mode === "partial" && caller === "annotation"),
  };
}

export function WorkbenchMarkdown({
  view,
  ...props
}: Omit<ComponentProps<typeof PreviewMarkdown>, "app" | "result"> & {
  view: TemplateWorkbenchView;
}) {
  const { result, retained } = useAtomValue(view.workbench.scheduler.state);
  const tab = useAtomValue(view.workbench.tab);
  const advanced = useAtomValue(view.workbench.advanced);
  const { markdown, surface = "note" } = props;
  const kept =
    retained === null
      ? null
      : surface === "partial"
        ? retained.partial
        : surface === "citation"
          ? retained.citation
          : surface === "annotation"
            ? retained.annotation
            : retained.creationBody === markdown ||
                retained.managedRegion === markdown
              ? markdown
              : null;
  return (
    <PreviewMarkdown
      {...props}
      app={view.app}
      result={kept === markdown ? retained : result}
      expandProperties={!advanced && tab === "properties"}
    />
  );
}

function PreviewActions({
  view,
  showMarkdown,
}: {
  view: TemplateWorkbenchView;
  showMarkdown: boolean;
}) {
  const toggle = showMarkdown
    ? m.workbench_show_reading_view()
    : m.workbench_show_markdown();
  return (
    <div className="zt:flex zt:shrink-0 zt:items-center">
      <IconButton
        icon={showMarkdown ? "book-open" : "code"}
        onClick={() =>
          view.registry.update(
            view.workbench.choices,
            setPreview({ showMarkdown: !showMarkdown }),
          )
        }
        {...tooltipAttrs(toggle)}
      />
      <IconButton
        icon="more-horizontal"
        aria-haspopup="menu"
        onClick={(event) => view.showPreviewMenu(event.currentTarget)}
        {...tooltipAttrs(m.workbench_pane_more_options())}
      />
    </div>
  );
}

export function PreviewPanel({
  view,
  showProblem,
}: {
  view: TemplateWorkbenchView;
  showProblem: (diagnostic: RenderDiagnostic | null) => void;
}) {
  const { workbench, model } = view;
  const { result, retained, busy, staleReason } = useAtomValue(
    workbench.scheduler.state,
  );
  const kind = useAtomValue(workbench.document.kind);
  const root = useAtomValue(workbench.root);
  const { status, error } = useAtomValue(model.read);
  const { example } = useAtomValue(workbench.examples);
  const { variant, citationExample, preview } = useAtomValue(workbench.choices);
  const {
    mode,
    caller: partialContext,
    citationSet,
    annotationMode,
  } = previewTarget(kind, root);
  const ready =
    status === "ready" ||
    (annotationMode && example !== null) ||
    (citationSet && citationExample !== null);
  const heading =
    mode === "partial"
      ? m.workbench_partial_result_heading()
      : mode === "citation"
        ? m.workbench_citation_result_heading()
        : mode === "annotation"
          ? m.workbench_annotation_example()
          : m.workbench_result_heading();
  const caption = [
    ...(mode === "partial" ? [partialContextLabel(partialContext)] : []),
    ...(citationSet ? [citationVariantLabel(variant)] : []),
    ...(mode === "note"
      ? [
          preview.showManaged
            ? m.workbench_result_managed_toggle()
            : preview.mode === "update"
              ? m.workbench_preview_existing_note()
              : m.workbench_preview_new_note(),
        ]
      : []),
    ...(!preview.live ? [m.workbench_preview_on_demand()] : []),
  ].join(m.workbench_selection_separator());
  const reading = {
    result,
    annotationResult: result,
    retained,
    mode,
    staleReason,
    showManaged: preview.showManaged,
  };
  const filename = previewFilename(reading);
  return (
    <div
      data-workbench-scroll="preview"
      data-zotlit-preview-result={result?.sourceRevision}
      className="zt:flex zt:min-h-0 zt:min-w-0 zt:flex-1 zt:scroll-pt-20 zt:flex-col zt:gap-3 zt:overflow-auto zt:p-3"
    >
      {status === "empty" && !ready && (
        <p className={selectionHint}>
          {annotationMode
            ? m.workbench_preview_choose_annotation()
            : m.workbench_preview_choose_item()}
        </p>
      )}
      {status === "loading" && (
        <p role="status" className={selectionHint}>
          {m.workbench_loading_item()}
        </p>
      )}
      {status === "error" && (
        <div
          role="alert"
          className="zt:flex zt:min-w-0 zt:flex-col zt:items-start zt:gap-1.5"
        >
          <p className={selectionHint}>
            {error ?? m.workbench_example_missing_item()}
          </p>
          <div className="zt:flex zt:min-w-0 zt:flex-wrap zt:items-center zt:gap-2">
            <button
              className={templateWorkbenchButton}
              onClick={() => view.refresh()}
            >
              {m.workbench_example_retry()}
            </button>
            <button
              className={templateWorkbenchButton}
              onClick={() => view.startItemChoice()}
            >
              {m.template_data_explorer_choose_item()}
            </button>
          </div>
        </div>
      )}
      {ready && (
        <>
          <header
            data-workbench-preview-header=""
            className={cn(
              "zt:sticky zt:-top-3 zt:z-10 zt:-mx-3 zt:-mt-3 zt:flex zt:min-w-0 zt:flex-col zt:gap-1 zt:border-b zt:border-border zt:px-3 zt:pt-3 zt:pb-2",
              paneCover,
            )}
          >
            <div className="zt:flex zt:min-w-0 zt:items-center zt:gap-2">
              <h2 className="zt-workbench-preview-heading zt:min-w-0 zt:flex-1">
                {heading}
              </h2>
              <PreviewActions view={view} showMarkdown={preview.showMarkdown} />
            </div>
            {caption && <p className={selectionHint}>{caption}</p>}
            {filename !== null && <PreviewFilenameLabel filename={filename} />}
          </header>
          <ResultBody
            {...reading}
            showMarkdown={preview.showMarkdown}
            showFilename={false}
            onShowProblem={showProblem}
            onRun={() => view.registry.set(workbench.scheduler.run, undefined)}
            busy={busy}
          />
        </>
      )}
    </div>
  );
}
