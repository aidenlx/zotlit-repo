import type { WorkbenchDocumentAtoms } from "#core/document/atoms.ts";
import type { WorkbenchDocumentController } from "#core/document/controller.ts";
import type { WorkbenchItemChoice } from "#core/editor/selection-data.ts";
import type { RenderRequest } from "#core/render/request.ts";
import type { TemplateRenderResult } from "#core/render/result.ts";
import { Cause, Effect } from "effect";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";

import { DEFAULT_CITATION_VARIANT } from "@zotlit/db";
import type { CitationVariant } from "@zotlit/db";
import type {
  CitationExampleId,
  CitationPreviewSelection,
} from "@zotlit/notes/core/template-preview/citation-examples.ts";
import {
  CITATION_EXAMPLE_ITEM,
  DEFAULT_CITATION_EXAMPLE,
} from "@zotlit/notes/core/template-preview/citation-examples.ts";
import type { PartialPreviewSelection } from "@zotlit/notes/core/template-preview/partial-preview.ts";
import { isPartialContext } from "@zotlit/notes/core/template-preview/partial-preview.ts";
import type { AnnotationExample } from "@zotlit/notes/core/template-preview/sample-annotations.ts";
import type { WorkbenchReportContext } from "@zotlit/notes/core/template/render-report.ts";
import type { MatchTree } from "@zotlit/templates/facade";
import type { ItemSnapshot } from "@zotlit/zotero-reads/contract/snapshot/types.ts";

import {
  annotationExamples,
  sampleAnnotationParent,
} from "./annotation-samples.ts";
import type { AnnotationExamples } from "./annotation-samples.ts";
import type {
  WorkbenchClipboardError,
  WorkbenchHostError,
  WorkbenchMatchData,
  WorkbenchMatchResult,
} from "./host.tsx";
import type { WorkbenchInsertTarget } from "./host.tsx";
import {
  hideFields,
  INITIAL_PANELS,
  pinFields,
  placePanels,
} from "./panel-layout.ts";
import type {
  FieldsPanelState,
  FieldsPin,
  FieldsPlacement,
  PanelHandle,
  PanelPlacement,
  ViewSize,
  WorkbenchPanels,
} from "./panel-layout.ts";
import { patch, patchAt } from "./patch.ts";
import { makeRenderSchedulerAtoms } from "./scheduler-atoms.ts";
import type {
  RenderSchedulerAtoms,
  RenderSchedulerInput,
} from "./scheduler-atoms.ts";
import type { SliceReveal } from "./slice-editor.tsx";
import type { WorkbenchTab } from "./tabs.ts";

import { workbenchDocumentAtoms } from "#core/document/atoms.ts";

export type { WorkbenchItemChoice };

export type TemplateRoot = "note" | "annotation" | "filename" | "citation";

export interface FieldsStatus {
  readonly text: string;
  readonly count: number;
}

export const announceFields =
  (text: string) =>
  (last: FieldsStatus | null): FieldsStatus => ({
    text,
    count: (last?.count ?? 0) + 1,
  });

export type PreviewMode = "create" | "update";

export interface EditorPresentation {
  restoreVersion: number;
  restoring: boolean;
  selection: WorkbenchInsertTarget | null;
  selected: number | null;
  reveal: SliceReveal | null;
  fieldFocus: {
    field: string;
    focus?: boolean;
    scrollIntoView?: boolean;
  } | null;
  scroll: Record<string, { top: number; left: number }>;
}

export interface WorkbenchViewState {
  readonly presentation: EditorPresentation;
  readonly tab: WorkbenchTab;
  readonly item: WorkbenchItemChoice | null;
  readonly root: TemplateRoot;
  readonly advanced: boolean;
}

export interface WorkbenchPreviewSettings {
  readonly mode: PreviewMode;
  readonly live: boolean;
  readonly showMarkdown: boolean;
  readonly showManaged: boolean;
}

export interface WorkbenchChoices {
  readonly annotationId: string | null;
  readonly variant: CitationVariant;
  readonly citationExample: CitationExampleId | null;
  readonly partialProfile: string | null;
  readonly preview: WorkbenchPreviewSettings;
}

