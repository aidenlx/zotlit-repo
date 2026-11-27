import type { WorkbenchDocumentController } from "#core/document/controller.ts";
import type { RenderDiagnostic } from "#core/render/result.ts";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import { BaseNotice } from "@zotlit/obsidian-kit/notice.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { WorkbenchInsertTarget } from "./host.tsx";
import type { WorkbenchModel, WorkbenchViewState } from "./model.ts";
import type { ProblemTarget, RoutedDocument } from "./problem-route.ts";
import { routeDiagnosis, routeProblem } from "./problem-route.ts";
import type { WorkbenchProblemsState } from "./problems-footer.tsx";
import type { WorkbenchDiagnosis } from "./problems.ts";
import {
  diagnosisExplanation,
  diagnosisForOccurrence,
  diagnosisLocated,
  renderDiagnosis,
} from "./problems.ts";

export interface RepairCommands {
  readonly goToProblem: (problem: ProblemTarget) => void;
  readonly openDiagnosis: (diagnosis: WorkbenchDiagnosis) => void;
  readonly showProblem: (diagnostic: RenderDiagnostic | null) => void;
  readonly openAnnotationBox: () => void;
  readonly returnToTemplate: () => void;
}

export interface RepairCommandsInput {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly model: Pick<WorkbenchModel, "view" | "fieldsPanel">;
  readonly controller: RoutedDocument &
    Pick<WorkbenchDocumentController, "hasSlice">;
  readonly problems: Pick<
    WorkbenchProblemsState,
    "diagnoses" | "select" | "setOpen" | "announce"
  >;
}

export function selectionInDocument(
  selection: WorkbenchInsertTarget | null,
  document: Pick<WorkbenchDocumentController, "hasSlice">,
): WorkbenchInsertTarget | null {
  return selection && document.hasSlice(selection.slice) ? selection : null;
}

export function insertionTarget(
  selection: WorkbenchInsertTarget | null,
  document: Pick<WorkbenchDocumentController, "hasSlice">,
): WorkbenchInsertTarget | null {
  const target = selectionInDocument(selection, document);
  return target?.range.placed ? target : null;
}

type Transition = (state: WorkbenchViewState) => WorkbenchViewState;

export function repairCommands({
  registry,
  model,
  controller,
  problems,
}: RepairCommandsInput): RepairCommands {
  const closeFields = () => registry.set(model.fieldsPanel, "to-editor");
  const route = (transition: Transition) =>
    registry.update(model.view, transition);
  const go = (transition: Transition) => {
    closeFields();
    route(transition);
  };
  const goToProblem = (problem: ProblemTarget) =>
    go(routeProblem(problem, controller));
  return {
    goToProblem,
    openDiagnosis(diagnosis) {
      const transition = routeDiagnosis(diagnosis, controller);
      if (transition) go(transition);
      else new BaseNotice(m.workbench_problems_location_unknown());
    },
    showProblem(diagnostic) {
      closeFields();
      const unknown = m.workbench_problems_location_unknown();
      if (diagnostic === null) {
        problems.setOpen(true);
        problems.announce(unknown);
        return;
      }
      const id = renderDiagnosis(diagnostic).id;
      problems.select(id, diagnostic);
      const found = problems.diagnoses.find((diagnosis) => diagnosis.id === id);
      if (!found) return;
      const shown = diagnosisForOccurrence(found, diagnostic);
      const transition = diagnosisLocated(shown)
        ? routeDiagnosis(shown, controller)
        : null;
      const { condition } = diagnosisExplanation(shown);
      problems.announce(transition ? condition : `${condition} ${unknown}`);
      if (transition) route(transition);
    },
    openAnnotationBox: () => goToProblem({ slice: "annotation" }),
    returnToTemplate() {
      const target = selectionInDocument(
        registry.get(model.view).presentation.selection,
        controller,
      );
      const reveal = target
        ? { ...target.range, slice: target.slice }
        : { from: 0, to: 0 };
      go((state) => ({
        ...state,
        presentation: { ...state.presentation, reveal },
      }));
    },
  };
}
