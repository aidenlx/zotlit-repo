// The shared result controls and render selection, with Markdown supplied by the host.

import type {
  RenderDiagnostic,
  TemplateRenderResult,
} from "#core/render/result.ts";
import { Suspense } from "react";
import type { ReactNode, Ref } from "react";

import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { useContainerName, useWorkbenchHost } from "./host.tsx";
import type { WorkbenchMarkdownProps } from "./host.tsx";
import { previewNotice, templateWorkbenchButton } from "./look.ts";
import { pendingView } from "./pending-view.ts";
import { diagnosticText } from "./problems.ts";
import { WorkbenchSelect, WorkbenchOption } from "./select.tsx";

const resultHeaderControls = cn(
  "zt:flex zt:items-center zt:gap-2",
  "zt:flex-wrap zt:text-sm",
);
const resultHeaderLabel = cn(
  "zt:flex zt:items-center zt:gap-2",
  "zt:flex-wrap",
);
const resultRegionRegion = cn(
  "zt:flex zt:min-w-0 zt:flex-col zt:gap-3",
  "zt:min-w-0 zt:rounded-sm zt:select-text zt:focus-visible:outline-2 zt:focus-visible:outline-ring",
);
const resultColumnLabelText = "zt:text-muted-foreground";
// Show problem reads inside the sentence that reports the failure, so
// it wears link text rather than the native button box; the box, font
// and hover Obsidian styles unlayered are taken back in `theme.css`.
const resultColumnProblemOpen = "zt-workbench-problem-open";
const resultColumnBehind = cn(
  previewNotice,
  "zt:flex-wrap zt:items-center zt:border-(--interactive-accent) zt:text-muted-foreground",
);
const resultColumnBehindText = "zt:min-w-0 zt:flex-1 zt:text-pretty";
const resultColumnRun = cn(templateWorkbenchButton, "zt:ms-auto zt:shrink-0");
// The Preview Panel draws the label in its own sticky header row,
// outside the `filename` box, so the label carries its own size.
const resultColumnFilename = "zt:text-sm";
// A failure wears the same notice as the behind state, and states its
// severity in the bar and the heading: the sentence itself stays in
// reading color, and the line about the output on screen steps back.
const resultColumnProblem = cn(
  previewNotice,
  "zt:flex-col zt:border-(--text-error) zt:[overflow-wrap:anywhere]",
);
const resultColumnLabel = cn(
  "zt:flex zt:items-center zt:gap-2",
  "zt:flex-wrap",
);

/** The result pane's heading beside the reading-or-Markdown choice. */
export function ResultHeader({
  heading,
  showMarkdown,
  onShowMarkdown,
  controls,
  help,
}: {
  heading: string;
  showMarkdown: boolean;
  onShowMarkdown?: (showMarkdown: boolean) => void;
  controls?: ReactNode;
  help?: ReactNode;
}) {
  return (
    <div data-part="header" className="zt:flex zt:min-w-0 zt:flex-col zt:gap-2">
      <h2 data-part="heading" className="zt-workbench-preview-heading">
        {heading}
      </h2>
      <div data-part="controls" className={resultHeaderControls}>
        {controls}
        <label data-part="label" className={resultHeaderLabel}>
          <span data-part="label-text" className="zt:text-muted-foreground">
            {m.workbench_preview_format()}
          </span>
          <WorkbenchSelect
            value={showMarkdown ? "markdown" : "reading"}
            disabled={onShowMarkdown === undefined}
            onInput={(event) =>
              onShowMarkdown?.(event.currentTarget.value === "markdown")
            }
          >
            <WorkbenchOption value="reading">
              {m.workbench_preview_reading()}
            </WorkbenchOption>
            <WorkbenchOption value="markdown">
              {m.workbench_result_markdown_toggle()}
            </WorkbenchOption>
          </WorkbenchSelect>
        </label>
        {help}
      </div>
    </div>
  );
}

/** The box the rendered note is read in. */
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

/** Which of the four outputs a preview shows, which picks its heading and body. */
export type ResultMode = WorkbenchMarkdownProps["surface"];

export interface ResultBodyProps {
  result: TemplateRenderResult | null;
  annotationResult?: TemplateRenderResult | null;
  /**
   * The last successful output kept for this document and preview selection,
   * which a failed attempt is read against. Null where no matching success
   * stands, which is what an unavailable preview says.
   */
  retained?: TemplateRenderResult | null;
  mode: ResultMode;
  /** Why `result` is stale, or why none exists yet; `null` while it is current. */
  staleReason: "hold" | "invalid" | "demand" | "live" | null;
  showMarkdown: boolean;
  showManaged: boolean;
  /**
   * Whether the region opens on the note's file name. A host that names the
   * file in a header of its own, from `previewFilename`, leaves it out.
   */
  showFilename?: boolean;
  sourceAvailable?: boolean;
  /**
   * Reads the failure behind this preview in the editor's Problems area. A
   * preview with no editor to reach leaves it out, and Show problem is absent.
   * A document the parser refuses reached no render and names no diagnostic,
   * so the reading opens on whatever the editor's own checks found.
   */
  onShowProblem?: (diagnostic: RenderDiagnostic | null) => void;
  /** Runs a render now; on demand, this is how the stale-behind notice offers Run. */
  onRun?: () => void;
  busy?: boolean;
}

