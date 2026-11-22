import type { DisplayNode, TreeState } from "#core/data-tree/index.ts";
import type { WorkbenchDocumentAtoms } from "#core/document/index.ts";
import type { TemplateDataExportTarget } from "#desktop/data-explorer/export-file.ts";
import type {
  ExplorerLoad,
  ExplorerSession,
  ExplorerState,
  ExplorerSurface,
} from "#desktop/data-explorer/model.ts";
import type { ExplorerActions } from "#obsidian/data-explorer/actions.ts";
import type {
  ExplorerPresentation,
  TemplateRoot,
  WorkbenchInsertTarget,
  WorkbenchModel,
} from "#obsidian/workbench-ui/index.tsx";
import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";

import { javascriptTemplatesEnabledAtom } from "@zotlit/notes/obsidian/template/atoms.ts";
import { IconButton } from "@zotlit/obsidian-kit/components/obsidian/icon-button.tsx";
import { tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { runtime } from "@zotlit/plugin-messages/runtime.ts";

import type { TemplateWorkbenchModel, WorkbenchItemRead } from "./model.ts";
import type { TemplateWorkbenchView } from "./view.tsx";

import { initialTreeState, setAnchor } from "#core/data-tree/index.ts";
import {
  citationExampleData,
  restoreTemplateData,
  sampleItemCitation,
} from "#core/render/index.ts";
import { Explorer } from "#desktop/data-explorer/Explorer.tsx";
import { exportTarget } from "#desktop/data-explorer/export-file.ts";
import {
  ExplorerModelContext,
  inNoteAnnotations,
  NO_PRESENTATION,
  toggleSections,
} from "#desktop/data-explorer/model.ts";
import {
  createExplorerActions,
  ExplorerActionsContext,
} from "#obsidian/data-explorer/actions.ts";
import { copyToClipboard } from "#obsidian/editor/host.tsx";
import {
  chooseAnnotation,
  visibleSectionIds,
} from "#obsidian/workbench-ui/index.tsx";

type FieldsData = Omit<ExplorerLoad, "itemId">;

interface FieldsPlace {
  readonly annotationId: string | null;
  readonly navigation: TreeState;
  readonly presentation: ExplorerPresentation;
  readonly restore: ExplorerPresentation | null;
}

export interface FieldsLocal {
  readonly places: {
    readonly item: string | null;
    readonly byRoot: Partial<Record<TemplateRoot, FieldsPlace>>;
  };
  readonly collapsedSections: ReadonlySet<string>;
}

const NO_FIELDS: FieldsLocal = {
  places: { item: null, byRoot: {} },
  collapsedSections: new Set(),
};

export interface FieldsPanelModel extends ExplorerSurface {
  readonly local: Atom.Writable<FieldsLocal>;
  readonly root: Atom.Atom<TemplateRoot>;
  readonly exportTarget: Atom.Atom<TemplateDataExportTarget | null>;
  readonly canInsert: Atom.Atom<boolean>;
}

const statusOf = (
  read: Exclude<WorkbenchItemRead, { status: "ready" }>,
): FieldsData => ({
  annotations: null,
  data: null,
  status: read.status === "empty" ? "no-item" : read.status,
  error: read.error,
});

const dataOf = (data: Record<string, unknown>): FieldsData => ({
  annotations: null,
  data,
  status: Object.keys(data).length ? "ready" : "empty",
  error: null,
});

export function makeFieldsPanelModel(
  model: TemplateWorkbenchModel,
  workbench: Pick<WorkbenchModel, "choices" | "examples">,
  editor: {
    readonly document: WorkbenchDocumentAtoms;
    readonly insertTarget: () => WorkbenchInsertTarget | null;
  },
): FieldsPanelModel {
  const local = Atom.make(NO_FIELDS);
  const root = Atom.make(
    (get): TemplateRoot => get(model.fieldsRoot) ?? get(model.view).root,
  );
  const annotationId = Atom.make((get) =>
    get(root) === "annotation"
      ? (get(workbench.examples).example?.id ?? null)
      : null,
  );
  const session = Atom.writable(
    (get): ExplorerSession => {
      const { places, collapsedSections } = get(local);
      const { item } = get(model.view);
      const shown = get(root);
      const annotation = get(annotationId);
      const anchor = shown === "note" ? null : (annotation ?? shown);
      const saved =
        places.item === (item?.id ?? null) ? places.byRoot[shown] : undefined;
      const place: FieldsPlace = !saved
        ? {
            annotationId: annotation,
            navigation: initialTreeState(anchor),
            presentation: NO_PRESENTATION,
            restore: null,
          }
        : saved.annotationId === annotation
          ? saved
          : {
              annotationId: annotation,
              navigation: setAnchor(saved.navigation, anchor),
              presentation: NO_PRESENTATION,
              restore: null,
            };
      return {
        item: item && { id: item.id, title: get(model.title) },
        root: shown,
        collapsedSections,
        revision: 0,
        ...place,
      };
    },
    (ctx, next: ExplorerSession) => {
      const current = ctx.get(local);
      const item = next.item?.id ?? null;
      ctx.set(local, {
        ...current,
        collapsedSections: next.collapsedSections,
        places: {
          item,
          byRoot: {
            ...(current.places.item === item ? current.places.byRoot : {}),
            [next.root]: {
              annotationId: next.annotationId,
              navigation: next.navigation,
              presentation: next.presentation,
              restore: next.restore,
            },
          },
        },
      });
    },
  );
  const data = Atom.make((get): FieldsData => {
    const target = get(root);
    const read = get(model.read);
    if (target === "citation") {
      const { variant, citationExample } = get(workbench.choices);
      if (citationExample)
        return dataOf({ ...citationExampleData(citationExample, variant) });
      return read.status === "ready"
        ? dataOf({ ...sampleItemCitation(read.snapshot, variant) })
        : statusOf(read);
    }
    if (target === "annotation") {
      const { current, example } = get(workbench.examples);
      const annotations = current.map(({ id, root }) => ({ id, root }));
      if (example)
        return {
          ...dataOf(restoreTemplateData(example.root, example.descriptors)),
          annotations,
        };
      return read.status === "ready"
        ? { annotations, data: null, status: "empty", error: null }
        : statusOf(read);
    }
    return read.status === "ready"
      ? dataOf(
          restoreTemplateData(
            read.snapshot.roots[target],
            read.snapshot.descriptors[target],
          ),
        )
      : statusOf(read);
  });
  const state = Atom.make((get): ExplorerState => {
    const { revision: _, ...current } = get(session);
    const permission = get(javascriptTemplatesEnabledAtom);
    const engines: ExplorerState["engines"] =
      AsyncResult.isSuccess(permission) && permission.value
        ? ["liquid", "eta"]
        : ["liquid"];
    return { ...current, ...get(data), engines };
  });
  const exportable = Atom.make((get) => {
    const { current, example } = get(workbench.examples);
    const indexedKey = example?.root.indexedKey;
    return exportTarget(
      get(model.view).item,
      get(root),
      typeof indexedKey === "string" &&
        current.some((entry) => entry.id === example?.id)
        ? indexedKey
        : null,
    );
  });
  const canInsert = Atom.make((get) => {
    if (get(editor.document.readOnly)) return false;
    get(model.view);
    get(editor.document.slices);
    return editor.insertTarget() !== null;
  });
  return {
    local,
    root,
    session,
    state,
    exportTarget: exportable,
    canInsert,
  };
}

function annotationOfNode(
  view: TemplateWorkbenchView,
  node: DisplayNode,
): string | null {
  const { root } = view.registry.get(view.fields.state);
  if (!inNoteAnnotations(root, node, 1)) return null;
  const { current, example } = view.registry.get(view.workbench.examples);
  return (
    current.find((entry) => entry.id === example?.id)?.id ??
    current[0]?.id ??
    null
  );
}

function moveTo(view: TemplateWorkbenchView, root: TemplateRoot): void {
  view.registry.set(view.model.fieldsRoot, root);
}

function chooseExample(view: TemplateWorkbenchView, id: string): void {
  view.registry.update(view.workbench.choices, chooseAnnotation(id));
  moveTo(view, "annotation");
}

export function makeFieldsActions(
  view: TemplateWorkbenchView,
  exportData: (target: TemplateDataExportTarget) => void,
): ExplorerActions {
  const { registry, fields } = view;
  const target = () => {
    const { status } = registry.get(fields.state);
    return status === "ready" || status === "empty"
      ? registry.get(fields.exportTarget)
      : null;
  };
  return createExplorerActions({
    onChooseItem: () => view.startItemChoice(),
    onBackToNoteRoot: () => moveTo(view, "note"),
    onToggleSections: () => {
      const { root, data } = registry.get(fields.state);
      registry.update(
        fields.session,
        toggleSections(
          visibleSectionIds(data, {
            root,
            locale: runtime.getLocale(),
          }),
        ),
      );
    },
    onRefresh: () => view.refresh(),
    copyTarget: () => {
      const shown = target();
      return shown
        ? {
            indexedKey: shown.indexedKey,
            kind: shown.root === "annotation" ? "annotation" : "item",
          }
        : null;
    },
    canExport: () => target() !== null,
    onExport: () => {
      const shown = target();
      if (shown) exportData(shown);
    },
    exportLabel: () =>
      registry.get(fields.root) === "annotation" && target()?.root === "note"
        ? m.template_data_explorer_export_selected_paper()
        : m.template_data_explorer_menu_export_json(),
  });
}

export function FieldsMoreOptions({ view }: { view: TemplateWorkbenchView }) {
  return (
    <IconButton
      icon="more-horizontal"
      aria-haspopup="menu"
      className="zt:shrink-0"
      onClick={(event) => view.showFieldsMenu(event.currentTarget)}
      {...tooltipAttrs(m.workbench_pane_more_options())}
    />
  );
}

export function FieldsPanel({
  view,
  actions,
}: {
  view: TemplateWorkbenchView;
  actions: ExplorerActions;
}) {
  const canInsert = useAtomValue(view.fields.canInsert);
  return (
    <ExplorerModelContext value={view.fields}>
      <ExplorerActionsContext value={actions}>
        <Explorer
          placement="panel"
          onSelectAnnotation={(id) => chooseExample(view, id)}
          onChooseAnnotation={() => view.startAnnotationChoice()}
          onSelectItem={(item) => view.setItem(item)}
          onSearchItem={() => view.startItemChoice()}
          explorer={{
            copy: copyToClipboard,
            disabled: !canInsert,
            insertion: () => view.fieldInsertion(),
            onInsert: (text, options) => view.insertField(text, options),
            canExploreAnnotation: (node) =>
              annotationOfNode(view, node) !== null,
            onExploreAnnotation: (node) => {
              const id = annotationOfNode(view, node);
              if (id) chooseExample(view, id);
            },
          }}
        />
      </ExplorerActionsContext>
    </ExplorerModelContext>
  );
}