export interface WorkbenchItemData {
  readonly snapshot: ItemSnapshot | null;
  readonly document?: string | undefined;
  readonly hold?: boolean | "invalid" | undefined;
}

export interface WorkbenchItemDataInput {
  readonly controller: Atom.Atom<WorkbenchDocumentController>;
  readonly document: WorkbenchDocumentAtoms;
}

export const INITIAL_VIEW: WorkbenchViewState = {
  presentation: {
    restoreVersion: 0,
    restoring: false,
    selection: null,
    selected: null,
    reveal: null,
    fieldFocus: null,
    scroll: {},
  },
  tab: "note",
  item: null,
  root: "note",
  advanced: false,
};

export const INITIAL_CHOICES: WorkbenchChoices = {
  annotationId: null,
  variant: DEFAULT_CITATION_VARIANT,
  citationExample: DEFAULT_CITATION_EXAMPLE,
  partialProfile: null,
  preview: {
    mode: "create",
    live: true,
    showMarkdown: false,
    showManaged: false,
  },
};

export { patch, patchAt };

export const setTab = (tab: WorkbenchTab) => patch<WorkbenchViewState>({ tab });
export const chooseItem = (item: WorkbenchItemChoice | null) =>
  patch<WorkbenchViewState>({ item });
export const setRoot = (root: TemplateRoot) =>
  patch<WorkbenchViewState>({ root });
export const setAdvanced = (advanced: boolean) =>
  patch<WorkbenchViewState>({ advanced });
export const chooseAnnotation = (annotationId: string | null) =>
  patch<WorkbenchChoices>({ annotationId });
export const chooseCitation = (
  value: Partial<Pick<WorkbenchChoices, "variant" | "citationExample">>,
) => patch<WorkbenchChoices>(value);
export const choosePartialProfile = (partialProfile: string | null) =>
  patch<WorkbenchChoices>({ partialProfile });
export const setPreview = (settings: Partial<WorkbenchPreviewSettings>) =>
  patchAt<WorkbenchChoices, "preview">("preview", settings);

function sameFields<A extends object>(a: A | null, b: A | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const keys = Object.keys(a) as (keyof A)[];
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => a[key] === b[key])
  );
}

function sameExample(
  a: AnnotationExample | null,
  b: AnnotationExample | null,
): boolean {
  return a === b || (a?.id === b?.id && a?.revision === b?.revision);
}

export type WorkbenchRuntime = Atom.AtomRuntime<never, unknown>;

export interface WorkbenchModelOptions<R extends TemplateRenderResult> {
  readonly controller: WorkbenchDocumentController;
  readonly initial?: Partial<WorkbenchViewState>;
  readonly view?: Atom.Writable<WorkbenchViewState>;
  readonly choices?: Partial<WorkbenchChoices>;
  readonly partialName?: Atom.Atom<string | null>;
  readonly itemData?: (
    input: WorkbenchItemDataInput,
  ) => Atom.Atom<WorkbenchItemData>;
  readonly panels?: WorkbenchPanels;
  readonly viewSize?: Atom.Atom<ViewSize | null>;
  readonly runtime: WorkbenchRuntime;
  readonly host: { readonly matchData: WorkbenchMatchData };
  readonly render: (
    request: RenderRequest,
  ) => Effect.Effect<R, WorkbenchHostError>;
  readonly failed: (result: TemplateRenderResult) => R;
  readonly retain?: (kept: R, result: R) => R;
  readonly reportContext?: () => WorkbenchReportContext;
  readonly debounceMs?: number;
}

export interface WorkbenchMatchVocabulary {
  readonly tags: readonly string[];
  readonly collections: readonly string[];
  readonly libraries: readonly {
    readonly id: string;
    readonly name: string | null;
  }[];
}

export interface CopyJob {
  readonly copy: Effect.Effect<void, WorkbenchClipboardError>;
  readonly copied: () => void;
  readonly failed: () => void;
}

export interface ChooseJob {
  readonly choose: Effect.Effect<string | null>;
  readonly chosen: (id: string) => void;
}

export interface CreatePartialJob {
  readonly create: Effect.Effect<string | null, WorkbenchHostError>;
  readonly created: (insert: string | null) => void;
}

export interface WorkbenchModel<
  R extends TemplateRenderResult = TemplateRenderResult,
