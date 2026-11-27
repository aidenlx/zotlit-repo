import type { ReactNode } from "react";
import { createContext, use } from "react";

import type { ReleaseSnapshot } from "@/lib/release-data.ts";
import { useBakedThenFresh } from "@/lib/use-baked-then-fresh.ts";

const SnapshotContext = createContext<ReleaseSnapshot | null>(null);

export function ReleaseSnapshotProvider({
  snapshot,
  children,
}: {
  snapshot: ReleaseSnapshot | null;
  children: ReactNode;
}) {
  const value = useBakedThenFresh("/api/release-snapshot", snapshot);
  return <SnapshotContext value={value}>{children}</SnapshotContext>;
}

export function useReleaseSnapshot(): ReleaseSnapshot | null {
  return use(SnapshotContext);
}
