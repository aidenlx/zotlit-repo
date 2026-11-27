import type {
  RenderDiagnostic,
  TemplateRenderResult,
} from "#core/render/result.ts";
import type { ReactNode, Ref } from "react";
import { Suspense } from "react";

import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { WorkbenchMarkdownProps } from "./host.tsx";
import { useContainerName, useWorkbenchHost } from "./host.tsx";
import { previewNotice, templateWorkbenchButton } from "./look.ts";
import { pendingView } from "./pending-view.ts";
import { diagnosticText } from "./problems.ts";

const resultRegionRegion = cn(
  "zt:flex zt:min-w-0 zt:flex-col zt:gap-3",
  "zt:min-w-0 zt:rounded-sm zt:select-text zt:focus-visible:outline-2 zt:focus-visible:outline-ring",
);
const resultColumnLabelText = "zt:text-muted-foreground";
const resultColumnProblemOpen = "zt-workbench-problem-open";
const resultColumnBehind = cn(
  previewNotice,
  "zt:flex-wrap zt:items-center zt:border-(--interactive-accent) zt:text-muted-foreground",
);
const resultColumnBehindText = "zt:min-w-0 zt:flex-1 zt:text-pretty";
const resultColumnRun = cn(templateWorkbenchButton, "zt:ms-auto zt:shrink-0");
const resultColumnFilename = "zt:text-sm";
const resultColumnProblem = cn(
  previewNotice,
  "zt:flex-col zt:border-(--text-error) zt:[overflow-wrap:anywhere]",
);

export function ResultRegion({
  ref,
  emphasis,
  children,
}: {
  ref?: Ref<HTMLDivElement>;
  emphasis?: boolean;
  children: ReactNode;
}) {
  const name = useContainerName(m.workbench_view_result());
  return (
    <div
      role="region"
      tabIndex={0}
      {...name.attrs}
      ref={ref}
      data-emphasis={emphasis || undefined}
      data-part="region"
      className={resultRegionRegion}
    >
      {name.hiddenName}
      {children}
    </div>
  );
}

export type ResultMode = WorkbenchMarkdownProps["surface"];

export interface ResultBodyProps {
  result: TemplateRenderResult | null;
  annotationResult?: TemplateRenderResult | null;
  retained?: TemplateRenderResult | null;
  mode: ResultMode;
  staleReason: "hold" | "invalid" | "demand" | "live" | null;
  showMarkdown: boolean;
  showManaged: boolean;
  showFilename?: boolean;
  sourceAvailable?: boolean;
  onShowProblem?: (diagnostic: RenderDiagnostic | null) => void;
  onRun?: () => void;
  busy?: boolean;
}

type ResultReading = Pick<
  ResultBodyProps,
  | "result"
  | "annotationResult"
  | "retained"
  | "mode"
  | "staleReason"
  | "showManaged"
>;

function readResult({
  result,
  annotationResult,
  retained = null,
  mode,
  staleReason,
  showManaged,
}: ResultReading) {
  const showAnnotation = mode === "annotation";
  const showNote = mode === "note";
  const showCitation = mode === "citation";
  const showPartial = mode === "partial";
  const previewProblem = showAnnotation
    ? (annotationResult?.diagnostics.find(
        ({ part }) => part === "annotation",
      ) ?? annotationResult?.diagnostics[0])
    : result?.diagnostics.find(
        ({ part }) => part !== "annotation" || result.creationBody === null,
      );
  const outputOf = (source: TemplateRenderResult | null | undefined) =>
    (showPartial
      ? source?.partial
      : showCitation
        ? source?.citation
        : showAnnotation
          ? source?.annotation
          : showManaged
            ? source?.managedRegion
            : source?.creationBody) ?? null;
  const output = outputOf(showAnnotation ? annotationResult : result);
  const pendingState = pendingView(
    { staleReason, result, retained },
    (source) => outputOf(source) !== null,
  );
  const failed =
    pendingState.notice === "failed" ||
    (showNote &&
      result?.diagnostics.some(({ code }) => code === "property-error")) ||
    (previewProblem !== undefined && output === null);
  const kept =
    failed && retained !== null && outputOf(retained) !== null
      ? retained
      : null;
  const shown = kept ?? result;
  return {
    previewProblem,
    pendingState,
    failed,
    kept,
    shown,
    annotationShown: kept ?? annotationResult ?? null,
  };
}

export function previewFilename(reading: ResultReading): string | null {
  const { failed, shown } = readResult(reading);
  return reading.mode === "note" && !failed && shown ? shown.filename : null;
}

export function PreviewFilenameLabel({ filename }: { filename: string }) {
  const tooltip = tooltipAttrs(filename);
  return (
    <p
      data-part="filename-text"
      className="zt:text-sm zt:[overflow-wrap:anywhere]"
      {...tooltip}
    >
      <span data-part="label-text" className={resultColumnLabelText}>
        {m.workbench_result_filename()}:{" "}
      </span>
      {filename}
    </p>
  );
}

