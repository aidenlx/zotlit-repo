import type {
  RenderRequest,
  PartialContext,
  PartialPreviewSelection,
} from "#core/render/index.ts";
import type {
  BUILT_IN_BINDING_DEFAULTS,
  NameFolderPaneProps,
  TemplateRoot,
  WorkbenchChoices,
  WorkbenchInsertTarget,
  WorkbenchItemChoice,
  WorkbenchItemData,
  WorkbenchItemDataInput,
  WorkbenchModel,
  FieldsDock,
  WorkbenchPanel,
  WorkbenchPanels,
  WorkbenchPreviewSettings,
  WorkbenchViewState,
} from "#obsidian/workbench-ui/index.tsx";
import { Cause, Effect, Option, Schema } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type { TFile } from "obsidian";

import { CITATION_VARIANTS } from "@zotlit/db";
import { defaultBindingsAtom } from "@zotlit/notes/obsidian/profile/atoms.ts";
import { templateRevisionAtom } from "@zotlit/notes/obsidian/template/atoms.ts";
import type { ProfileSelector } from "@zotlit/obsidian-kit/profile-stamp.ts";
import type {
  ViewRegistryHandle,
  ViewServices,
} from "@zotlit/obsidian-kit/view-atoms.ts";
import { viewRuntime } from "@zotlit/obsidian-kit/view-atoms.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import {
  zoteroRevisionAtom,
  zoteroStateAtom,
} from "@zotlit/zotero-reads/client/atoms.ts";
import type { ItemSnapshot } from "@zotlit/zotero-reads/contract/snapshot/types.ts";

import { readChosenItem } from "./atoms.ts";

import { CITATION_EXAMPLE_IDS, PARTIAL_CONTEXTS } from "#core/render/index.ts";
import {
  PartialPreviewFailed,
  PreviewItemMissing,
} from "#obsidian/view/errors.ts";
import {
  savedPanelWidth,
  clampPreviewHeight,
  INITIAL_VIEW,
  TABS,
  patchAt,
} from "#obsidian/workbench-ui/index.tsx";

export interface WorkbenchDocumentFacts {
  readonly path: string | null;
  readonly partialName: string | null;
}

export interface OriginatingNote {
  readonly file: TFile;
  readonly indexedKey: string;
  readonly template: TFile | null;
  readonly profile: ProfileSelector;
}

export interface CitationStyles {
  readonly list: NameFolderPaneProps["citationStyles"];
  readonly unavailable: boolean;
}

export type WorkbenchItemRead =
  | {
      readonly status: "empty" | "loading";
      readonly error: null;
      readonly snapshot: null;
    }
  | {
      readonly status: "error";
      readonly error: string;
      readonly snapshot: null;
    }
  | {
      readonly status: "ready";
      readonly error: null;
      readonly snapshot: ItemSnapshot;
    };

const NO_DOCUMENT: WorkbenchDocumentFacts = {
  path: null,
  partialName: null,
};

export type Customization = "idle" | "pending" | "failed";

export const setPresentation = (
  value: Partial<WorkbenchViewState["presentation"]>,
) => patchAt<WorkbenchViewState, "presentation">("presentation", value);

export type PartialRender = (
  request: RenderRequest,
  partial: PartialPreviewSelection,
) => Effect.Effect<string, unknown, ViewServices>;

