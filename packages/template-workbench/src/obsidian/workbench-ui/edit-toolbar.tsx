// The row above the editor: Basic against Advanced, and undo and redo over the
// document's one history. A host's own controls for the row come as children.
// Inert outside an editor.

import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { ReactNode } from "react";

import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { useOptionalEditor, useWorkbenchModel } from "./editor.tsx";
import { useContainerName } from "./host.tsx";
import { templateWorkbenchButton } from "./look.ts";
import { setAdvanced as advancedTransition } from "./model.ts";

const editToolbarMode = templateWorkbenchButton;
const editToolbarEditToolbar = cn("zt:flex zt:items-center zt:gap-2", "zt:p-2");

export function EditToolbar({
  children,
  leading,
  layout = "grouped",
  onModeChange,
}: {
  children?: ReactNode;
  /** The host's Item chooser, before the shared controls. */
  leading?: ReactNode;
  /** Linear headers put history before a single Advanced toggle. */
  layout?: "grouped" | "linear";
  onModeChange?: (advanced: boolean) => void;
}) {
  const editor = useOptionalEditor();
  const model = useWorkbenchModel();
  const current = useAtomValue(model.controller);
  const controller = editor === null ? null : current;
  useAtomValue(model.document.revision);
  const advanced = useAtomValue(model.advanced);
  const setView = useAtomSet(model.view);
  const setAdvanced = (next: boolean) => setView(advancedTransition(next));
  const modeName = useContainerName(m.workbench_editing_mode());
  const undoTooltip = tooltipAttrs(m.workbench_undo());
  const redoTooltip = tooltipAttrs(m.workbench_redo());
  const inert = controller === null;

  const mode = (
    source: boolean,
    label: string,
    glyph: "sliders-horizontal" | "code",
  ) => (
    <button
      type="button"
      aria-pressed={advanced === source}
      disabled={inert}
      onClick={() => {
        const next = layout === "linear" ? !advanced : source;
        setAdvanced(next);
        onModeChange?.(next);
      }}
      data-part="mode"
      data-state={advanced === source ? "on" : "off"}
      className={editToolbarMode}
    >
      <Icon name={glyph} />
      {label}
    </button>
  );

  const history = (
    <>
      <button
        type="button"
        disabled={!controller?.canUndo}
        onClick={() => controller?.undo()}
        {...undoTooltip}
        data-part="undo"
        className="clickable-icon"
      >
        <Icon name="undo-2" />
      </button>
      <button
        type="button"
        disabled={!controller?.canRedo}
        onClick={() => controller?.redo()}
        {...redoTooltip}
        data-part="redo"
        className="clickable-icon"
      >
        <Icon name="redo-2" />
      </button>
    </>
  );
  return (
    <div data-part="edit-toolbar" className={editToolbarEditToolbar}>
      {leading}
      {layout === "linear" ? (
        <>
          {history}
          {mode(true, m.workbench_advanced(), "code")}
          {children}
        </>
      ) : (
        <>
          <div
            role="group"
            {...modeName.attrs}
            data-part="mode-group"
            className="zt:flex zt:items-center zt:gap-2"
          >
            {modeName.hiddenName}
            {mode(false, m.workbench_basic(), "sliders-horizontal")}
            {mode(true, m.workbench_advanced(), "code")}
          </div>
          <div
            data-part="toolbar-actions"
            className="zt:flex zt:items-center zt:gap-2"
          >
            {history}
            {children}
          </div>
        </>
      )}
    </div>
  );
}
