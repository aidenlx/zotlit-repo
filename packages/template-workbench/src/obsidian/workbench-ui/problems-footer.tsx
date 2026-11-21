import type { RenderDiagnostic } from "#core/render/result.ts";
// The editor's Problems area: one detected problem at a time, led by the
// object it is about, and the disclosure the reader controls. Automatic checks
// leave that choice alone; Show problem, a source marker, and a failed
// explicit Run open it. Its controls navigate, disclose, and report — every
// repair is the reader's own edit, described in the suggestion.
//
// Several problems are counted and offered in a selector, and the selected one
// is the one that stays through a check. A repair that resolves it while
// others remain says so and offers Next problem, so the explanation the reader
// is on changes when the reader asks and not when a check lands.
//
// Technical details shows the report text, and Copy error report copies that
// same text. The report was captured with its attempt, so it keeps describing
// that failure after the reader edits the source, chooses another Item, or
// repairs the template; a resolved area still offers the last one. A document
// problem reaches the reader through the same report: the scheduler stamps a
// render failure with its attempt, and this area stamps a parser problem with
// the check that found it.
//
// Source and explanation share the pane. The divider adjusts that share;
// the chevron closes the explanation and returns focus to the source.
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

// Its own surface, so the engine's own words read as the block they are.
// It scrolls in both directions rather than wrapping: a caret excerpt
// only points at the right column while its lines stay intact.
const problemsFooterProblemsReport =
  "zt:mt-1 zt:max-h-56 zt:overflow-auto zt:rounded-md zt:border zt:border-border zt:bg-(--background-secondary) zt:p-2 zt:font-mono zt:whitespace-pre zt:select-text";
const problemsFooterProblemsCopy = templateWorkbenchButton;
// Help, not an action: it reads as the link it is, aligned with the
// buttons it shares the row with.
const problemsFooterProblemsCommunity =
  "zt:self-center zt:underline zt:underline-offset-2";
// The divider sets the area's share; the host supplies native colors.
// Open, the divider draws the area's top line.
const problemsFooterProblems =
  "zt:relative zt:flex zt:min-h-0 zt:flex-col zt:gap-2 zt:border-t zt:border-border zt:data-[state=open]:border-t-0 zt:p-3 zt:text-xs zt:leading-normal zt:data-[error]:border-s-2 zt:data-[error]:border-s-(--text-error)";
// Its line runs over the area's error mark too, as the area's own top
// border did: `-start-0.5` is the mark's `border-s-2`.
const problemsFooterProblemsResize = cn(
  paneDivider({ flow: "overlay", edge: "top" }),
  "zt:in-data-[error]:-start-0.5",
);
const problemsFooterProblemsText =
  "zt:min-w-0 zt:text-pretty zt:font-medium zt:text-foreground";
const problemsFooterProblemsCount =
  "zt:shrink-0 zt:rounded-sm zt:bg-(--background-modifier-error)/10 zt:text-foreground zt:px-1.5 zt:font-medium zt:tabular-nums zt:whitespace-nowrap";
// A value that changes as problems are repaired, so its digits hold
// their width and it keeps its own line rather than wrapping mid-count.
const problemsFooterProblemsAnnouncement = "zt:sr-only";
// Each control is capped at the row, so a long translated label wraps
// inside its own box instead of running past the pane.
const problemsFooterProblemsSpace =
  "zt:ms-auto zt:flex zt:min-w-0 zt:flex-wrap zt:items-center zt:gap-2 zt:[&>*]:max-w-full zt:[&>*]:min-w-0";
const problemsFooterProblemsToggle = selectionControl({ kind: "icon" });
const problemsFooterProblemsBody =
  "zt:flex zt:min-h-0 zt:min-w-0 zt:flex-1 zt:flex-col zt:gap-1";
// The explanation, and only the explanation, scrolls. It takes whatever
// the area has left, so the controls keep one place along its bottom
// edge whichever problem is read and however long its explanation runs.
// A reader with no pointer scrolls it from the keyboard, and Obsidian
// clears the outline every focus ring would otherwise draw, so the ring
// is drawn inside.
const problemsFooterProblemsScroll = cn(
  "zt:flex zt:min-h-0 zt:flex-1 zt:flex-col zt:gap-1 zt:overflow-y-auto zt:overscroll-contain zt:pb-1",
  "zt:focus-visible:shadow-[inset_0_0_0_2px_var(--background-modifier-border-focus)]",
);
// The chooser leads the explanation where the object line otherwise
// would, at its own width rather than stretched across the column.
const problemsFooterProblemsSelect = "zt:min-w-0 zt:max-w-full zt:self-start";
const problemsFooterProblemsObject =
  "zt:font-semibold zt:[overflow-wrap:anywhere]";
