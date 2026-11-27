import type {
  WorkbenchDocumentController,
  WorkbenchSliceId,
} from "#core/document/index.ts";
import type { Diagnostic } from "@codemirror/lint";
import { forEachDiagnostic, setDiagnosticsEffect } from "@codemirror/lint";
import { Compartment } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";
import type { ReactNode } from "react";
import { createContext, useContext } from "react";

import type { WorkbenchDiagnosis } from "./problems.ts";
import { diagnosisExplanation } from "./problems.ts";

import { entryPosition, sliceOffsets } from "#core/document/index.ts";
import { currentCallSite, currentSliceSite } from "#core/render/locate.ts";

const Findings = createContext<readonly WorkbenchDiagnosis[]>([]);
const Reveal = createContext<((id: string) => void) | undefined>(undefined);
export function WorkbenchDiagnosticsProvider({
  value,
  onReveal,
  children,
}: {
  value: readonly WorkbenchDiagnosis[];
  onReveal?: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <Findings.Provider value={value}>
      <Reveal.Provider value={onReveal}>{children}</Reveal.Provider>
    </Findings.Provider>
  );
}
export const useRevealSourceDiagnosis = () => useContext(Reveal);
export const useSourceDiagnoses = () => useContext(Findings);

interface SourceDiagnostic extends Diagnostic {
  diagnosisId: string;
}

export function sourceDiagnostics({
  controller,
  slice,
  source,
  diagnoses,
  json,
}: {
  controller: WorkbenchDocumentController;
  slice: WorkbenchSliceId;
  source: string;
  diagnoses: readonly WorkbenchDiagnosis[];
  json: boolean;
}): SourceDiagnostic[] {
  const bounds = controller.sliceRange(slice);
  const offsets = sliceOffsets(controller, slice, source);
  const shown = (range: { from: number; to: number } | undefined) =>
    range && range.from >= bounds.from && range.to <= bounds.to
      ? {
          from: offsets.toShown(range.from - bounds.from),
          to: offsets.toShown(range.to - bounds.from),
        }
      : undefined;
  const position = entryPosition(slice);
  const ownSite = (diagnostic: { part?: string; position?: number }) =>
    position !== null
      ? diagnostic.position === position
      : slice === "filename" && diagnostic.part === "filename";
  return diagnoses.flatMap((diagnosis) => {
    const explanation = diagnosisExplanation(diagnosis);
    const ranges =
      diagnosis.kind === "document"
        ? diagnosis.occurrences.map((problem) => shown(problem.range))
        : diagnosis.occurrences.map((diagnostic) =>
            ownSite(diagnostic)
              ? currentSliceSite(diagnostic, source)
              : shown(currentCallSite(diagnostic, controller)),
          );
    return ranges.flatMap((range): SourceDiagnostic[] => {
      if (!range) return [];
      const { from, to } = range;
      return [
        {
          from,
          to: json ? trimmedEnd(source, from, to) : to,
          severity: "error",
          diagnosisId: diagnosis.id,
          message: `${explanation.condition}\n${explanation.suggestion}`,
        },
      ];
    });
  });
}

function trimmedEnd(source: string, from: number, to: number): number {
  let end = to;
  while (end > from + 1 && /\s/.test(source[end - 1] ?? "")) end -= 1;
  return end;
}

export function sourceProblemGutter(
  reveal: (id: string) => void,
  label: () => string,
) {
  class ProblemMarker extends GutterMarker {
    readonly id: string;

    constructor(id: string) {
      super();
      this.id = id;
    }
    eq(other: ProblemMarker) {
      return this.id === other.id;
    }
    toDOM(view: EditorView) {
      const button = view.dom.ownerDocument.createElement("button");
      button.type = "button";
      button.className = "cm-problem-button";
      button.setAttribute("aria-label", label());
      button.onclick = () => reveal(this.id);
      return button;
    }
  }
  const slot = new Compartment();
  const column = [
    gutter({
      class: "cm-problem-gutter",
      lineMarker(view, line) {
        let id: string | undefined;
        forEachDiagnostic(view.state, (diagnostic, from) => {
          if (
            id === undefined &&
            from >= line.from &&
            from <= line.to &&
            "diagnosisId" in diagnostic &&
            typeof diagnostic.diagnosisId === "string"
          ) {
            id = diagnostic.diagnosisId;
          }
        });
        return id === undefined ? null : new ProblemMarker(id);
      },
      lineMarkerChange: (update) =>
        update.docChanged ||
        update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(setDiagnosticsEffect)),
        ),
    }),
    EditorView.theme({
      "&.cm-editor .cm-scroller .cm-gutters": { marginInlineEnd: "0" },
      ".cm-problem-gutter": { width: "16px" },
      ".cm-problem-gutter .cm-gutterElement": {
        padding: "0",
        textAlign: "center",
      },
      ".cm-problem-button": {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "16px",
        minWidth: "0",
        height: "1.4em",
        padding: "0",
        margin: "0",
        border: "0",
        borderRadius: "3px",
        background: "transparent",
        boxShadow: "none",
        verticalAlign: "top",
        cursor: "pointer",
      },
      ".cm-problem-button::before": {
        content: '""',
        display: "block",
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        background: "currentColor",
      },
      ".cm-problem-button:focus-visible": {
        outline: "2px solid currentColor",
        outlineOffset: "-2px",
      },
    }),
  ];
  return {
    extension: slot.of([]),
    show: (present: boolean) => slot.reconfigure(present ? column : []),
  };
}