export function makeTemplateWorkbenchModel() {
  const editor = Atom.make<{
    readonly view: WorkbenchViewState;
    readonly fieldsRoot: TemplateRoot | null;
  }>({ view: INITIAL_VIEW, fieldsRoot: null });
  const view = Atom.writable(
    (get) => get(editor).view,
    (ctx, next: WorkbenchViewState) => {
      const current = ctx.get(editor);
      const moved =
        next.root !== current.view.root ||
        next.item?.id !== current.view.item?.id;
      ctx.set(editor, {
        view: next,
        fieldsRoot: moved ? null : current.fieldsRoot,
      });
    },
  );
  const fieldsRoot = Atom.writable(
    (get) => get(editor).fieldsRoot,
    (ctx, root: TemplateRoot | null) => {
      const current = ctx.get(editor);
      ctx.set(editor, {
        ...current,
        fieldsRoot: root === current.view.root ? null : root,
      });
    },
  );
  const document = Atom.make(NO_DOCUMENT);
  const customization = Atom.make<Customization>("idle");
  const defaultDraft = Atom.make(false);
  const origin = Atom.make<OriginatingNote | null>(null);
  const updating = Atom.make(false);
  const insertRequest = Atom.make<
    (WorkbenchInsertTarget & { readonly focus: boolean }) | null
  >(null);
  const styles = Atom.make<CitationStyles>({ list: [], unavailable: false });
  const bindingDefaults = Atom.map(
    defaultBindingsAtom,
    (bindings): typeof BUILT_IN_BINDING_DEFAULTS => ({
      folder: bindings["note.literature-folder"],
      citationStyle: bindings["citation.references-style"],
      importFolder: bindings["note.import-folder"],
      importColoredHighlights: bindings["note.import-colored-highlights"],
      importAnnotationsAsTemplate:
        bindings["note.import-annotations-as-template"],
    }),
  );
  const unavailable = Atom.make((get): readonly string[] => [
    ...(get(zoteroStateAtom).state === "degraded"
      ? [m.template_workbench_database_unavailable()]
      : []),
    ...(get(styles).unavailable
      ? [m.template_workbench_styles_unavailable()]
      : []),
  ]);
  const refresh = Atom.make(0);
  const item = Atom.map(view, (state) => state.item);
  const itemId = Atom.map(view, (state) => state.item?.id ?? null);
  const chosen = Atom.setIdleTTL(
    viewRuntime.atom((get) => {
      const id = get(itemId);
      get(refresh);
      if (id && !id.startsWith("sample:")) get(zoteroRevisionAtom);
      return id === null ? Effect.succeed(null) : readChosenItem(id);
    }),
    0,
  );
  const read = Atom.make((get): WorkbenchItemRead => {
    const result = get(chosen);
    if (result.waiting || AsyncResult.isInitial(result))
      return { status: "loading", error: null, snapshot: null };
    if (AsyncResult.isFailure(result)) {
      const failure = Cause.squash(result.cause);
      return {
        status: "error",
        error:
          failure instanceof Error
            ? failure.message
            : Cause.pretty(result.cause),
        snapshot: null,
      };
    }
    return result.value === null
      ? { status: "empty", error: null, snapshot: null }
      : { status: "ready", error: null, snapshot: result.value.snapshot };
  });
  const title = Atom.make((get) => {
    const result = get(chosen);
    const named = AsyncResult.isSuccess(result) ? result.value?.title : null;
    return named ?? get(item)?.title ?? null;
  });
  const itemData = ({ document: atoms }: WorkbenchItemDataInput) =>
    Atom.make((get): WorkbenchItemData => ({
      snapshot: get(read).snapshot,
      document: get(document).path ?? undefined,
      hold: !get(atoms.parsed) && "invalid",
    }));
  const chooserCommand = <A>() =>
    Atom.setIdleTTL(
      viewRuntime.fn(
        (chooser: Effect.Effect<A | null, never, ViewServices>) => chooser,
      ),
      0,
    );
  return {
    editor,
    view,
    fieldsRoot,
    document,
    customization,
    defaultDraft,
    origin,
    updating,
    insertRequest,
    styles,
    bindingDefaults,
    unavailable,
    refresh,
    item,
    chosen,
    read,
    title,
    itemData,
    chooseItem: chooserCommand<WorkbenchItemChoice>(),
    chooseAnnotation: chooserCommand<string>(),
  };
}

