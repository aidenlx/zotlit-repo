import type { TemplateRenderResult } from "#core/render/index.ts";

import type { RenderSchedulerState } from "./scheduler-atoms.ts";

export type PendingNotice = "rendering" | "behind" | "held" | "failed";

export interface PendingView<R extends TemplateRenderResult> {
  readonly shown: R | null;
  readonly retained: boolean;
  readonly notice: PendingNotice | null;
}

export function pendingView<R extends TemplateRenderResult>(
  state: Pick<RenderSchedulerState<R>, "staleReason" | "result" | "retained">,
  produced: (result: R) => boolean,
): PendingView<R> {
  const { staleReason, result, retained } = state;
  const latest = (notice: PendingNotice | null): PendingView<R> => ({
    shown: result,
    retained: false,
    notice,
  });
  switch (staleReason) {
    case null:
      return latest(null);
    case "live":
      return latest(result === null ? "rendering" : null);
    case "demand":
      return latest("behind");
    case "hold":
      return latest(result === null ? null : "held");
    case "invalid": {
      const kept = retained !== null && produced(retained) ? retained : null;
      return { shown: kept, retained: kept !== null, notice: "failed" };
    }
  }
}
