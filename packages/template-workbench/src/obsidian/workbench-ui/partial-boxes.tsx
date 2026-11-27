import type {
  PartialRenderSite,
  WorkbenchDocumentController,
  WorkbenchSliceId,
} from "#core/document/index.ts";
import type { EditorState, Extension } from "@codemirror/state";
import { MapMode, StateEffect } from "@codemirror/state";
import type { DecorationSet, EditorView } from "@codemirror/view";
import { Decoration, ViewPlugin } from "@codemirror/view";
import { useAtomValue } from "@effect/atom-react";
import { Cause } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type * as Atom from "effect/reactivity/Atom";
import type { ReactNode } from "react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { useUniqueId } from "@zotlit/ui";

import { PreviewWidget, boxAt, boxField, boxRanges } from "./editor-boxes.ts";
import { useWorkbenchHost, WorkbenchHostError } from "./host.tsx";
import { editorChip, templateWorkbenchButton, chipIcon } from "./look.ts";

import { documentRevision } from "#core/document/atoms.ts";
import { partialCalls } from "#core/document/index.ts";

const notePanePartialBox = cn(
  editorChip,
  "zt:inline-flex zt:max-w-full zt:items-center zt:gap-1 zt:rounded-md zt:p-0.5 zt:ps-2 zt:align-middle zt:data-[state=missing]:border-(--text-error)",
);
const notePanePartialProblem = cn(
  templateWorkbenchButton,
  "zt:shrink-0 zt:rounded-sm zt:px-1.5 zt:py-0.5 zt:underline",
);
const notePaneAnnotationToggle = chipIcon;
const notePaneAnnotationEdit = chipIcon;
const notePaneAnnotationPreview =
  "zt:mx-2 zt:my-1 zt:cursor-default zt:rounded-md zt:border zt:border-border zt:bg-background zt:p-2 zt:font-sans zt:text-sm zt:whitespace-normal zt:select-text";
const notePanePending = "zt:text-xs zt:text-muted-foreground";

function failureMessage(cause: Cause.Cause<unknown>): string {
  const failure = Cause.squash(cause);
  const error = failure instanceof WorkbenchHostError ? failure.cause : failure;
  return error instanceof Error ? error.message : String(error);
}

export interface PartialPlaceholderHost {
  readonly missing: readonly string[];
  readonly onEdit: (name: string) => void;
  readonly onShowProblem: (name: string) => void;
  readonly preview: (
    name: string,
  ) => Atom.Atom<AsyncResult.AsyncResult<string, unknown>>;
}

export interface PartialBoxes {
  readonly extensions: Extension;
  readonly boxes: ReactNode;
}

export function usePartialBoxes(
  controller: WorkbenchDocumentController,
  slice: WorkbenchSliceId,
  host: PartialPlaceholderHost | undefined,
): PartialBoxes {
  useAtomValue(documentRevision(controller));
  const previewId = useUniqueId();
  const [opened, setOpened] = useState<{
    controller: WorkbenchDocumentController;
    position: number;
  } | null>(null);
  const range = controller.sliceRange(slice);
  const sites = host
    ? partialCalls(controller.state.doc.toString(), range, controller.language)
    : [];
  const boxes = useMemo(
    () => new Map<number, HTMLElement>(),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the deps are the reset key: fresh hosts when the pane changes document or slice, so a box never carries over to another editor's calls
    [controller, slice],
  );
  const previewHost = useMemo(() => document.createElement("div"), []);
  const pane = useRef<EditorView | null>(null);
  const hasHost = host !== undefined;
  const extensions = useMemo(
    () =>
      hasHost ? partialBoxes(boxes, previewHost, { pane, controller }) : [],
    [hasHost, boxes, previewHost, controller],
  );
  const expanded =
    opened?.controller === controller
      ? (sites.find(({ call }) => call.from === opened.position) ?? null)
      : null;
  useEffect(
    () =>
      controller.subscribe(({ transaction, docChanged }) => {
        if (!docChanged) return;
        setOpened((current) => {
          if (current?.controller !== controller) return current;
          const position = transaction.changes.mapPos(
            current.position,
            -1,
            MapMode.TrackDel,
          );
          return position === null ? null : { controller, position };
        });
      }),
    [controller],
  );
  const line =
    expanded === null
      ? null
      : (pane.current?.state.doc.lineAt(expanded.call.to - range.from).to ??
        null);
  useEffect(() => {
    pane.current?.dispatch({ effects: expandPartial.of(line) });
  }, [line, extensions]);
  return {
    extensions,
    boxes: host && (
      <>
        {sites.map((site, index) =>
          createPortal(
            <PartialPlaceholder
              site={site}
              host={host}
              missing={host.missing.includes(site.name)}
              expanded={expanded?.call.from === site.call.from}
              previewId={previewId}
              onToggle={(pressed) =>
                setOpened(
                  pressed ? { controller, position: site.call.from } : null,
                )
              }
            />,
            boxAt(boxes, index),
            String(index),
          ),
        )}
        {expanded !== null &&
          createPortal(
            <PartialPreview
              id={previewId}
              preview={host.preview(expanded.name)}
            />,
            previewHost,
          )}
      </>
    ),
  };
}