export function makePartialPreviews({
  model,
  workbench,
  renderPartial,
  source,
}: {
  readonly model: TemplateWorkbenchModel;
  readonly workbench: WorkbenchModel;
  readonly renderPartial: PartialRender;
  readonly source: () => string;
}) {
  return Atom.family((key: string) =>
    viewRuntime.atom((get) => {
      const [name, context] = JSON.parse(key) as [string, PartialContext];
      get(templateRevisionAtom);
      const { variant, citationExample, partialProfile } = get(
        workbench.choices,
      );
      const { example } = get(workbench.examples);
      const data = get(workbench.snapshot);
      return get.result(model.chosen, { suspendOnWaiting: true }).pipe(
        Effect.mapError((cause) => new PartialPreviewFailed({ cause })),
        Effect.flatMap(
          (): Effect.Effect<
            string,
            PartialPreviewFailed | PreviewItemMissing,
            ViewServices
          > => {
            if (!data) return Effect.fail(new PreviewItemMissing());
            return renderPartial(
              {
                source: source(),
                snapshot: data,
                ...(example ? { annotation: example } : {}),
                ...(context === "citation"
                  ? { citation: { variant, example: citationExample } }
                  : {}),
              },
              { name, context, profile: partialProfile },
            ).pipe(
              Effect.mapError((cause) => new PartialPreviewFailed({ cause })),
            );
          },
        ),
      );
    }),
  );
}
export type TemplateWorkbenchModel = ReturnType<
  typeof makeTemplateWorkbenchModel
>;

export function holdTemplateWorkbenchModel(
  registry: ViewRegistryHandle,
  model: TemplateWorkbenchModel,
): () => void {
  const releases = [
    model.editor,
    model.view,
    model.document,
    model.customization,
    model.defaultDraft,
    model.origin,
    model.updating,
    model.insertRequest,
    model.styles,
    model.refresh,
    model.read,
    model.chooseItem,
    model.chooseAnnotation,
  ].map((atom) => registry.mount(atom as Atom.Atom<unknown>));
  return () => {
    for (const release of releases.reverse()) release();
  };
}

const decode = <A>(schema: Schema.Codec<A>, value: unknown): A | null =>
  Option.getOrNull(Schema.decodeUnknownOption(schema)(value));
const record = Schema.Record(Schema.String, Schema.Unknown);
const roots = Schema.Literals(["note", "annotation", "filename", "citation"]);

export interface SavedWorkbench {
  readonly defaultDraft: boolean;
  readonly tab: WorkbenchViewState["tab"] | null;
  readonly root: TemplateRoot | null;
  readonly advanced: boolean | null;
  readonly itemIndexedKey: string | null | undefined;
  readonly annotationId: string | null | undefined;
  readonly partialContext: PartialContext | null;
  readonly partialProfile: string | null;
  readonly panels: {
    readonly fields?: FieldsDock;
    readonly preview?: WorkbenchPanel & { readonly height?: number };
  };
  readonly preview: Partial<WorkbenchPreviewSettings>;
  readonly citation: Partial<
    Pick<WorkbenchChoices, "variant" | "citationExample">
  >;
}

export function savedWorkbench(state: {
  readonly defaultDraft: boolean;
  readonly view: WorkbenchViewState;
  readonly choices: WorkbenchChoices;
  readonly panels: WorkbenchPanels;
  readonly partial: {
    readonly context: PartialContext;
    readonly profile: string | null;
  } | null;
}): Record<string, unknown> {
  const { tab, item, advanced } = state.view;
  return {
    ...(state.defaultDraft ? { defaultDraft: true, file: null } : {}),
    tab,
    itemIndexedKey: item?.id ?? null,
    annotationId: state.choices.annotationId,
    variant: state.choices.variant,
    citationExample: state.choices.citationExample,
    advanced,
    panels: state.panels,
    preview: state.choices.preview,
    ...(state.partial
      ? {
          partialContext: state.partial.context,
          partialProfile: state.partial.profile,
        }
      : {}),
  };
}

export function readSavedWorkbench(input: unknown): SavedWorkbench | null {
  const value = decode(record, input);
  if (!value) return null;
  const nullable = (key: string) =>
    value[key] === null
      ? null
      : (decode(Schema.String, value[key]) ?? undefined);
  return {
    defaultDraft: value.defaultDraft === true,
    tab: decode(Schema.Literals(TABS), value.tab),
    root: decode(roots, value.root),
    advanced: decode(Schema.Boolean, value.advanced),
    itemIndexedKey: nullable("itemIndexedKey"),
    annotationId: nullable("annotationId"),
    partialContext: decode(
      Schema.Literals(PARTIAL_CONTEXTS),
      value.partialContext,
    ),
    partialProfile: decode(Schema.String, value.partialProfile),
    panels: readPanels(value.panels),
    preview: readPreview(value.preview),
    citation: readCitation(value),
  };
}

