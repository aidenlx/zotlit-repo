import type { RenderDiagnostic } from "#core/render/result.ts";
import { useAtomSet } from "@effect/atom-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  RenderReport,
  WorkbenchReportContext,
} from "@zotlit/notes/core/template/render-report.ts";
import { formatRenderReport } from "@zotlit/notes/core/template/render-report.ts";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { selectionControl } from "@zotlit/obsidian-kit/components/obsidian/selection-control.ts";
import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import { cn } from "@zotlit/obsidian-kit/utils.ts";
import { paneDivider } from "@zotlit/plugin-kernel/pane-divider.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { useUniqueId } from "@zotlit/ui";

import { useWorkbenchModel } from "./editor.tsx";
import { useWorkbenchHost } from "./host.tsx";
import { templateWorkbenchButton } from "./look.ts";
import type { WorkbenchDiagnosis } from "./problems.ts";
import {
  diagnosisEngineSources,
  diagnosisExplanation,
  diagnosisForOccurrence,
  diagnosisLabel,
  diagnosisLocated,
  diagnosisReport,
  diagnosisWhere,
  problemText,
} from "./problems.ts";
import type { RenderTrigger } from "./scheduler-atoms.ts";
import { WorkbenchOption, WorkbenchSelect } from "./select.tsx";

import { captureProblemReport } from "#core/render/problem-report.ts";

const problemsFooterProblemsReport =
  "zt:mt-1 zt:max-h-56 zt:overflow-auto zt:rounded-md zt:border zt:border-border zt:bg-(--background-secondary) zt:p-2 zt:font-mono zt:whitespace-pre zt:select-text";
const problemsFooterProblemsCopy = templateWorkbenchButton;
const problemsFooterProblemsCommunity =
  "zt:self-center zt:underline zt:underline-offset-2";
const problemsFooterProblems =
  "zt:relative zt:flex zt:min-h-0 zt:flex-col zt:gap-2 zt:border-t zt:border-border zt:data-[state=open]:border-t-0 zt:p-3 zt:text-xs zt:leading-normal zt:data-[error]:border-s-2 zt:data-[error]:border-s-(--text-error)";
const problemsFooterProblemsResize = cn(
  paneDivider({ flow: "overlay", edge: "top" }),
  "zt:in-data-[error]:-start-0.5",
);
const problemsFooterProblemsText =
  "zt:min-w-0 zt:text-pretty zt:font-medium zt:text-foreground";
const problemsFooterProblemsCount =
  "zt:shrink-0 zt:rounded-sm zt:bg-(--background-modifier-error)/10 zt:text-foreground zt:px-1.5 zt:font-medium zt:tabular-nums zt:whitespace-nowrap";
const problemsFooterProblemsAnnouncement = "zt:sr-only";
const problemsFooterProblemsSpace =
  "zt:ms-auto zt:flex zt:min-w-0 zt:flex-wrap zt:items-center zt:gap-2 zt:[&>*]:max-w-full zt:[&>*]:min-w-0";
const problemsFooterProblemsToggle = selectionControl({ kind: "icon" });
const problemsFooterProblemsBody =
  "zt:flex zt:min-h-0 zt:min-w-0 zt:flex-1 zt:flex-col zt:gap-1";
const problemsFooterProblemsScroll = cn(
  "zt:flex zt:min-h-0 zt:flex-1 zt:flex-col zt:gap-1 zt:overflow-y-auto zt:overscroll-contain zt:pb-1",
  "zt:focus-visible:shadow-[inset_0_0_0_2px_var(--background-modifier-border-focus)]",
);
const problemsFooterProblemsSelect = "zt:min-w-0 zt:max-w-full zt:self-start";
const problemsFooterProblemsObject =
  "zt:font-semibold zt:[overflow-wrap:anywhere]";
const problemsFooterProblemsLocation =
  "zt:text-pretty zt:text-muted-foreground zt:[overflow-wrap:anywhere]";
const problemsFooterProblemsControls =
  "zt:flex zt:min-w-0 zt:shrink-0 zt:flex-wrap zt:border-t zt:border-border zt:pt-2 zt:items-center zt:gap-2 zt:[&>*]:max-w-full zt:[&>*]:min-w-0";
const problemsFooterProblemsOpen = templateWorkbenchButton;
const problemsFooterProblemsNext = templateWorkbenchButton;

export interface WorkbenchProblemsState {
  readonly diagnoses: readonly WorkbenchDiagnosis[];
  readonly selected: WorkbenchDiagnosis | null;
  readonly inspected: WorkbenchDiagnosis | null;
  readonly open: boolean;
  readonly report: RenderReport | null;
  readonly resolved: boolean;
  readonly next: WorkbenchDiagnosis | null;
  readonly select: (id: string, occurrence?: RenderDiagnostic) => void;
  readonly setOpen: (open: boolean) => void;
  readonly announcement: string;
  readonly announce: (text: string) => void;
}