export function ResultBody({
  result,
  annotationResult,
  retained = null,
  mode,
  staleReason,
  showMarkdown,
  showManaged,
  showFilename = true,
  sourceAvailable = true,
  onShowProblem,
  onRun,
  busy,
}: ResultBodyProps) {
  const { markdown: Markdown, openCitationEngineSettings } = useWorkbenchHost();
  const showAnnotation = mode === "annotation";
  const showNote = mode === "note";
  const showCitation = mode === "citation";
  const showPartial = mode === "partial";
  const { previewProblem, pendingState, failed, kept, shown, annotationShown } =
    readResult({
      result,
      annotationResult,
      retained,
      mode,
      staleReason,
      showManaged,
    });
  const hint = (showAnnotation ? annotationResult : result)?.previewHints?.find(
    ({ part }) => part === (showAnnotation ? "annotation" : showNote && "note"),
  );
  const pending = (
    <p data-part="pending" className="zt:text-sm zt:text-muted-foreground">
      {m.workbench_result_pending()}
    </p>
  );
  const showProblem = (diagnostic: RenderDiagnostic | null) =>
    onShowProblem && (
      <button
        type="button"
        disabled={!sourceAvailable}
        onClick={() => onShowProblem(diagnostic)}
        data-part="problem-open"
        className={resultColumnProblemOpen}
      >
        {m.workbench_problem_show()}
      </button>
    );
  const showPending = pendingState.notice === "rendering";
  return (
    <>
      {pendingState.notice === "held" && (
        <p
          role="status"
          data-part="stale"
          className="zt:text-sm zt:text-muted-foreground"
        >
          {m.workbench_preview_stale()}
        </p>
      )}
      {pendingState.notice === "behind" && (
        <div role="status" data-part="behind" className={resultColumnBehind}>
          <span data-part="behind-text" className={resultColumnBehindText}>
            {result ? m.workbench_preview_behind() : m.workbench_preview_none()}
          </span>
          {onRun && (
            <button
              type="button"
              disabled={busy}
              onClick={onRun}
              data-part="run"
              className={resultColumnRun}
            >
              {m.workbench_preview_run()}
            </button>
          )}
        </div>
      )}
      <ResultRegion emphasis={false}>
        {shown || failed ? (
          <>
            {showFilename && showNote && !failed && shown?.filename != null && (
              <header data-part="filename" className={resultColumnFilename}>
                <PreviewFilenameLabel filename={shown.filename} />
              </header>
            )}
            {(previewProblem || failed) && (
              <div
                role="status"
                data-part="problem"
                className={resultColumnProblem}
              >
                {previewProblem && (
                  <p
                    data-part="problem-text"
                    className="zt:min-w-0 zt:text-pretty"
                  >
                    <strong
                      data-part="problem-heading"
                      className="zt:font-semibold zt:text-(--text-error)"
                    >
                      {m.workbench_preview_problem()}
                    </strong>{" "}
                    {diagnosticText(previewProblem)}{" "}
                    {showProblem(previewProblem)}
                  </p>
                )}
                {failed && (
                  <p
                    data-part="problem-output"
                    data-state={kept === null ? "unavailable" : "retained"}
                    className="zt:min-w-0 zt:text-pretty zt:font-medium zt:text-foreground"
                  >
                    {kept === null
                      ? m.workbench_preview_unavailable()
                      : m.workbench_preview_retained()}{" "}
                    {previewProblem ? null : showProblem(null)}
                  </p>
                )}
              </div>
            )}
            {hint && !failed && (
              <div
                role="status"
                data-part="behind"
                className={resultColumnBehind}
              >
                <span
                  data-part="behind-text"
                  className={resultColumnBehindText}
                >
                  {hint.message}
                </span>
                {hint.opensEngineSettings && openCitationEngineSettings && (
                  <button
                    type="button"
                    onClick={() => openCitationEngineSettings()}
                    data-part="run"
                    className={resultColumnRun}
                  >
                    {m.workbench_preview_open_settings()}
                  </button>
                )}
              </div>
            )}
            <Suspense fallback={pending}>
              {(failed && kept === null) ||
              shown === null ? null : showCitation || showPartial ? (
                <Markdown
                  surface={showPartial ? "partial" : "citation"}
                  markdown={
                    (showPartial ? shown.partial : shown.citation) ?? ""
                  }
                  properties={[]}
                  showMarkdown={showMarkdown}
                />
              ) : showAnnotation ? (
                annotationShown ? (
                  <Markdown
                    surface="annotation"
                    markdown={annotationShown.annotation ?? ""}
                    properties={[]}
                    showMarkdown={showMarkdown}
                  />
                ) : (
                  pending
                )
              ) : showNote && showManaged ? (
                shown.managedRegion === null ? (
                  <p
                    data-part="empty"
                    className="zt:text-sm zt:text-muted-foreground"
                  >
                    {m.workbench_result_managed_none()}
                  </p>
                ) : (
                  <Markdown
                    surface="note"
                    markdown={shown.managedRegion}
                    properties={[]}
                    showMarkdown={showMarkdown}
                  />
                )
              ) : (
                <Markdown
                  surface="note"
                  markdown={shown.creationBody ?? ""}
                  properties={shown.fold}
                  frontmatterBlock={shown.frontmatterBlock}
                  showMarkdown={showMarkdown}
                  marks={shown.annotationRanges}
                />
              )}
            </Suspense>
          </>
        ) : showPending ? (
          pending
        ) : null}
      </ResultRegion>
    </>
  );
}
