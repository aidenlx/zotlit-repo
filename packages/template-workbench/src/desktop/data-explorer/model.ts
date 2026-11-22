import type { DisplayNode, TreeState } from "#core/data-tree/index.ts";
import type { AnnotationExample } from "#core/render/index.ts";
import type {
  ExplorerPresentation,
  TemplateRoot,
  WorkbenchItemChoice,
} from "#obsidian/workbench-ui/index.tsx";
import { Cause, Effect, Option, Schema, Stream } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import type * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { createContext, useContext } from "react";

import { DEFAULT_CITATION_VARIANT } from "@zotlit/db";
import { TemplateDataReads } from "@zotlit/notes/desktop/template/data-reads.ts";
import type { TemplateDataLoadResult } from "@zotlit/notes/desktop/template/data.ts";
import { javascriptTemplatesEnabledAtom } from "@zotlit/notes/obsidian/template/atoms.ts";
import { viewRuntime } from "@zotlit/obsidian-kit/view-atoms.ts";
import { withLogCategory } from "@zotlit/plugin-kernel/effect-log.ts";
import { indexedKeyForClipboard } from "@zotlit/plugin-services/obsidian/indexed-key/actions.ts";
import { zoteroRevisionAtom } from "@zotlit/zotero-reads/client/atoms.ts";
import { parseIndexedKey } from "@zotlit/zotero-types/keys";

import {
  initialTreeState,
  setAnchor,
  setFilter as filterTree,
  toggleNode as toggleTreeNode,
} from "#core/data-tree/index.ts";
import { getSampleItem } from "#core/editor/selection-data.ts";
import {
  citationExampleData,
  DEFAULT_CITATION_EXAMPLE,
  restoreTemplateData,
  SAMPLE_ANNOTATIONS,
  sampleItemCitation,
} from "#core/render/index.ts";
import {
  annotationSamples,
  explorerSectionIds,
} from "#obsidian/workbench-ui/index.tsx";

type AnnotationChoices = readonly Pick<AnnotationExample, "id" | "root">[];

export interface ExplorerSession {
  readonly presentation: ExplorerPresentation;
  readonly restore: ExplorerPresentation | null;
  readonly item: WorkbenchItemChoice | null;
  readonly root: TemplateRoot;
  readonly annotationId: string | null;
  readonly navigation: TreeState;
  readonly collapsedSections: ReadonlySet<string>;
  readonly revision: number;
}

export interface ExplorerLoad {
  readonly itemId: string | null;
  readonly annotations: AnnotationChoices | null;
  readonly data: Record<string, unknown> | null;
  readonly status: "no-item" | "loading" | "ready" | "empty" | "error";
  readonly error: string | null;
}

export type ExplorerState = Omit<ExplorerSession, "revision"> &
  Omit<ExplorerLoad, "itemId"> & {
    readonly engines: readonly ("liquid" | "eta")[];
  };

export interface ExplorerModel {
  readonly session: Atom.Writable<ExplorerSession>;
  readonly loaded: Atom.Atom<AsyncResult.AsyncResult<ExplorerLoad, unknown>>;
  readonly state: Atom.Atom<ExplorerState>;
}

export type ExplorerSurface = Pick<ExplorerModel, "session" | "state">;

export const NO_PRESENTATION: ExplorerPresentation = {
  top: 0,
  left: 0,
  field: null,
};

export const EMPTY_EXPLORER_SESSION: ExplorerSession = {
  presentation: NO_PRESENTATION,
  restore: null,
  item: null,
  root: "note",
  annotationId: null,
  navigation: initialTreeState(),
  collapsedSections: new Set(),
  revision: 0,
};

export function makeExplorerModel(): ExplorerModel {
  const session = Atom.make(EMPTY_EXPLORER_SESSION);
  const revision = Atom.map(session, (current) => current.revision);
  const loaded = viewRuntime.atom((get) => {
    get(revision);
    get(zoteroRevisionAtom);
    const current = get.once(session);
    const previous = get
      .self<AsyncResult.AsyncResult<ExplorerLoad>>()
      .pipe(Option.flatMap((result) => AsyncResult.value(result)));
    return loadExplorerData(
      current,
      sameItemAnnotations(previous, current.item),
    );
  });
  const state = Atom.make((get): ExplorerState => {
    const { revision: _, ...current } = get(session);
    const permission = get(javascriptTemplatesEnabledAtom);
    const engines: ExplorerState["engines"] =
      AsyncResult.isSuccess(permission) && permission.value
        ? ["liquid", "eta"]
        : ["liquid"];
    const result = get(loaded);
    if (AsyncResult.isFailure(result)) {
      return {
        ...current,
        engines,
        annotations: null,
        data: null,
        status: "error",
        error: errorMessage(Cause.squash(result.cause)),
      };
    }
    const { itemId: _item, ...load } = Option.getOrElse(
      AsyncResult.value(result),
      (): ExplorerLoad => ({
        itemId: null,
        annotations: null,
        data: null,
        status: "loading",
        error: null,
      }),
    );
    return { ...current, ...load, engines };
  });
  return { session, loaded, state };
}