function PartialPlaceholder({
  site,
  host,
  missing,
  expanded,
  previewId,
  onToggle,
}: {
  site: PartialRenderSite;
  host: PartialPlaceholderHost;
  missing: boolean;
  expanded: boolean;
  previewId: string;
  onToggle: (pressed: boolean) => void;
}) {
  const previewTooltip = tooltipAttrs(m.workbench_partial_preview());
  const editTooltip = tooltipAttrs(m.workbench_partial_edit());
  return (
    <span
      data-partial-box
      data-part="partial-box"
      data-state={missing ? "missing" : "known"}
      className={notePanePartialBox}
    >
      <span
        data-part="partial-name"
        className="zt:min-w-0 zt:whitespace-normal"
      >
        {site.name}
      </span>
      {site.arguments && (
        <span
          data-part="partial-arguments"
          className="zt:min-w-0 zt:truncate zt:font-normal zt:opacity-75"
        >
          {site.arguments}
        </span>
      )}
      {missing && (
        <button
          type="button"
          aria-label={m.workbench_partial_missing_show({ name: site.name })}
          onClick={() => host.onShowProblem(site.name)}
          data-part="partial-problem"
          className={notePanePartialProblem}
        >
          {m.workbench_partial_missing()}
        </button>
      )}
      <span
        data-part="annotation-actions"
        className="zt:inline-flex zt:shrink-0 zt:items-center"
      >
        {missing ? null : (
          <>
            <button
              type="button"
              data-part="annotation-toggle"
              data-state={expanded ? "active" : "inactive"}
              className={notePaneAnnotationToggle}
              {...previewTooltip}
              aria-pressed={expanded}
              aria-controls={expanded ? previewId : undefined}
              onClick={() => onToggle(!expanded)}
            >
              <Icon name="eye" />
            </button>
            <button
              type="button"
              data-part="annotation-edit"
              className={notePaneAnnotationEdit}
              {...editTooltip}
              onClick={() => host.onEdit(site.name)}
            >
              <Icon name="pencil" />
            </button>
          </>
        )}
      </span>
    </span>
  );
}

function PartialPreview({
  id,
  preview,
}: {
  id: string;
  preview: Atom.Atom<AsyncResult.AsyncResult<string, unknown>>;
}) {
  const { markdown: Markdown } = useWorkbenchHost();
  const result = useAtomValue(preview);
  const state = AsyncResult.isSuccess(result)
    ? { kind: "text" as const, text: result.value }
    : AsyncResult.isFailure(result)
      ? { kind: "error" as const, message: failureMessage(result.cause) }
      : null;
  return (
    <div
      id={id}
      data-partial-preview
      data-part="annotation-preview"
      className={notePaneAnnotationPreview}
    >
      {state?.kind === "error" && (
        <p
          data-part="annotation-problem"
          className="zt:mb-2 zt:border-s-2 zt:border-(--text-error) zt:ps-2 zt:text-xs zt:text-muted-foreground"
        >
          {state.message}
        </p>
      )}
      {state?.kind === "text" && Markdown ? (
        <Suspense
          fallback={
            <p data-part="pending" className={notePanePending}>
              {m.workbench_result_pending()}
            </p>
          }
        >
          <Markdown
            surface="partial"
            markdown={state.text}
            properties={[]}
            showMarkdown={false}
          />
        </Suspense>
      ) : (
        state?.kind !== "error" && (
          <p data-part="pending" className={notePanePending}>
            {m.workbench_result_pending()}
          </p>
        )
      )}
    </div>
  );
}

const expandPartial = StateEffect.define<number | null>();

function partialBoxes(
  boxes: Map<number, HTMLElement>,
  previewHost: HTMLElement,
  {
    pane,
    controller,
  }: {
    readonly pane: { current: EditorView | null };
    readonly controller: WorkbenchDocumentController;
  },
): Extension {
  function build(
    { doc, selection }: EditorState,
    expanded: number | null,
  ): DecorationSet {
    const body = doc.toString();
    const calls = partialCalls(
      body,
      { from: 0, to: body.length },
      controller.language,
    ).map(({ call }) => call);
    const ranges = boxRanges(calls, boxes, selection);
    if (
      expanded !== null &&
      calls.some((call) => doc.lineAt(call.to).to === expanded)
    ) {
      ranges.push(
        Decoration.widget({
          widget: new PreviewWidget(previewHost),
          block: true,
          side: 1,
        }).range(expanded),
      );
    }
    return Decoration.set(ranges, true);
  }

  return [
    boxField(expandPartial, build),
    ViewPlugin.define((view) => {
      pane.current = view;
      return {
        destroy: () => {
          if (pane.current === view) pane.current = null;
        },
      };
    }),
  ];
}