function readCitation(
  value: Record<string, unknown>,
): Partial<Pick<WorkbenchChoices, "variant" | "citationExample">> {
  const variant = decode(Schema.Literals(CITATION_VARIANTS), value.variant);
  const citationExample =
    value.citationExample === null
      ? null
      : (decode(Schema.Literals(CITATION_EXAMPLE_IDS), value.citationExample) ??
        undefined);
  return {
    ...(variant === null ? {} : { variant }),
    ...(citationExample === undefined ? {} : { citationExample }),
  };
}

function readPreview(input: unknown): Partial<WorkbenchPreviewSettings> {
  const value = decode(record, input) ?? {};
  const mode = decode(Schema.Literals(["create", "update"]), value.mode);
  const flag = (key: "live" | "showMarkdown" | "showManaged") => {
    const flag = decode(Schema.Boolean, value[key]);
    return flag === null ? {} : { [key]: flag };
  };
  return {
    ...(mode === null ? {} : { mode }),
    ...flag("live"),
    ...flag("showMarkdown"),
    ...flag("showManaged"),
  };
}

const savedPreview = Schema.Struct({
  shown: Schema.Boolean,
  width: Schema.Finite,
  height: Schema.optional(Schema.Finite),
});

const savedFields = Schema.Struct({
  pinned: Schema.Boolean,
  hidden: Schema.Boolean,
  width: Schema.Finite,
});

function readPanels(input: unknown): SavedWorkbench["panels"] {
  const value = decode(record, input) ?? {};
  const fields = decode(savedFields, value.fields);
  const preview = decode(savedPreview, value.preview);
  return {
    ...(fields
      ? {
          fields: {
            pinned: fields.pinned,
            hidden: fields.hidden,
            width: savedPanelWidth("fields", fields.width),
          },
        }
      : {}),
    ...(preview
      ? {
          preview: {
            shown: preview.shown,
            width: savedPanelWidth("preview", preview.width),
            ...(preview.height === undefined
              ? {}
              : { height: clampPreviewHeight(preview.height) }),
          },
        }
      : {}),
  };
}

const position = Schema.Struct({ top: Schema.Finite, left: Schema.Finite });
const ephemeral = Schema.Struct({
  context: Schema.String,
  selection: Schema.optional(Schema.Unknown),
  selected: Schema.optional(Schema.Unknown),
  field: Schema.optional(Schema.Unknown),
  scroll: Schema.optional(Schema.Unknown),
});
const range = Schema.Struct({
  from: Schema.Finite,
  to: Schema.Finite,
  anchor: Schema.optional(Schema.Finite),
  head: Schema.optional(Schema.Finite),
});
const insertTarget = Schema.Struct({ slice: Schema.String, range });

export interface EphemeralWorkbench {
  readonly context: string;
  readonly focus: boolean;
  readonly selection: typeof insertTarget.Type | null;
  readonly selected: number | null;
  readonly field: string | null;
  readonly scroll: Record<string, { top: number; left: number }>;
}

export function readEphemeralWorkbench(
  input: unknown,
): EphemeralWorkbench | null {
  const value = decode(record, input);
  const state = decode(ephemeral, value?.zotlitTemplateWorkbench);
  if (!value || !state) return null;
  const selected = decode(Schema.Int, state.selected);
  const scroll: Record<string, { top: number; left: number }> = {};
  for (const [key, saved] of Object.entries(
    decode(record, state.scroll) ?? {},
  )) {
    const at = decode(position, saved);
    if (at)
      scroll[key] = { top: Math.max(0, at.top), left: Math.max(0, at.left) };
  }
  return {
    context: state.context,
    focus: value.focus === true,
    selection: decode(insertTarget, state.selection),
    selected: selected !== null && selected >= 0 ? selected : null,
    field: decode(Schema.String, state.field),
    scroll,
  };
}
