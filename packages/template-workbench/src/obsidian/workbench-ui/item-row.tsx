import type { ReactNode } from "react";

export function ItemRow({
  label,
  children,
}: {
  label?: ReactNode;
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