export function holdExplorerModel(
  registry: AtomRegistry.AtomRegistry,
  model: ExplorerModel,
): () => void {
  const releases = [registry.mount(model.session), registry.mount(model.state)];
  return () => {
    for (const release of releases) release();
  };
}

const sameItemAnnotations = (
  previous: Option.Option<ExplorerLoad>,
  item: WorkbenchItemChoice | null,
): AnnotationChoices | null =>
  Option.match(previous, {
    onNone: () => null,
    onSome: (load) =>
      load.itemId === (item?.id ?? null) ? load.annotations : null,
  });

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export const refresh = (session: ExplorerSession): ExplorerSession => ({
  ...session,
  revision: session.revision + 1,
});

export const setTarget =
  (
    item: WorkbenchItemChoice | null,
    root: TemplateRoot,
    annotationId: string | null = null,
  ) =>
  (session: ExplorerSession): ExplorerSession => {
    const anchor = root === "note" ? null : (annotationId ?? root);
    const newItem = session.item?.id !== item?.id;
    const moved =
      newItem || session.root !== root || session.annotationId !== annotationId;
    return refresh({
      ...session,
      item,
      root,
      annotationId,
      navigation: newItem
        ? initialTreeState(anchor)
        : moved
          ? setAnchor(session.navigation, anchor)
          : session.navigation,
      ...(moved ? { presentation: NO_PRESENTATION, restore: null } : {}),
    });
  };

export const setNavigation =
  (navigation: TreeState) =>
  (session: ExplorerSession): ExplorerSession => ({ ...session, navigation });

export const setFilter =
  (query: string) =>
  (session: ExplorerSession): ExplorerSession => ({
    ...session,
    navigation: filterTree(session.navigation, query),
  });

export const toggleNode =
  (key: string) =>
  (session: ExplorerSession): ExplorerSession => ({
    ...session,
    navigation: toggleTreeNode(session.navigation, key),
  });

export const setCollapsedSections =
  (collapsedSections: ReadonlySet<string>) =>
  (session: ExplorerSession): ExplorerSession => ({
    ...session,
    collapsedSections,
  });

export const allSectionsCollapsed = (
  shown: readonly string[],
  collapsedSections: ReadonlySet<string>,
): boolean =>
  shown.length > 0 && shown.every((id) => collapsedSections.has(id));

export const toggleSections =
  (shown: readonly string[]) =>
  (session: ExplorerSession): ExplorerSession =>
    setCollapsedSections(
      allSectionsCollapsed(shown, session.collapsedSections)
        ? new Set()
        : new Set<string>(explorerSectionIds(session.root)),
    )(session);

export function inNoteAnnotations(
  root: TemplateRoot,
  node: DisplayNode,
  depth: 1 | 2,
): boolean {
  return (
    root === "note" &&
    node.kind === "value" &&
    node.path.length === depth &&
    node.path[0] === "annotations"
  );
}

export function annotationKeyOfNode(
  root: TemplateRoot,
  node: DisplayNode,
): string | null {
  if (
    !inNoteAnnotations(root, node, 2) ||
    typeof node.path[1] !== "number" ||
    node.kind !== "value" ||
    !node.value ||
    typeof node.value !== "object" ||
    !("key" in node.value) ||
    typeof node.value.key !== "string"
  )
    return null;
  return node.value.key;
}

export const setPresentation =
  (presentation: ExplorerPresentation) =>
  (session: ExplorerSession): ExplorerSession => ({ ...session, presentation });

export const clearRestore = (session: ExplorerSession): ExplorerSession => ({
  ...session,
  restore: null,
});

const decode =
  <A>(schema: Schema.Codec<A>) =>
  (value: unknown): A | null =>
    Option.getOrNull(Schema.decodeUnknownOption(schema)(value));