export interface WorkbenchProblemCapture {
  readonly source: string;
  readonly context: () => WorkbenchReportContext;
}

export function useWorkbenchProblems({
  diagnoses: found,
  trigger,
  attempt,
  capture,
}: {
  readonly diagnoses: readonly WorkbenchDiagnosis[];
  readonly trigger: RenderTrigger | null;
  readonly attempt: number;
  readonly capture?: WorkbenchProblemCapture;
}): WorkbenchProblemsState {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [occurrence, setOccurrence] = useState<RenderDiagnostic | null>(null);
  const [open, setOpen] = useState(false);
  const [announcement, announce] = useState("");
  const diagnoses =
    occurrence === null
      ? found
      : found.map((diagnosis) => diagnosisForOccurrence(diagnosis, occurrence));
  const openArea = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      announce("");
      setSelectedId(null);
      setOccurrence(null);
    }
  }, []);
  const first = diagnoses[0] ?? null;
  const selected =
    selectedId === null
      ? first
      : (diagnoses.find(({ id }) => id === selectedId) ?? null);
  useEffect(() => {
    if (first === null) setSelectedId(null);
    else if (open) setSelectedId((kept) => kept ?? first.id);
  }, [first, open]);
  const opened = useRef(attempt);
  const failed = diagnoses.length > 0;
  useEffect(() => {
    if (attempt === opened.current) return;
    opened.current = attempt;
    if (trigger === "explicit" && failed) setOpen(true);
  }, [attempt, trigger, failed]);
  const documentReports = useRef(new Map<string, RenderReport>());
  const held = new Map<string, RenderReport>();
  const temporal = window.Temporal;
  for (const diagnosis of diagnoses) {
    if (diagnosis.kind !== "document" || capture === undefined) continue;
    const kept = documentReports.current.get(diagnosis.id);
    if (kept !== undefined) {
      held.set(diagnosis.id, kept);
      continue;
    }
    if (temporal === undefined) continue;
    held.set(
      diagnosis.id,
      captureProblemReport({
        problem: diagnosis.problem,
        message: problemText(diagnosis.problem).message,
        source: capture.source,
        capturedAt: temporal.Now.instant().toString(),
        context: capture.context(),
      }),
    );
  }
  documentReports.current = held;
  const current =
    selected === null
      ? null
      : (diagnosisReport(selected) ??
        documentReports.current.get(selected.id) ??
        null);
  const [inspected, setInspected] = useState<RenderReport | null>(null);
  useEffect(() => {
    if (current !== null) setInspected(current);
  }, [current]);
  const reading = useRef<WorkbenchDiagnosis | null>(null);
  if (selected !== null) reading.current = selected;
  return {
    diagnoses,
    selected,
    inspected: selected ?? reading.current,
    open,
    report: current ?? (selected === null ? inspected : null),
    resolved: current === null,
    next: selected === null ? first : null,
    select(id, asked) {
      setSelectedId(id);
      setOccurrence(asked ?? null);
      setOpen(true);
    },
    setOpen: openArea,
    announcement,
    announce,
  };
}