// A reported location names the engine's own template, which is one
// unbroken machine-written token in a pane the reader can narrow.
const problemsFooterProblemsLocation =
  "zt:text-pretty zt:text-muted-foreground zt:[overflow-wrap:anywhere]";
// Under the scroll, never inside it: every one of these stays put while
// a long explanation and an open disclosure move past above them. The
// rule over them marks where the explanation scrolls out of view, so a
// line cut at that edge reads as more to scroll, not as covered.
const problemsFooterProblemsControls =
  "zt:flex zt:min-w-0 zt:shrink-0 zt:flex-wrap zt:border-t zt:border-border zt:pt-2 zt:items-center zt:gap-2 zt:[&>*]:max-w-full zt:[&>*]:min-w-0";
const problemsFooterProblemsOpen = templateWorkbenchButton;
const problemsFooterProblemsNext = templateWorkbenchButton;

/** The Problems area's own state: which problem is read, and whether in full. */
export interface WorkbenchProblemsState {
  readonly diagnoses: readonly WorkbenchDiagnosis[];
  /** The problem the area explains; `null` once the selected one is resolved. */
  readonly selected: WorkbenchDiagnosis | null;
  /**
   * The problem the reader is reading, whether or not this check still finds
   * it, so a resolved explanation can still name what it was about.
   */
  readonly inspected: WorkbenchDiagnosis | null;
  /** The reader's own open-or-collapsed choice, which checks never change. */
  readonly open: boolean;
  /**
   * The selected problem's captured report, or the last one read once that
   * problem is resolved. Bounded to what is being inspected: one repair does
   * not build a history, and a later problem brings its own report.
   */
  readonly report: RenderReport | null;
  /** Whether `report` describes a failure this check no longer finds. */
  readonly resolved: boolean;
  /**
   * The problem to read once the selected one is resolved and others remain;
   * `null` while the selected problem stands and once nothing is left. Only
   * the reader moves the explanation on, so a check never selects it.
   */
  readonly next: WorkbenchDiagnosis | null;
  /**
   * Reads one problem in full, which a source marker and Show problem do.
   * `occurrence` is the one of its grouped occurrences the area reads, as the
   * preview reported it.
   */
  readonly select: (id: string, occurrence?: RenderDiagnostic) => void;
  /** Opens or reclaims the area; reclaiming it also gives back the editor. */
  readonly setOpen: (open: boolean) => void;
  /**
   * What the area's polite status says: why a problem Show problem revealed
   * fails, while focus is on the call in the editor rather than in the area.
   */
  readonly announcement: string;
  readonly announce: (text: string) => void;
}

/**
 * What a document problem's own report is captured from. The parser reads
 * those problems out of the current source on every check, so the attempt
 * behind one is the check that found it: the source it was read from, and
 * what names this Workbench. A host that supplies none leaves
 * its document problems without a report.
 */