const decodeString = decode(Schema.String);
const decodeRoot = decode(Schema.Literals(["filename", "annotation", "note"]));
const decodeNumber = decode(Schema.Finite);
const strings = (value: unknown): ReadonlySet<string> =>
  new Set(
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [],
  );

export interface SavedExplorer {
  readonly itemIndexedKey: string | null;
  readonly anchorAnnotationKey: string | null;
  readonly root: "filename" | "annotation" | "note";
  readonly collapsedSections: ReadonlySet<string>;
}

export function readSavedExplorer(state: unknown): SavedExplorer | null {
  if (!state || typeof state !== "object") return null;
  const value = state as Record<string, unknown>;
  if (!Object.hasOwn(value, "itemIndexedKey")) return null;
  const anchorAnnotationKey = decodeString(value.anchorAnnotationKey);
  return {
    itemIndexedKey: decodeString(value.itemIndexedKey),
    anchorAnnotationKey,
    root:
      decodeRoot(value.root) ?? (anchorAnnotationKey ? "annotation" : "note"),
    collapsedSections: strings(value.collapsedSections),
  };
}

export interface EphemeralExplorer {
  readonly context: string;
  readonly navigation: TreeState;
  readonly presentation: ExplorerPresentation;
}

export function readEphemeralExplorer(
  input: unknown,
): EphemeralExplorer | null {
  if (!input || typeof input !== "object") return null;
  const payload = (input as Record<string, unknown>).zotlitDataExplorer;
  if (!payload || typeof payload !== "object") return null;
  const state = payload as Record<string, unknown>;
  const context = decodeString(state.context);
  const raw = state.navigation;
  if (context === null || !raw || typeof raw !== "object") return null;
  const navigation = raw as Record<string, unknown>;
  const presentation =
    state.presentation && typeof state.presentation === "object"
      ? (state.presentation as Record<string, unknown>)
      : {};
  return {
    context,
    navigation: {
      anchorKey: decodeString(navigation.anchorKey),
      filterQuery: decodeString(navigation.filterQuery) ?? "",
      expanded: strings(navigation.expanded),
      filterCollapsed: strings(navigation.filterCollapsed),
      noteRootExpanded:
        navigation.noteRootExpanded === null
          ? null
          : strings(navigation.noteRootExpanded),
      preFilterExpanded:
        navigation.preFilterExpanded === null
          ? null
          : strings(navigation.preFilterExpanded),
    },
    presentation: {
      top: Math.max(0, decodeNumber(presentation.top) ?? 0),
      left: Math.max(0, decodeNumber(presentation.left) ?? 0),
      field: decodeString(presentation.field),
    },
  };
}

const annotationChoices = (
  itemId: string,
  data: unknown,
): AnnotationChoices => {
  const values = (data as Record<string, unknown>).annotations;
  return Array.isArray(values)
    ? values.flatMap((value: unknown) => {
        if (
          !value ||
          typeof value !== "object" ||
          !("key" in value) ||
          typeof value.key !== "string"
        )
          return [];
        const id = annotationIndexedKey(itemId, value.key);
        return id ? [{ id, root: value }] : [];
      })
    : [];
};