> {
  readonly runtime: WorkbenchRuntime;
  readonly view: Atom.Writable<WorkbenchViewState>;
  readonly choices: Atom.Writable<WorkbenchChoices>;
  readonly panels: Atom.Writable<WorkbenchPanels>;
  readonly panelDefaults: WorkbenchPanels;
  readonly sizedFromMenu: Atom.Writable<PanelHandle | null>;
  readonly viewSize: Atom.Atom<ViewSize | null>;
  readonly placement: Atom.Atom<PanelPlacement>;
  readonly fieldsPanel: Atom.Writable<FieldsPanelState>;
  readonly fieldsAction: Atom.Writable<FieldsPlacement, void>;
  readonly fieldsPin: Atom.Writable<FieldsPin, void>;
  readonly fieldsFocus: Atom.Writable<boolean>;
  readonly fieldsStatus: Atom.Writable<FieldsStatus | null>;
  readonly pick: Atom.Writable<WorkbenchItemChoice | null, WorkbenchItemChoice>;
  readonly itemData: Atom.Atom<WorkbenchItemData>;
  readonly examples: Atom.Atom<AnnotationExamples>;
  readonly citation: Atom.Atom<CitationPreviewSelection | null>;
  readonly partial: Atom.Atom<PartialPreviewSelection | null>;
  readonly snapshot: Atom.Atom<ItemSnapshot | null>;
  readonly controller: Atom.Writable<WorkbenchDocumentController>;
  readonly document: WorkbenchDocumentAtoms;
  readonly match: Atom.Atom<MatchTree | undefined>;
  readonly tab: Atom.Atom<WorkbenchTab>;
  readonly item: Atom.Atom<WorkbenchItemChoice | null>;
  readonly root: Atom.Atom<TemplateRoot>;
  readonly advanced: Atom.Atom<boolean>;
  readonly preview: Atom.Atom<WorkbenchPreviewSettings>;
  readonly input: Atom.Atom<RenderSchedulerInput>;
  readonly scheduler: RenderSchedulerAtoms<R>;
  readonly annotationResult: Atom.Atom<R | null>;
  readonly matchRetry: Atom.Writable<number>;
  readonly matchVocabulary: (
    revision: string,
  ) => Atom.Atom<AsyncResult.AsyncResult<WorkbenchMatchVocabulary, unknown>>;
  readonly customFields: (
    revision: string,
  ) => Atom.Atom<AsyncResult.AsyncResult<readonly string[], unknown>>;
  readonly matchTest: (
    key: string,
  ) => Atom.Atom<
    AsyncResult.AsyncResult<WorkbenchMatchResult | "failed", unknown>
  >;
  readonly copy: (surface: string) => Atom.AtomResultFn<CopyJob, void, unknown>;
  readonly choose: (
    surface: string,
  ) => Atom.AtomResultFn<ChooseJob, void, unknown>;
  readonly createPartial: (
    surface: string,
  ) => Atom.AtomResultFn<CreatePartialJob, void, unknown>;
}

