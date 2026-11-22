import type { WorkbenchDocumentController } from "#core/document/controller.ts";
import type { TemplateRenderResult } from "#core/render/result.ts";
import { RegistryContext, RegistryProvider } from "@effect/atom-react";
import { Effect, Layer } from "effect";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import type { WorkbenchReportContext } from "@zotlit/notes/core/template/render-report.ts";
import { scheduleBrowserTask } from "@zotlit/plugin-kernel/browser-scheduler.ts";
import { useUniqueId } from "@zotlit/ui";

import { NO_MATCH_DATA } from "./host.tsx";
import type { WorkbenchHost, WorkbenchHostError } from "./host.tsx";
import { holdWorkbenchModel, makeWorkbenchModel } from "./model.ts";
import type {
  WorkbenchModel,
  WorkbenchModelOptions,
  WorkbenchRuntime,
  WorkbenchViewState,
} from "./model.ts";

import { WorkbenchDocumentController as Controller } from "#core/document/controller.ts";

export interface WorkbenchEditorInstance<
  R extends TemplateRenderResult = TemplateRenderResult,
> extends Disposable {
  readonly model: WorkbenchModel<R>;
  readonly registry: AtomRegistry.AtomRegistry;
  attach(controller: WorkbenchDocumentController): void;
}

interface WorkbenchEditorOptions {
  controller: WorkbenchDocumentController;
  host: Pick<WorkbenchHost, "render" | "matchData">;
  state?: Partial<WorkbenchViewState>;
  registry?: AtomRegistry.AtomRegistry;
  runtime: WorkbenchRuntime;
  view?: Atom.Writable<WorkbenchViewState>;
  itemData?: WorkbenchModelOptions<TemplateRenderResult>["itemData"];
  choices?: WorkbenchModelOptions<TemplateRenderResult>["choices"];
  partialName?: WorkbenchModelOptions<TemplateRenderResult>["partialName"];
  panels?: WorkbenchModelOptions<TemplateRenderResult>["panels"];
  viewSize?: WorkbenchModelOptions<TemplateRenderResult>["viewSize"];
  reportContext?: () => WorkbenchReportContext;
}

export function createWorkbenchEditor<R extends TemplateRenderResult>(
  options: WorkbenchEditorOptions & {
    mapResult: (result: TemplateRenderResult) => R;
    retain?: (kept: R, result: R) => R;
  },
): WorkbenchEditorInstance<R>;
export function createWorkbenchEditor(
  options: WorkbenchEditorOptions,
): WorkbenchEditorInstance;
export function createWorkbenchEditor<R extends TemplateRenderResult>({
  controller,
  host,
  state,
  registry: providedRegistry,
  runtime,
  view: providedView,
  choices,
  partialName,
  panels,
  viewSize,
  itemData,
  reportContext,
  mapResult,
  retain,
}: WorkbenchEditorOptions & {
  mapResult?: (result: TemplateRenderResult) => R;
  retain?: (kept: R, result: R) => R;
}): WorkbenchEditorInstance<R> {
  const registry =
    providedRegistry ?? AtomRegistry.make({ defaultIdleTTL: 400 });
  const initial =
    controller.document?.manifest.id === "default" && state?.tab === "match"
      ? { ...state, tab: "note" as const }
      : state;
  const model = makeWorkbenchModel<R>({
    controller,
    ...(providedView ? { view: providedView } : {}),
    ...(choices ? { choices } : {}),
    ...(partialName ? { partialName } : {}),
    ...(itemData ? { itemData } : {}),
    ...(panels ? { panels } : {}),
    ...(viewSize ? { viewSize } : {}),
    ...(initial ? { initial } : {}),
    runtime,
    host,
    render: (request) => {
      const result = host.render(request);
      return mapResult
        ? Effect.map(result, (value) => mapResult(value))
        : (result as Effect.Effect<R, WorkbenchHostError>);
    },
    failed: mapResult ?? ((result) => result as R),
    ...(retain ? { retain } : {}),
    ...(reportContext ? { reportContext } : {}),
  });
  const release = holdWorkbenchModel(registry, model);
  let closed = false;
  return {
    model,
    registry,
    attach(next) {
      registry.set(model.controller, next);
    },
    [Symbol.dispose]() {
      if (closed) return;
      closed = true;
      release();
      if (providedRegistry === undefined) registry.dispose();
    },
  };
}

export interface WorkbenchEditor {
  readonly model: WorkbenchModel;
  readonly registry: AtomRegistry.AtomRegistry;
  readonly id: string;
}

const EditorContext = createContext<WorkbenchEditor | null>(null);

let inert: WorkbenchModel | undefined;
function inertModel(): WorkbenchModel {
  inert ??= makeWorkbenchModel({
    controller: new Controller(""),
    runtime: Atom.runtime(Layer.empty),
    host: { matchData: NO_MATCH_DATA },
    render: () => Effect.die("An inert Workbench never renders."),
    failed: (result) => result,
  });
  return inert;
}

export function WorkbenchEditorProvider<R extends TemplateRenderResult>({
  editor,
  children,
}: {
  editor: WorkbenchEditorInstance<R> | null;
  children?: ReactNode;
}) {
  const id = useUniqueId();
  if (editor === null)
    return (
      <RegistryProvider scheduleTask={scheduleBrowserTask} defaultIdleTTL={400}>
        {children}
      </RegistryProvider>
    );
  const { registry, model } = editor;
  return (
    <RegistryContext.Provider value={registry}>
      <EditorContext.Provider value={{ model, registry, id }}>
        {children}
      </EditorContext.Provider>
    </RegistryContext.Provider>
  );
}

export function useOptionalEditor(): WorkbenchEditor | null {
  return useContext(EditorContext);
}

export function useWorkbenchEditor(): WorkbenchEditor {
  const editor = useContext(EditorContext);
  if (editor === null) {
    throw new Error(
      "The Workbench UI needs a WorkbenchEditorProvider above it.",
    );
  }
  return editor;
}

export function useWorkbenchModel(): WorkbenchModel {
  return useContext(EditorContext)?.model ?? inertModel();
}