const loadExplorerData = (
  session: ExplorerSession,
  previousAnnotations: AnnotationChoices | null,
): Stream.Stream<ExplorerLoad, never, TemplateDataReads> =>
  Stream.suspend(() => {
    const { item, root, annotationId } = session;
    const itemId = item?.id ?? null;
    const load = (
      status: ExplorerLoad["status"],
      fields: Partial<Omit<ExplorerLoad, "itemId" | "status">> = {},
    ): ExplorerLoad => ({
      itemId,
      annotations: previousAnnotations,
      data: null,
      error: null,
      status,
      ...fields,
    });
    const sample =
      root === "annotation"
        ? SAMPLE_ANNOTATIONS.find(({ id }) => id === annotationId)
        : undefined;
    const snapshot = item ? getSampleItem(item.id) : null;
    const citation =
      root === "citation"
        ? {
            variant: DEFAULT_CITATION_VARIANT,
            example: item ? null : DEFAULT_CITATION_EXAMPLE,
          }
        : null;
    const variant = citation?.variant ?? DEFAULT_CITATION_VARIANT;
    if (citation?.example) {
      return Stream.make(
        load("ready", {
          data: { ...citationExampleData(citation.example, citation.variant) },
        }),
      );
    }
    const shown = sample
      ? load("ready", {
          data: restoreTemplateData(sample.root, sample.descriptors),
          annotations: snapshot
            ? annotationSamples(snapshot, annotationId).current
            : (previousAnnotations ?? []),
        })
      : null;
    if (shown && (!item || snapshot)) return Stream.make(shown);
    if (!item) return Stream.make(load("no-item"));

    const loadRoot = (
      reads: TemplateDataReads["Service"],
      key: string,
      target: TemplateRoot,
    ): Effect.Effect<TemplateDataLoadResult, unknown> => {
      if (!item.id.startsWith("sample:"))
        return Effect.mapError(
          target === "citation"
            ? reads.readCitation({ key }, variant)
            : reads.read(key, target),
          ({ cause }) => cause,
        );
      if (!snapshot) return Effect.succeed({ kind: "not-found" });
      if (target === "citation")
        return Effect.succeed({
          kind: "data",
          data: sampleItemCitation(snapshot, variant),
        });
      if (target !== "annotation")
        return Effect.succeed({
          kind: "data",
          data: restoreTemplateData(
            snapshot.roots[target],
            snapshot.descriptors[target],
          ),
        });
      const selected = annotationSamples(snapshot, annotationId).current.find(
        ({ id, root }) => id === annotationId || root.indexedKey === key,
      );
      return Effect.succeed(
        selected
          ? {
              kind: "data",
              data: restoreTemplateData(selected.root, selected.descriptors),
            }
          : { kind: annotationId ? "not-found" : "annotation-required" },
      );
    };
    const first = shown ?? load("loading");
    const read = Effect.gen(function* () {
      const reads = yield* TemplateDataReads;
      let annotations = first.annotations;
      const failed = (cause: unknown) =>
        Effect.as(
          Effect.logWarning("Explorer data load failed", {
            cause,
            indexedKey: itemId,
            root,
          }),
          shown
            ? { ...shown, annotations }
            : load("error", { annotations, error: errorMessage(cause) }),
        );
      if (root === "annotation") {
        const note = yield* Effect.result(loadRoot(reads, item.id, "note"));
        if (note._tag === "Failure") return yield* failed(note.failure);
        if (note.success.kind === "data") {
          annotations = snapshot
            ? annotationSamples(snapshot, annotationId).current
            : annotationChoices(item.id, note.success.data);
        }
      }
      if (shown) return { ...shown, annotations };

      const key =
        root === "annotation"
          ? (annotationIndexedKey(item.id, annotationId) ?? item.id)
          : item.id;
      const result = yield* Effect.result(loadRoot(reads, key, root));
      if (result._tag === "Failure") return yield* failed(result.failure);
      if (result.success.kind !== "data") {
        yield* Effect.logDebug("Explorer data unavailable", {
          indexedKey: key,
          root,
          reason: result.success.kind,
        });
        return load(
          result.success.kind === "annotation-required" ? "empty" : "error",
          { annotations },
        );
      }
      const data = result.success.data as Record<string, unknown>;
      return load(Object.keys(data).length ? "ready" : "empty", {
        annotations,
        data,
      });
    }).pipe(withLogCategory("template-data-explorer"));
    return Stream.concat(Stream.make(first), Stream.fromEffect(read));
  });

export function annotationIndexedKey(
  itemId: string,
  selectionId: string | null,
): string | null {
  if (!selectionId || SAMPLE_ANNOTATIONS.some(({ id }) => id === selectionId))
    return null;
  const selection: unknown = selectionId.startsWith("[")
    ? JSON.parse(selectionId)
    : selectionId;
  const key = Array.isArray(selection) ? selection[1] : selection;
  if (typeof key !== "string") return null;
  const annotation = parseIndexedKey(key);
  const item = parseIndexedKey(
    getSampleItem(itemId)?.item.indexedKey ?? itemId,
  );
  return annotation && item
    ? indexedKeyForClipboard({
        key: annotation.key,
        groupID: annotation.groupID ?? item.groupID,
      })
    : null;
}

export const ExplorerModelContext = createContext<ExplorerSurface | null>(null);

export function useExplorerModel(): ExplorerSurface {
  const model = useContext(ExplorerModelContext);
  if (!model) {
    throw new Error(
      "useExplorerModel must be used within ExplorerModelContext",
    );
  }
  return model;
}