export function makeWorkbenchModel<R extends TemplateRenderResult>({
  controller: initialController,
  initial,
  view = Atom.make<WorkbenchViewState>({ ...INITIAL_VIEW, ...initial }),
  choices: initialChoices,
  partialName = Atom.make<string | null>(null),
  itemData: deriveItemData,
  panels: initialPanels = INITIAL_PANELS,
  viewSize = Atom.make<ViewSize | null>(null),
  runtime,
  host,
  render,
  failed,
  retain,
  reportContext,
  debounceMs,
}: WorkbenchModelOptions<R>): WorkbenchModel<R> {
  const controller = Atom.make(initialController);
  const document = workbenchDocumentAtoms(controller);
  const itemData = deriveItemData
    ? deriveItemData({ controller, document })
    : Atom.make<WorkbenchItemData>({ snapshot: null });
  const field = <K extends keyof WorkbenchViewState>(key: K) =>
    Atom.map(view, (state) => state[key]);
  const choices = Atom.make<WorkbenchChoices>({
    ...INITIAL_CHOICES,
    ...initialChoices,
  });
  const pick = <K extends keyof WorkbenchChoices>(key: K) =>
    Atom.map(choices, (state) => state[key]);
  const preview = pick("preview");
  const item = field("item");
  const root = field("root");
  const kind = Atom.map(controller, (current) => current.kind);
  const itemSnapshot = Atom.map(itemData, (data) => data.snapshot);
  const examples = Atom.make((get) =>
    annotationExamples(
      get(item) !== null,
      get(itemSnapshot),
      get(pick("annotationId")),
    ),
  );
  const example = Atom.withEquality(
    Atom.make((get) => get(examples).example),
    sameExample,
  );
  const citation = Atom.withEquality(
    Atom.make((get): CitationPreviewSelection | null => {
      const current = get(kind);
      const set =
        current === "citation" ||
        (current === "partial" && get(root) === "citation");
      if (!set) return null;
      return {
        variant: get(pick("variant")),
        example: get(pick("citationExample")),
      };
    }),
    sameFields,
  );
  const partial = Atom.withEquality(
    Atom.make((get): PartialPreviewSelection | null => {
      const name = get(partialName);
      if (get(kind) !== "partial" || name === null) return null;
      const context = get(root);
      return {
        name,
        context: isPartialContext(context) ? context : "note",
        profile: get(pick("partialProfile")),
      };
    }),
    sameFields,
  );
  const snapshot = Atom.make((get): ItemSnapshot | null => {
    if (get(citation)?.example) return CITATION_EXAMPLE_ITEM;
    const loaded = get(itemSnapshot);
    if (loaded) return loaded;
    const chosen = get(example);
    return get(item) === null && chosen
      ? sampleAnnotationParent(chosen.id)
      : null;
  });
  const input = Atom.make((get): RenderSchedulerInput => {
    const { mode, live } = get(preview);
    return {
      source: get(document.source),
      mode,
      live,
      annotation: get(example),
      citation: get(citation),
      partial: get(partial),
      ...get(itemData),
      snapshot: get(snapshot),
    };
  });
  const panels = Atom.make(initialPanels);
  const fieldsPanel = Atom.make<FieldsPanelState>("closed");
  const fieldsFocus = Atom.make(false);
  const placement = Atom.withEquality(
    Atom.make((get) =>
      placePanels(get(panels), get(viewSize), get(fieldsPanel) === "open"),
    ),
    sameFields,
  );
  const matchRetry = Atom.make(0);
  const scheduler = makeRenderSchedulerAtoms({
    runtime,
    input,
    render,
    failed,
    ...(retain ? { retain } : {}),
    ...(reportContext ? { reportContext } : {}),
    ...(debounceMs === undefined ? {} : { debounceMs }),
  });
  return {
    runtime,
    view,
    choices,
    panels,
    panelDefaults: initialPanels,
    sizedFromMenu: Atom.make<PanelHandle | null>(null),
    viewSize,
    placement,
    fieldsPanel,
    fieldsAction: Atom.writable(
      (get): FieldsPlacement => get(placement).fields,
      (ctx) => {
        const { fields, canPin } = ctx.get(placement);
        if (fields === "docked")
          ctx.set(panels, hideFields(true)(ctx.get(panels)));
        else if (fields === "popover") ctx.set(fieldsPanel, "closed");
        else if (canPin && ctx.get(panels).fields.pinned) {
          ctx.set(fieldsFocus, true);
          ctx.set(panels, hideFields(false)(ctx.get(panels)));
        } else ctx.set(fieldsPanel, "open");
      },
    ),
    fieldsPin: Atom.writable(
      (get): FieldsPin => ({
        pinned: get(panels).fields.pinned,
        canPin: get(placement).canPin,
      }),
      (ctx) => {
        if (!ctx.get(placement).canPin) return;
        if (ctx.get(panels).fields.pinned) {
          ctx.set(panels, pinFields(false)(ctx.get(panels)));
          ctx.set(fieldsPanel, "open");
          return;
        }
        ctx.set(fieldsFocus, true);
        ctx.set(fieldsPanel, "to-editor");
        ctx.set(panels, pinFields(true)(ctx.get(panels)));
      },
    ),
    fieldsFocus,
    fieldsStatus: Atom.make<FieldsStatus | null>(null),
    pick: Atom.writable(
      (get) => get(item),
      (ctx, choice: WorkbenchItemChoice) => {
        ctx.set(view, chooseItem(choice)(ctx.get(view)));
        if (ctx.get(view).root === "citation")
          ctx.set(
            choices,
            chooseCitation({ citationExample: null })(ctx.get(choices)),
          );
      },
    ),
    itemData,
    examples,
    citation,
    partial,
    snapshot,
    controller,
    document,
    match: Atom.map(document.manifest, (manifest) => manifest?.match),
    tab: field("tab"),
    item,
    root,
    advanced: field("advanced"),
    preview,
    input,
    scheduler,
    annotationResult: Atom.make((get) => {
      const { result } = get(scheduler.state);
      const chosen = get(example);
      return chosen !== null &&
        result?.annotationId === chosen.id &&
        result.annotationRevision === chosen.revision
        ? result
        : null;
    }),
    matchRetry,
    matchVocabulary: Atom.family((_revision: string) =>
      runtime.atom((get) => {
        get(matchRetry);
        const { matchData } = host;
        return Effect.all(
          [matchData.tags, matchData.collections, matchData.libraries],
          { concurrency: "unbounded" },
        ).pipe(
          Effect.map(
            ([tags, collections, libraries]): WorkbenchMatchVocabulary => ({
              tags,
              collections: collections.map((path) => path.join("/")),
              libraries: libraries.map(({ id, name }) => ({
                id,
                name: name ?? null,
              })),
            }),
          ),
        );
      }),
    ),
    customFields: Atom.family((_revision: string) =>
      runtime.atom(Effect.suspend(() => host.matchData.customFields)),
    ),
    matchTest: Atom.family((key: string) =>
      runtime.atom((get) => {
        get(matchRetry);
        const [indexedKey, filter] = JSON.parse(key) as [string, string];
        return host.matchData
          .matches(indexedKey, filter)
          .pipe(Effect.catchCause(() => Effect.succeed("failed" as const)));
      }),
    ),
    copy: Atom.family((_surface: string) =>
      runtime.fn((job: CopyJob) =>
        job.copy.pipe(
          Effect.matchEffect({
            onSuccess: () => Effect.sync(job.copied),
            onFailure: () => Effect.sync(job.failed),
          }),
        ),
      ),
    ),
    choose: Atom.family((_surface: string) =>
      runtime.fn((job: ChooseJob) =>
        job.choose.pipe(
          Effect.flatMap((id) =>
            id === null ? Effect.void : Effect.sync(() => job.chosen(id)),
          ),
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterruptsOnly(cause),
            () => Effect.void,
          ),
        ),
      ),
    ),
    createPartial: Atom.family((_surface: string) =>
      runtime.fn((job: CreatePartialJob) =>
        job.create.pipe(
          Effect.flatMap((insert) => Effect.sync(() => job.created(insert))),
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterruptsOnly(cause),
            () => Effect.void,
          ),
        ),
      ),
    ),
  };
}

