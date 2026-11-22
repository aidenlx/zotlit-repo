import type {
  AnnotationRecord,
  AnnotationRepository,
} from "#obsidian/annotation-repository/service.ts";
import { Effect } from "effect";
import type { Scope } from "effect";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

import { scheduleBrowserTask } from "@zotlit/plugin-kernel/browser-scheduler.ts";
import type { EffectBridge } from "@zotlit/plugin-kernel/effect-bridge.ts";

import {
  ingestAnnotationState,
  ingestRecords,
  sameCapability,
  sameFlat,
  sameFlatList,
  selectAdjust,
  selectCapabilityAffordance,
  selectCapture,
  selectCreateRow,
  selectCreationToolbar,
  selectFloatingHead,
  selectSelectedKey,
  selectSelectedKeys,
  selectSelectedRow,
  selectTextDraft,
} from "./reader-surface-state.ts";
import type {
  Floating,
  ReaderSurfaceState,
  Step,
  Transition,
} from "./reader-surface-state.ts";
import type { AnnotationTool, ToolColorStore } from "./tools.ts";

import { sameKeys } from "#core/annot-view/card-selection.ts";
import { editingLive } from "#obsidian/annot-view/card-controls.ts";

export type ReaderSurfaceRegistry = AtomRegistry.AtomRegistry;

export const readerSurfaceRegistry: Effect.Effect<
  ReaderSurfaceRegistry,
  never,
  Scope.Scope
> = Effect.acquireRelease(
  Effect.sync(() => AtomRegistry.make({ scheduleTask: scheduleBrowserTask })),
  (registry) => Effect.sync(() => registry.dispose()),
);

export interface PopupView {
  floating: Floating;
  row: readonly object[];
}

export interface ReaderSurfaceModel {
  readonly state: Atom.Writable<ReaderSurfaceState>;
  readonly armed: Atom.Atom<ReaderSurfaceState["armed"]>;
  readonly toolbar: Atom.Atom<ReturnType<typeof selectCreationToolbar>>;
  readonly capabilityAffordance: Atom.Atom<
    ReturnType<typeof selectCapabilityAffordance>
  >;
  readonly capability: Atom.Atom<ReaderSurfaceState["capability"]>;
  readonly editingLive: Atom.Atom<boolean>;
  readonly floatingHead: Atom.Atom<ReturnType<typeof selectFloatingHead>>;
  readonly selectedKey: Atom.Atom<string | null>;
  readonly selectedKeys: Atom.Atom<readonly string[]>;
  readonly adjust: Atom.Atom<ReturnType<typeof selectAdjust>>;
  readonly capture: Atom.Atom<ReturnType<typeof selectCapture>>;
  readonly textDraft: Atom.Atom<ReturnType<typeof selectTextDraft>>;
  readonly liveStroke: Atom.Atom<ReaderSurfaceState["liveStroke"]>;
  readonly drawing: Atom.Atom<boolean>;
  readonly pendingStrokes: Atom.Atom<ReaderSurfaceState["pendingStrokes"]>;
  readonly popup: Atom.Atom<PopupView>;
}

export function makeReaderSurfaceModel(
  initial: ReaderSurfaceState,
): ReaderSurfaceModel {
  const state = Atom.keepAlive(Atom.make(initial));
  const derive = <A>(
    select: (state: ReaderSurfaceState) => A,
    equals?: (a: A, b: A) => boolean,
  ): Atom.Atom<A> => {
    const derived = Atom.map(state, select);
    return equals ? Atom.withEquality(derived, equals) : derived;
  };
  return {
    state,
    armed: derive(({ armed }) => armed),
    toolbar: derive(selectCreationToolbar, sameFlatList),
    capabilityAffordance: derive(selectCapabilityAffordance, sameFlat),
    capability: derive(({ capability }) => capability, sameCapability),
    editingLive: derive(({ capability }) => editingLive(capability)),
    floatingHead: derive(selectFloatingHead, sameFlat),
    selectedKey: derive(selectSelectedKey),
    selectedKeys: derive(selectSelectedKeys, sameKeys),
    adjust: derive(selectAdjust),
    capture: derive(selectCapture),
    textDraft: derive(selectTextDraft),
    liveStroke: derive(({ liveStroke }) => liveStroke),
    drawing: derive(
      (current) =>
        current.liveStroke !== null || selectCapture(current) !== null,
    ),
    pendingStrokes: derive(({ pendingStrokes }) => pendingStrokes),
    popup: derive(
      (current): PopupView => ({
        floating: current.floating,
        row:
          current.floating.kind === "create"
            ? selectCreateRow(current)
            : selectSelectedRow(current),
      }),
      (a, b) => a.floating === b.floating && sameFlatList(a.row, b.row),
    ),
  };
}

export interface ReaderSurface {
  readonly registry: ReaderSurfaceRegistry;
  readonly model: ReaderSurfaceModel;
}

export function update(
  { registry, model }: ReaderSurface,
  transition: Transition,
): void {
  registry.update(model.state, transition);
}

export function modify<A>(
  { registry, model }: ReaderSurface,
  step: Step<A>,
): A {
  return registry.modify(model.state, step);
}

export function current({
  registry,
  model,
}: ReaderSurface): ReaderSurfaceState {
  return registry.get(model.state);
}

export function setToolColor(
  surface: ReaderSurface,
  toolColors: ToolColorStore,
  { tool, color }: { tool: AnnotationTool; color: string },
): void {
  toolColors.set(tool, color);
  update(surface, (state) => ({ ...state, colors: toolColors.current() }));
  recordColorUse(surface, toolColors, color);
}

export function recordColorUse(
  surface: ReaderSurface,
  toolColors: ToolColorStore,
  color: string,
): void {
  toolColors.use(color);
  update(surface, (state) => ({ ...state, recentColors: toolColors.recent() }));
}

export type AnnotationFacts = Pick<
  AnnotationRepository["Service"],
  "annotationState" | "annotationChanged"
>;

export function ingestAnnotations(
  surface: ReaderSurface,
  records: readonly AnnotationRecord[],
  {
    annotations,
    bridge,
  }: {
    annotations: Pick<AnnotationRepository["Service"], "annotationState">;
    bridge: Pick<EffectBridge, "runSync">;
  },
): void {
  const states = records.map(
    ({ key }) =>
      [key, bridge.runSync(annotations.annotationState(key))] as const,
  );
  update(surface, (state) =>
    states.reduce(
      (next, [key, annotation]) => ingestAnnotationState(key, annotation)(next),
      ingestRecords(records)(state),
    ),
  );
}

export function listenAnnotationEvents(
  surface: ReaderSurface,
  annotations: AnnotationFacts,
  bridge: Pick<EffectBridge, "runSync" | "subscribe">,
): DisposableStack {
  const listening = new DisposableStack();
  listening.defer(
    bridge.subscribe(annotations.annotationChanged, (key) =>
      update(
        surface,
        ingestAnnotationState(
          key,
          bridge.runSync(annotations.annotationState(key)),
        ),
      ),
    ),
  );
  return listening;
}
