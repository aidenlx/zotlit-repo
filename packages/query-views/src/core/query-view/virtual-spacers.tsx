import type { CSSProperties } from "react";

const gap = (height: number) =>
  ({ "--zt-virtual-gap": `${height}px` }) as CSSProperties;

export const placeholderRow = (height: number) =>
  ({ "--zt-virtual-row": `${height}px` }) as CSSProperties;

export const LIST_GHOST =
  "zt:bg-[image:linear-gradient(to_bottom,transparent_calc(50%-0.3em),var(--background-modifier-hover)_0_calc(50%+0.3em),transparent_0)] zt:bg-size-[min(60%,24rem)_var(--zt-virtual-row,2.5em)] zt:bg-position-[calc(var(--list-indent)+var(--size-4-3))_0] zt:bg-repeat-y";

export const TABLE_GHOST =
  "zt:bg-[image:linear-gradient(to_bottom,transparent_calc(50%-0.3em),var(--background-modifier-hover)_0_calc(50%+0.3em),transparent_0),linear-gradient(to_bottom,transparent_calc(100%-var(--border-width)),var(--table-border-color)_0)] zt:bg-size-[min(40%,12rem)_var(--zt-virtual-row,2.5em),100%_var(--zt-virtual-row,2.5em)] zt:bg-position-[calc(2*var(--size-4-1)+var(--icon-xs)+2*var(--size-2-3))_var(--zt-table-header-height,0px),0_var(--zt-table-header-height,0px)] zt:bg-repeat-y";

export function ListSpacer({ height }: { height: number }) {
  return (
    <li
      aria-hidden="true"
      className="zt:h-(--zt-virtual-gap) zt:list-none"
      style={gap(height)}
      data-query-spacer=""
    />
  );
}

export function TableSpacer({
  height,
  columns,
}: {
  height: number;
  columns: number;
}) {
  return (
    <tbody aria-hidden="true" data-query-spacer="">
      <tr>
        <td
          colSpan={columns + 2}
          className="zt:h-(--zt-virtual-gap) zt:p-0"
          style={gap(height)}
        />
      </tr>
    </tbody>
  );
}
