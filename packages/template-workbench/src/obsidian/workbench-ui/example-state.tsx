import type {
  RenderDiagnostic,
  TemplateRenderResult,
} from "#core/render/index.ts";
import { useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import * as Atom from "effect/reactivity/Atom";

import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { selectionControl } from "@zotlit/obsidian-kit/components/obsidian/selection-control.ts";
import { tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { useOptionalEditor, useWorkbenchModel } from "./editor.tsx";
import type { WorkbenchModel } from "./model.ts";
import { pendingView } from "./pending-view.ts";

import { renderFailed } from "#core/render/index.ts";

const sampleSuggesterTextTrigger = selectionControl({
  kind: "trigger",
  className: "zt:shrink-0",
});
const sampleSuggesterTrigger = selectionControl({ kind: "icon" });

type ExampleSurface = "filename" | "properties";

interface ExampleState {
  kind:
    | "ready"
    | "no-selection"
    | "loading"
    | "stale"
    | "error"
    | "failed"
    | "unavailable";
  message: string | null;
  failure: RenderDiagnostic | null;
  retained: TemplateRenderResult | null;
}

export function useExampleMessage(surface: ExampleSurface): string | null {
  return useExampleState(surface).message;
}

function produced(
  result: TemplateRenderResult,
  surface: ExampleSurface,
): boolean {
  return surface === "filename"
    ? result.filename !== null
    : result.properties.length > 0;
}

interface ExampleSelection {
  readonly id: string | undefined;
  readonly result: TemplateRenderResult | null;
  readonly previousResult: TemplateRenderResult | null;
}

const selections = new WeakMap<WorkbenchModel, Atom.Atom<ExampleSelection>>();

function exampleSelection(model: WorkbenchModel): Atom.Atom<ExampleSelection> {
  let atom = selections.get(model);
  if (atom === undefined) {
    atom = Atom.make((get): ExampleSelection => {
      const id = get(model.item)?.id;
      const { result } = get(model.scheduler.state);
      const selection = Option.getOrUndefined(get.self<ExampleSelection>());
      if (selection === undefined) return { id, result, previousResult: null };
      const changed = selection.id !== id;
      const previousResult = changed
        ? selection.result
        : selection.previousResult;
      return changed || selection.result !== result
        ? { id, result, previousResult }
        : selection;
    });
    selections.set(model, atom);
  }
  return atom;
}

export function useExampleState(surface: ExampleSurface): ExampleState {
  const editor = useOptionalEditor();
  const model = useWorkbenchModel();
  const item = useAtomValue(model.item);
  const { retained, busy, staleReason } = useAtomValue(model.scheduler.state);
  const { result, previousResult } = useAtomValue(exampleSelection(model));
  const state = (
    kind: ExampleState["kind"],
    message: string | null,
    rest: Partial<Pick<ExampleState, "failure" | "retained">> = {},
  ): ExampleState => ({
    kind,
    message,
    failure: null,
    retained: null,
    ...rest,
  });
  if (!editor) return state("ready", null);
  if (!item)
    return state(
      "no-selection",
      surface === "filename"
        ? m.workbench_name_choose_item()
        : m.workbench_properties_choose_item(),
    );
  if (!result || result === previousResult || (busy && renderFailed(result)))
    return state("loading", m.workbench_loading_item());
  const pending = pendingView({ staleReason, result, retained }, (output) =>
    produced(output, surface),
  );
  switch (pending.notice) {
    case "behind":
      return state("stale", m.workbench_example_awaiting_run(), {
        retained: result,
      });
    case "held":
      return state("stale", m.workbench_preview_stale(), { retained: result });
    case "failed":
      return state(
        "failed",
        pending.retained
          ? m.workbench_preview_retained()
          : m.workbench_preview_unavailable(),
        { retained: pending.shown },
      );
  }
  if (produced(result, surface)) return state("ready", null);
  const failure =
    result.diagnostics.find(
      ({ part, position }) => part === surface && position === undefined,
    ) ?? null;
  const kept =
    retained !== null && produced(retained, surface) ? retained : null;
  if (failure !== null) {
    return state(
      "failed",
      kept === null
        ? m.workbench_preview_unavailable()
        : m.workbench_preview_retained(),
      { failure, retained: kept },
    );
  }
  const blocking = result.diagnostics.filter(
    ({ part }) => part === undefined || part === "render" || part === "profile",
  );
  if (blocking.length === 0) return state("ready", null);
  return blocking.some(({ code }) => code === "render-error")
    ? state("error", m.workbench_example_failed())
    : state("unavailable", m.workbench_preview_unavailable());
}

export function ExampleActions({
  chooseLabel,
  onChooseItem,
  onRetry,
}: {
  chooseLabel: string;
  onChooseItem?: () => void;
  onRetry?: () => void;
}) {
  return (
    <>
      {onChooseItem && (
        <button
          type="button"
          data-part="text-trigger"
          className={sampleSuggesterTextTrigger}
          data-action="choose-item"
          {...tooltipAttrs(chooseLabel)}
          onClick={onChooseItem}
        >
          <Icon name="search" />
          <span>{chooseLabel}</span>
        </button>
      )}
      {onRetry && (
        <button
          type="button"
          data-part="trigger"
          className={sampleSuggesterTrigger}
          data-action="retry-example"
          {...tooltipAttrs(m.workbench_example_retry())}
          onClick={onRetry}
        >
          <Icon name="rotate-ccw" />
        </button>
      )}
    </>
  );
}