export function pressFieldsAction(
  registry: AtomRegistry.AtomRegistry,
  model: Pick<WorkbenchModel, "fieldsAction">,
): void {
  registry.set(model.fieldsAction, undefined);
}

export function pressFieldsPin(
  registry: AtomRegistry.AtomRegistry,
  model: Pick<WorkbenchModel, "fieldsPin">,
): void {
  registry.set(model.fieldsPin, undefined);
}

export function holdWorkbenchModel<R extends TemplateRenderResult>(
  registry: AtomRegistry.AtomRegistry,
  model: WorkbenchModel<R>,
): () => void {
  const releases = [
    model.view,
    model.choices,
    model.panels,
    model.sizedFromMenu,
    model.viewSize,
    model.fieldsPanel,
    model.fieldsFocus,
    model.fieldsStatus,
    model.itemData,
    model.controller,
    model.document.source,
    model.document.revision,
    model.scheduler.state,
  ].map((atom) => registry.mount(atom as Atom.Atom<unknown>));
  releases.push(
    registry.subscribe(
      model.placement,
      ({ fields }) => {
        if (fields !== "docked" || registry.get(model.fieldsPanel) !== "open")
          return;
        registry.set(model.fieldsFocus, true);
        registry.set(model.fieldsPanel, "to-editor");
      },
      { immediate: true },
    ),
  );
  return () => {
    for (const release of releases.reverse()) release();
  };
}
