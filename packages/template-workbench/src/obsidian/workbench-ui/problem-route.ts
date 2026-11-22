import type {
  WorkbenchDocumentController,
  WorkbenchProblem,
  WorkbenchSliceId,
} from "#core/document/controller.ts";

import type { WorkbenchViewState } from "./model.ts";
import type { WorkbenchDiagnosis } from "./problems.ts";
import type { SliceReveal } from "./slice-editor.tsx";
import { isProfileProblem } from "./tabs.ts";

import { entryPosition } from "#core/document/controller.ts";
import { currentCallSite } from "#core/render/locate.ts";

export type RoutedDocument = Pick<
  WorkbenchDocumentController,
  "kind" | "sliceRange" | "annotationSection" | "source" | "language"
>;

export type ProblemTarget = Pick<
  WorkbenchProblem,
  "slice" | "range" | "params"
> & {
  readonly code?: WorkbenchProblem["code"];
};

type Transition = (state: WorkbenchViewState) => WorkbenchViewState;

const caret = (from: number): SliceReveal => ({ from, to: from });

function openPane(
  document: RoutedDocument,
  {
    slice,
    reveal,
    field = null,
    profile = false,
  }: {
    readonly slice: WorkbenchSliceId;
    readonly reveal: SliceReveal | null;
    readonly field?: string | null;
    readonly profile?: boolean;
  },
): Transition {
  return (state) => {
    const revealed = reveal ? { ...reveal } : null;
    if (document.kind !== "profile" || slice === "source")
      return {
        ...state,
        presentation: { ...state.presentation, reveal: revealed },
      };
    const entry = entryPosition(slice);
    return {
      ...state,
      advanced: slice === "advanced",
      tab:
        entry !== null
          ? "properties"
          : profile
            ? "profile"
            : slice === "filename" || slice === "details"
              ? "name"
              : slice === "annotation"
                ? "annotation"
                : slice === "advanced"
                  ? state.tab
                  : "note",
      root:
        slice === "annotation"
          ? "annotation"
          : slice === "filename"
            ? "filename"
            : "note",
      presentation: {
        ...state.presentation,
        selected: entry ?? state.presentation.selected,
        reveal: revealed,
        fieldFocus: field === null ? null : { field },
      },
    };
  };
}

function openAnnotation(document: RoutedDocument): Transition {
  const section = document.annotationSection;
  return openPane(document, {
    slice: "annotation",
    reveal: section ? caret(section.source.from) : null,
  });
}

export function routeProblem(
  problem: ProblemTarget,
  document: RoutedDocument,
): Transition {
  if (
    problem.code === "missing-annotation-section" ||
    (problem.slice === "annotation" && problem.range === undefined)
  )
    return openAnnotation(document);
  if (problem.slice === "details")
    return openPane(document, {
      slice: "details",
      reveal: null,
      field: problem.params?.field ?? null,
      profile: isProfileProblem(problem),
    });
  return openPane(document, {
    slice: problem.slice,
    reveal: problem.range ?? null,
  });
}

function sliceHolding(
  document: RoutedDocument,
  from: number,
): WorkbenchSliceId {
  if (document.kind !== "profile") return "source";
  for (const slice of ["note", "annotation", "filename"] as const) {
    const region = document.sliceRange(slice);
    if (region.from <= from && from < region.to) return slice;
  }
  return "advanced";
}

export function routeDiagnosis(
  diagnosis: WorkbenchDiagnosis,
  document: RoutedDocument,
): Transition | null {
  if (diagnosis.kind === "document")
    return routeProblem(diagnosis.problem, document);
  const { part, position, callSite, sourceSite } = diagnosis.diagnostic;
  if (callSite || sourceSite) {
    const current = currentCallSite(diagnosis.diagnostic, document);
    if (current === undefined) return null;
    return openPane(document, {
      slice: sliceHolding(document, current.from),
      reveal: current,
    });
  }
  if (position !== undefined)
    return openPane(document, { slice: `entry:${position}`, reveal: null });
  if (document.kind !== "profile")
    return openPane(document, { slice: "source", reveal: null });
  if (part === "annotation") return openAnnotation(document);
  if (part === "filename")
    return openPane(document, {
      slice: "filename",
      reveal: caret(document.sliceRange("filename").from),
    });
  return openPane(document, { slice: "advanced", reveal: null });
}
