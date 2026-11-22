import type { ReactNode } from "react";

export function PaneState({ children }: { children: ReactNode }) {
  return (
    <div
      data-pane-state=""
      className="zt:flex zt:min-h-0 zt:flex-1 zt:flex-col zt:items-center-safe zt:justify-center-safe zt:overflow-y-auto"
    >
      {children}
    </div>
  );
}
