import type { ExcerptImage } from "#core/excerpt-image/format.ts";
import type { ExcerptRequest } from "#obsidian/excerpt-image/service.ts";

export interface GatedRender {
  readonly request: ExcerptRequest;
  readonly signal: AbortSignal;
  readonly answer: PromiseWithResolvers<ExcerptImage>;
  readonly cancelled: Promise<void>;
  answered: boolean;
  aborted: boolean;
}

export interface RenderGate {
  readonly renders: GatedRender[];
  readonly render: (
    request: ExcerptRequest,
    signal: AbortSignal,
  ) => Promise<ExcerptImage>;
  readonly started: (index: number) => Promise<GatedRender>;
}

export function renderGate(): RenderGate {
  const renders: GatedRender[] = [];
  let arrived = Promise.withResolvers<void>();
  return {
    renders,
    render: (request, signal) => {
      const answer = Promise.withResolvers<ExcerptImage>();
      const cancelled = Promise.withResolvers<void>();
      const render: GatedRender = {
        request,
        signal,
        answer,
        cancelled: cancelled.promise,
        answered: false,
        aborted: false,
      };
      renders.push(render);
      arrived.resolve();
      arrived = Promise.withResolvers<void>();
      signal.addEventListener(
        "abort",
        () => {
          if (render.answered) return;
          render.aborted = true;
          cancelled.resolve();
          answer.reject(signal.reason);
        },
        { once: true },
      );
      return answer.promise;
    },
    started: async (index) => {
      while (renders.length <= index) await arrived.promise;
      return renders[index]!;
    },
  };
}
