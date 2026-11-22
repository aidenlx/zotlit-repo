import * as m from "@zotlit/plugin-messages/messages.ts";

import type {
  CreationProfileSource,
  CreationSelectionProblem,
} from "./operations.ts";

export function describeSelectionSource(
  source: CreationProfileSource,
): string | undefined {
  switch (source) {
    case "headless":
      return m.batch_profile_source_companion();
    case "asked":
      return m.batch_profile_source_chosen();
    case "match":
      return m.batch_profile_source_match();
    case "bound":
      return undefined;
  }
}

export function describeSelectionProblem(
  problem: CreationSelectionProblem,
): string {
  switch (problem.kind) {
    case "overlap":
      return m.modal_profile_problem_overlap({
        profiles: problem.candidates.map(({ label }) => label).join(", "),
      });
    case "unavailable-profile":
      return m.modal_profile_problem_unavailable_profile({
        selector: problem.selector,
      });
    case "invalid-selector":
      return m.modal_profile_problem_invalid_selector({
        selector: problem.selector,
      });
  }
}
