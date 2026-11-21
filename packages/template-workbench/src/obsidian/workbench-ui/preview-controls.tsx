// The Refresh setting drives scheduling; the host starts an on-demand render.

import { cn } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { PreviewSettings } from "./model.ts";
import { WorkbenchSelect, WorkbenchOption } from "./select.tsx";

const previewControlsControls = cn(
  "zt:flex zt:items-center zt:gap-2",
  "zt:flex-wrap zt:text-sm",
);
const previewControlsLabel = cn(
  "zt:flex zt:items-center zt:gap-2",
  "zt:flex-wrap",
);
const previewControlsLabelText = "zt:text-muted-foreground";

export function PreviewControls({
  preview,
  onChange,
  busy,
  disabled = false,
  onRun,
}: {
  preview: PreviewSettings;
  onChange: (value: Partial<PreviewSettings>) => void;
  busy: boolean;
  disabled?: boolean;
  onRun: () => void;
}) {
  return (
    <div data-part="controls" className={previewControlsControls}>
      <label data-part="label" className={previewControlsLabel}>
        <span data-part="label-text" className={previewControlsLabelText}>
          {m.workbench_preview_mode()}
        </span>
        <WorkbenchSelect
          value={preview.mode}
          onInput={(event) =>
            onChange({
              mode:
                event.currentTarget.value === "update" ? "update" : "create",
            })
          }
        >
          <WorkbenchOption value="create">
            {m.workbench_preview_create()}
          </WorkbenchOption>
          <WorkbenchOption value="update">
            {m.workbench_preview_update()}
          </WorkbenchOption>
        </WorkbenchSelect>
      </label>
      <label data-part="label" className={previewControlsLabel}>
        <span data-part="label-text" className={previewControlsLabelText}>
          {m.workbench_preview_refresh()}
        </span>
        <WorkbenchSelect
          value={preview.live ? "live" : "demand"}
          onInput={(event) => {
            const live = event.currentTarget.value === "live";
            onChange({ live });
          }}
        >
          <WorkbenchOption value="live">
            {m.workbench_preview_live()}
          </WorkbenchOption>
          <WorkbenchOption value="demand">
            {m.workbench_preview_on_demand()}
          </WorkbenchOption>
        </WorkbenchSelect>
      </label>
      {!preview.live && (
        <span
          role="status"
          data-part="paused"
          className="zt:text-sm zt:text-muted-foreground"
        >
          {m.workbench_preview_paused()}
        </span>
      )}
      {!preview.live && (
        <button
          data-part="run"
          type="button"
          disabled={busy || disabled}
          onClick={onRun}
        >
          {m.workbench_preview_run()}
        </button>
      )}
    </div>
  );
}
