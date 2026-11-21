// The one row that names the item the whole Workbench view renders against,
// with the control that changes it. The Fields Panel, the editor and the
// Preview Panel read the same item, so the view names it once: the host draws
// this row above the panels, across all of them, at every placement. The
// panels' own heads hold only what is theirs.
import type { ReactNode } from "react";

export function ItemRow({
  label,
  children,
}: {
  /** The item's name, such as "Example: Thinking, fast and slow"; none before one is chosen. */
  label?: ReactNode;
  /** The host's control that chooses another item. */
  children: ReactNode;
}) {
  return (
    <div
      data-workbench-item-row=""
      data-part="row"
      className="zt:flex zt:min-w-0 zt:shrink-0 zt:items-center zt:gap-x-2 zt:border-b zt:border-border zt:px-3 zt:py-1"
    >
      {label ? (
        <p
          data-part="label"
          className="zt:min-w-0 zt:truncate zt:text-xs zt:leading-normal zt:text-muted-foreground"
        >
          {label}
        </p>
      ) : null}
      {children}
    </div>
  );
}