/** What a preview reads its body from. */
type ResultReading = Pick<
  ResultBodyProps,
  | "result"
  | "annotationResult"
  | "retained"
  | "mode"
  | "staleReason"
  | "showManaged"
>;

/**
 * What a preview paints: the failure it reports, the output that stands, and
 * the result the region reads, which is retained output wherever a failure
 * kept some.
 */
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
  // What this mode shows. A render that failed produced nothing at all, which
  // is not the same as a template that produced an empty result, so the
  // failure reads as a failure rather than as empty content.
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
  // What stands while a render is pending, under the examples' own rule.
  const pendingState = pendingView(
    { staleReason, result, retained },
    (source) => outputOf(source) !== null,
  );
  // A document the parser refuses never reached a render, and its explanation
  // is the editor's; the result on screen is as far behind as a failed one.
  const failed =
    pendingState.notice === "failed" ||
    (showNote &&
      result?.diagnostics.some(({ code }) => code === "property-error")) ||
    (previewProblem !== undefined && output === null);
  // A failure leaves the last successful output standing, so the reader
  // repairs the source against working output rather than an empty pane.
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

/**
 * The file name a note preview names for its result, or null where it names
 * none: another mode, a failure, or no result yet.
 */
export function previewFilename(reading: ResultReading): string | null {
  const { failed, shown } = readResult(reading);
  return reading.mode === "note" && !failed && shown ? shown.filename : null;
}

/**
 * "File name: <name>", with the whole name as its tooltip where a host cuts
 * it short. The region opens on it, and a host that keeps the name in a
 * header of its own draws it there.
 */
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

/** The stale notice and rendered result, without the heading `ResultColumn` adds. */
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
  /** Show problem, which every failure this preview reports offers. */
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
  // "Rendering…" is honest only while a render is on its way: on demand the
  // notice below says Run starts one, and a hold shows its own problem.
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
          // The notice and the note's name are this pane's own words, so they
          // stand while the host's Markdown renderer is still on its way: what
          // waits is the output, and a reader is never left reading
          // "Rendering…" in place of the failure it replaced.
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
                    {/* A document the parser refuses produced no diagnostic to
                        name, and the reading it leads to is the editor's own
                        check — the same one control, on the sentence that
                        reports the failure. */}
                    {previewProblem ? null : showProblem(null)}
                  </p>
                )}
              </div>
            )}
            {hint && !failed && (
              // A suggestion about output that stands, so it wears the behind
              // notice rather than a problem's.
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
                  // The sheet is the note, so its list is the fold every
                  // entry merged into, not each entry's own contribution.
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

export interface ResultColumnProps extends ResultBodyProps {
  showMarkdown: boolean;
  onShowMarkdown: (show: boolean) => void;
  showManaged: boolean;
  onShowManaged: (show: boolean) => void;
  help?: ReactNode;
}

export function ResultColumn({
  result,
  annotationResult,
  retained,
  mode,
  staleReason,
  showMarkdown,
  onShowMarkdown,
  showManaged,
  onShowManaged,
  sourceAvailable = true,
  onShowProblem,
  onRun,
  busy,
  help,
}: ResultColumnProps) {
  const selectorTooltip = tooltipAttrs(
    showManaged
      ? m.workbench_result_managed_toggle()
      : m.workbench_preview_whole(),
  );
  const showNote = mode === "note";
  const showAnnotation = mode === "annotation";
  return (
    <>
      <ResultHeader
        heading={
          showAnnotation
            ? m.workbench_annotation_example()
            : m.workbench_result_heading()
        }
        showMarkdown={showMarkdown}
        onShowMarkdown={onShowMarkdown}
        controls={
          showNote && (
            <label data-part="label" className={resultColumnLabel}>
              <span data-part="label-text" className={resultColumnLabelText}>
                {m.workbench_preview_show()}
              </span>
              <WorkbenchSelect
                value={showManaged ? "managed" : "whole"}
                onInput={(event) =>
                  onShowManaged(event.currentTarget.value === "managed")
                }
                {...selectorTooltip}
              >
                <WorkbenchOption value="whole">
                  {m.workbench_preview_whole()}
                </WorkbenchOption>
                <WorkbenchOption value="managed">
                  {m.workbench_result_managed_toggle()}
                </WorkbenchOption>
              </WorkbenchSelect>
            </label>
          )
        }
        help={help}
      />
      <ResultBody
        result={result}
        annotationResult={annotationResult}
        retained={retained}
        mode={mode}
        staleReason={staleReason}
        showMarkdown={showMarkdown}
        showManaged={showManaged}
        sourceAvailable={sourceAvailable}
        onShowProblem={onShowProblem}
        onRun={onRun}
        busy={busy}
      />
    </>
  );
}
