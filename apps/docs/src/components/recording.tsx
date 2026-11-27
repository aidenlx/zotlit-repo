import type { ReactNode } from "react";
import { lazy, Suspense } from "react";

import type { RecordingPlayerProps } from "./recording-player.tsx";

const RecordingPlayer = lazy(() => import("./recording-player.tsx"));

export function Recording({
  fallback,
  ...props
}: RecordingPlayerProps & {
  fallback: ReactNode;
}) {
  return (
    <Suspense fallback={fallback}>
      <RecordingPlayer {...props} />
    </Suspense>
  );
}