export function ProblemsFooter({
  problems,
  onOpen,
  onReturn,
}: {
  problems: WorkbenchProblemsState;
  onOpen: (diagnosis: WorkbenchDiagnosis) => void;
  onReturn?: () => void;
}) {
  const host = useWorkbenchHost();
  const startCopy = useAtomSet(useWorkbenchModel().copy(useUniqueId()));
  const panel = useRef<HTMLElement>(null);
  const [size, setSize] = useState(55);
  const drag = useRef<{ y: number; size: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const headingId = useUniqueId();
  const bodyId = useUniqueId();
  const {
    diagnoses,
    selected,
    inspected,
    next,
    open,
    setOpen,
    report,
    resolved,
  } = problems;
  const select = problems.select;
  const scroll = useRef<HTMLDivElement | null>(null);
  const focusReadingAfterCommit = useRef(false);
  useLayoutEffect(() => {
    if (!focusReadingAfterCommit.current) return;
    focusReadingAfterCommit.current = false;
    scroll.current?.focus();
  }, [open, selected?.id]);
  function focusReading(): void {
    focusReadingAfterCommit.current = true;
    scroll.current?.focus();
  }
  function returnToTemplate(): void {
    setOpen(false);
    onReturn?.();
  }
  function toggleOpen(): void {
    if (open) returnToTemplate();
    else setOpen(true);
  }
  const reportText = useMemo(
    () => (report === null ? null : formatRenderReport(report)),
    [report],
  );
  const details = useRef<HTMLDetailsElement | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  useEffect(() => setCopyFailed(false), [reportText]);
  function copyReport(text: string): void {
    setCopyFailed(false);
    startCopy({
      copy: host.copy(text),
      copied: () => {
        new BaseNotice(m.workbench_problems_copy_done());
      },
      failed: () => {
        setCopyFailed(true);
        if (details.current) details.current.open = true;
      },
    });
  }
  function reporting(text: string | null, evidence: string | null) {
    return (
      <>
        <details
          ref={details}
          data-part="problems-details"
          className="zt:mt-2 zt:min-w-0"
        >
          <summary
            data-part="problems-details-label"
            className="zt:cursor-pointer zt:text-muted-foreground"
          >
            {m.workbench_problems_technical()}
          </summary>
          {text === null ? (
            <p
              data-part="problems-evidence"
              className="zt:mt-1 zt:max-h-40 zt:overflow-auto zt:font-mono zt:whitespace-pre-wrap zt:[overflow-wrap:anywhere]"
            >
              {evidence ?? m.workbench_problems_evidence_none()}
            </p>
          ) : (
            <pre
              data-part="problems-report"
              className={problemsFooterProblemsReport}
            >
              {text}
            </pre>
          )}
        </details>
        {copyFailed && (
          <p
            role="alert"
            data-part="problems-copy-failed"
            className="zt:mt-1 zt:text-pretty zt:text-(--text-error)"
          >
            {m.workbench_problems_copy_failed()}
          </p>
        )}
      </>
    );
  }
  function reportControls(text: string | null) {
    return (
      <>
        {text !== null && (
          <button
            type="button"
            onClick={() => copyReport(text)}
            data-part="problems-copy"
            className={problemsFooterProblemsCopy}
          >
            {resolved
              ? m.workbench_problems_copy_last()
              : m.workbench_problems_copy()}
          </button>
        )}
        <a
          href={host.communityUrl}
          target="_blank"
          rel="noreferrer"
          data-part="problems-community"
          className={problemsFooterProblemsCommunity}
        >
          {m.workbench_problems_community()}
        </a>
      </>
    );
  }
  if (selected === null && !open) return null;
  const explanation = selected && diagnosisExplanation(selected);
  const engineSources = selected ? diagnosisEngineSources(selected) : [];
  const several = diagnoses.length > 1;
  return (
    <section
      ref={panel}
      style={open ? { flex: `0 0 ${size}%` } : undefined}
      data-error={diagnoses.length > 0 || undefined}
      aria-labelledby={headingId}
      data-part="problems"
      data-state={open ? "open" : "compact"}
      className={problemsFooterProblems}
    >
      {open && (
        <div
          role="separator"
          tabIndex={0}
          aria-label={m.workbench_problems_heading()}
          aria-orientation="horizontal"
          aria-valuemin={20}
          aria-valuemax={85}
          aria-valuenow={Math.round(size)}
          aria-controls={selected || reportText || next ? bodyId : undefined}
          data-dragging={dragging ? "" : undefined}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const height =
              panel.current!.parentElement!.getBoundingClientRect().height;
            drag.current = { y: event.clientY, size, height };
            setDragging(true);
            event.currentTarget.setPointerCapture(event.pointerId);
            event.preventDefault();
          }}
          onPointerMove={(event) => {
            const start = drag.current;
            if (start)
              setSize(
                Math.max(
                  20,
                  Math.min(
                    85,
                    start.size +
                      ((start.y - event.clientY) / start.height) * 100,
                  ),
                ),
              );
          }}
          onPointerUp={(event) => {
            drag.current = null;
            setDragging(false);
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onLostPointerCapture={() => {
            drag.current = null;
            setDragging(false);
          }}
          onKeyDown={(event) => {
            const next =
              event.key === "ArrowUp"
                ? size + 5
                : event.key === "ArrowDown"
                  ? size - 5
                  : event.key === "Home"
                    ? 20
                    : event.key === "End"
                      ? 85
                      : null;
            if (next === null) return;
            event.preventDefault();
            setSize(Math.max(20, Math.min(85, next)));
          }}
          data-part="problems-resize"
          className={problemsFooterProblemsResize}
        />
      )}
      <div
        data-part="problems-summary"
        className="zt:flex zt:min-w-0 zt:flex-wrap zt:items-center zt:gap-x-3 zt:gap-y-1"
      >
        {diagnoses.length > 0 && (
          <span
            data-part="problems-error-icon"
            className="zt:flex zt:shrink-0 zt:items-center zt:text-(--text-error) zt:[&_svg]:size-4"
          >
            <Icon name="circle-alert" />
          </span>
        )}
        <p
          id={headingId}
          data-part="problems-heading"
          className="zt:font-semibold"
        >
          {m.workbench_problems_heading()}
        </p>
        {diagnoses.length === 0 ? (
          <p data-part="problems-text" className={problemsFooterProblemsText}>
            {m.workbench_problems_none()}
          </p>
        ) : (
          <p
            role="status"
            aria-label={m.workbench_problems_count({ count: diagnoses.length })}
            data-part="problems-count"
            className={problemsFooterProblemsCount}
          >
            {diagnoses.length}
          </p>
        )}
        {!open && explanation !== null && (
          <p data-part="problems-text" className={problemsFooterProblemsText}>
            {explanation.condition}
          </p>
        )}
        <p
          role="status"
          data-part="problems-announcement"
          className={problemsFooterProblemsAnnouncement}
        >
          {problems.announcement}
        </p>
        <div data-part="problems-space" className={problemsFooterProblemsSpace}>
          <button
            type="button"
            aria-label={
              open ? m.workbench_problems_return() : m.workbench_problem_show()
            }
            title={
              open ? m.workbench_problems_return() : m.workbench_problem_show()
            }
            aria-expanded={open}
            aria-controls={open ? bodyId : undefined}
            onClick={toggleOpen}
            data-part="problems-toggle"
            className={problemsFooterProblemsToggle}
          >
            <Icon name={open ? "chevron-down" : "chevron-up"} />
          </button>
        </div>
      </div>
      {open && selected && explanation && (
        <div
          id={bodyId}
          data-part="problems-body"
          className={problemsFooterProblemsBody}
        >
          <div
            ref={scroll}
            tabIndex={0}
            data-part="problems-scroll"
            className={problemsFooterProblemsScroll}
          >
            {several ? (
              <div
                data-part="problems-select"
                className={problemsFooterProblemsSelect}
              >
                <WorkbenchSelect
                  aria-label={m.workbench_problems_selected()}
                  value={selected.id}
                  onChange={select}
                >
                  {diagnoses.map((diagnosis) => (
                    <WorkbenchOption key={diagnosis.id} value={diagnosis.id}>
                      {diagnosisLabel(diagnosis)}
                    </WorkbenchOption>
                  ))}
                </WorkbenchSelect>
              </div>
            ) : (
              <p
                data-part="problems-object"
                className={problemsFooterProblemsObject}
              >
                {explanation.object}
              </p>
            )}
            <p data-part="problems-text" className={problemsFooterProblemsText}>
              {explanation.condition}
            </p>
            <p
              data-part="problems-recovery"
              className="zt:max-w-[75ch] zt:text-pretty zt:leading-normal zt:text-foreground"
            >
              {explanation.suggestion}
            </p>
            {engineSources.map((sentence) => (
              <p
                key={sentence}
                data-part="problems-location"
                className={problemsFooterProblemsLocation}
              >
                {sentence}
              </p>
            ))}
            {!diagnosisLocated(selected) && (
              <p
                data-part="problems-location"
                className={problemsFooterProblemsLocation}
              >
                {m.workbench_problems_location_unknown()}
              </p>
            )}
            {reporting(reportText, explanation.evidence ?? null)}
          </div>
          <div
            data-part="problems-controls"
            className={problemsFooterProblemsControls}
          >
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpen(selected);
              }}
              data-part="problems-open"
              className={problemsFooterProblemsOpen}
            >
              {diagnosisWhere(selected)}
            </button>
            {reportControls(reportText)}
          </div>
        </div>
      )}
      {open &&
        selected === null &&
        (reportText !== null || (next !== null && inspected !== null)) && (
          <div
            id={bodyId}
            data-part="problems-body"
            className={problemsFooterProblemsBody}
          >
            <div
              ref={scroll}
              tabIndex={0}
              data-part="problems-scroll"
              className={problemsFooterProblemsScroll}
            >
              {next !== null && inspected !== null && (
                <>
                  <p
                    data-part="problems-object"
                    className={problemsFooterProblemsObject}
                  >
                    {diagnosisLabel(inspected)}
                  </p>
                  <p
                    data-part="problems-text"
                    className={problemsFooterProblemsText}
                  >
                    {m.workbench_problems_resolved()}
                  </p>
                </>
              )}
              {reportText !== null && reporting(reportText, null)}
            </div>
            <div
              data-part="problems-controls"
              className={problemsFooterProblemsControls}
            >
              {next !== null && (
                <button
                  type="button"
                  onClick={() => {
                    focusReading();
                    select(next.id);
                  }}
                  data-part="problems-next"
                  className={problemsFooterProblemsNext}
                >
                  {m.workbench_problems_next()}
                </button>
              )}
              {reportControls(reportText)}
            </div>
          </div>
        )}
    </section>
  );
}