export interface WorkbenchProblemCapture {
  /** The document text the checks read. */
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
  /** How the attempt behind the newest result started. */
  readonly trigger: RenderTrigger | null;
  /** Counts published results, so one deliberate failure opens the area once. */
  readonly attempt: number;
  readonly capture?: WorkbenchProblemCapture;
}): WorkbenchProblemsState {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [occurrence, setOccurrence] = useState<RenderDiagnostic | null>(null);
  const [open, setOpen] = useState(false);
  const [announcement, announce] = useState("");
  // The occurrence the reader asked about stands for its grouped problem while
  // a check still reports it.
  const diagnoses =
    occurrence === null
      ? found
      : found.map((diagnosis) => diagnosisForOccurrence(diagnosis, occurrence));
  // Reclaiming the area hands the editor back whole, so the next Show problem
  // starts from the split rather than from the space the last reading took.
  // The reading is over with it: a compact area follows the first problem
  // found, so a repair that resolves the problem the reader had open leaves
  // the summary on whatever is still there rather than on nothing at all.
  // One identity for the life of the hook: a host subscribes with this.
  const openArea = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      announce("");
      setSelectedId(null);
      setOccurrence(null);
    }
  }, []);
  // Selection keys on the problem's identity rather than its place in the
  // list, so a check that finds the same problem keeps the reader's place.
  // An open area holds the problem being read from the moment it is read: its
  // repair is then a resolved explanation rather than a silent move to the
  // next problem. A compact area reads whichever problem comes first, and a
  // check that finds nothing lets the selection go, so the next failure
  // arrives as the problem it is.
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
    // A deliberate attempt that failed is the reader asking what happened; an
    // automatic one during typing leaves the area as they left it.
    if (trigger === "explicit" && failed) setOpen(true);
  }, [attempt, trigger, failed]);
  // A document problem is found again by every check, so its report is taken
  // the first time that problem is seen and held while it lasts: a later edit,
  // another Item, or another check leaves the captured one as it stands. A
  // problem the checks stop finding takes its report with it, which is what
  // keeps this inspection bounded rather than a failure history.
  // A Temporal polyfill installed after the first render causes a later
  // render, so an early invalid draft remains uncaptured here.
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
  // The report the reader is looking at survives the repair that resolves it,
  // so a successful check still leaves the failure they wanted to report. It
  // resurfaces only once nothing is selected: another problem's explanation
  // shows that problem's own evidence, never the last engine failure.
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
  // The problem the reader is reading, kept past the repair that resolves it
  // so the area can still name what the resolved explanation was about. A
  // cache of what this render already computed, not state of its own.
  const reading = useRef<WorkbenchDiagnosis | null>(null);
  if (selected !== null) reading.current = selected;
  return {
    diagnoses,
    selected,
    inspected: selected ?? reading.current,
    open,
    report: current ?? (selected === null ? inspected : null),
    resolved: current === null,
    // Offered rather than taken: a check that resolves the selected problem
    // leaves the reader on its resolved state until they ask for the next one.
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

/** Nothing found, as one value, so an idle preview publishes no new list. */
export function ProblemsFooter({
  problems,
  onOpen,
  onReturn,
}: {
  /** The area's state, from `useWorkbenchProblems`. */
  problems: WorkbenchProblemsState;
  /** Opens the pane the selected problem is repaired in. */
  onOpen: (diagnosis: WorkbenchDiagnosis) => void;
  /**
   * Puts the reader back where they were editing, which the area asks for once
   * it has reclaimed its space. A host that supplies none leaves the source
   * where the reading left it.
   */
  onReturn?: () => void;
}) {
  const host = useWorkbenchHost();
  const startCopy = useAtomSet(useWorkbenchModel().copy(useUniqueId()));
  const panel = useRef<HTMLElement>(null);
  const [size, setSize] = useState(55);
  const drag = useRef<{ y: number; size: number; height: number } | null>(null);
  // The divider says it is dragged, so the host can draw it as held.
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
  /** Focus the stable explanation region after its trigger disappears. */
  function focusReading(): void {
    focusReadingAfterCommit.current = true;
    scroll.current?.focus();
  }
  /** Reading is over: the source takes its space back and the caret with it. */
  function returnToTemplate(): void {
    setOpen(false);
    onReturn?.();
  }
  function toggleOpen(): void {
    if (open) returnToTemplate();
    else setOpen(true);
  }
  // One text, shown and copied. Building it once keeps Technical details and
  // the clipboard from ever disagreeing about what was reported.
  const reportText = useMemo(
    () => (report === null ? null : formatRenderReport(report)),
    [report],
  );
  const details = useRef<HTMLDetailsElement | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  // A different report is a different copy: the previous failure notice goes.
  useEffect(() => setCopyFailed(false), [reportText]);
  function copyReport(text: string): void {
    setCopyFailed(false);
    startCopy({
      copy: host.copy(text),
      copied: () => {
        new BaseNotice(m.workbench_problems_copy_done());
      },
      failed: () => {
        // A denied clipboard leaves the reader the report itself: the
        // disclosure opens so the text is there to select and copy by hand.
        setCopyFailed(true);
        if (details.current) details.current.open = true;
      },
    });
  }
  /** Technical details, Copy error report, and Ask the community, as one block. */
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
  /** The reporting controls, which stay reachable while the details collapse. */
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
  // Nothing found and nothing open: the area gives its space back to the
  // source rather than reporting its own emptiness.
  if (selected === null && !open) return null;
  const explanation = selected && diagnosisExplanation(selected);
  const engineSources = selected ? diagnosisEngineSources(selected) : [];
  // Several problems are chosen between rather than read at once, and the
  // choice names the object each one is about, so it stands in for the line
  // the explanation would otherwise lead with.
  const several = diagnoses.length > 1;
  return (
    <section
      ref={panel}
      style={open ? { flex: `0 0 ${size}%` } : undefined}
      data-error={diagnoses.length > 0 || undefined}
      aria-labelledby={headingId}
      // The reader's chosen share survives checks, repairs, and reopening.
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
        {/* What the checks found, never what the document holds: a parser that
            stops at its first error leaves the rest undiscovered. */}
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
        {/* How much of the editor this reading takes, on the trailing edge and
            together: one grows the area, the other gives it all back. */}
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
          {/* The explanation is what scrolls. A reader with no pointer scrolls
              it from here, and the controls below stay where they were. */}
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
            {/* Where the engine said it happened and where the reader repairs
                it are different places, so they are read as separate lines
                rather than folded into one claim. Grouped occurrences each keep
                the place they were reported from. */}
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
                // The reading gives the pane back before the caret moves:
                // an explanation holding the whole editor would otherwise
                // send the reader to source it hides.
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
          // The repair succeeded, and the failure the reader was reading is
          // still here to report. It is the last one inspected, not a history.
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
                // Others were found, so this says which one went rather than
                // presenting the whole preview as successful.
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
