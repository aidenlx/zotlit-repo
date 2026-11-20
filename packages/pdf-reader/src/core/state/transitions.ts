import type {
  FindState,
  ReaderIntent,
  ReaderState,
  ReaderZoom,
} from "#/core/types.ts";

function patch<T extends object>(value: T, changes: Partial<T>): T {
  for (const key of Object.keys(changes) as (keyof T)[]) {
    if (!Object.is(value[key], changes[key])) return { ...value, ...changes };
  }
  return value;
}

export function loading(state: ReaderState): ReaderState {
  return patch(state, {
    status: "loading",
    failure: null,
    passwordRetry: false,
  });
}

export function askPassword(state: ReaderState, retry: boolean): ReaderState {
  return patch(state, {
    status: "password",
    failure: null,
    passwordRetry: retry,
  });
}

export function fail(
  state: ReaderState,
  failure: NonNullable<ReaderState["failure"]>,
): ReaderState {
  const same =
    state.failure?.reason === failure.reason &&
    state.failure.message === failure.message;
  return patch(state, {
    status: "failed",
    failure: same ? state.failure : failure,
    passwordRetry: false,
  });
}

export function ready(state: ReaderState): ReaderState {
  return patch(state, { status: "ready", failure: null });
}

export function opened(
  state: ReaderState,
  document: {
    readonly pageCount: number;
    readonly labels: readonly string[] | null;
  },
): ReaderState {
  const pageIndex = Math.min(state.pageIndex, document.pageCount - 1);
  return patch(state, {
    pageCount: document.pageCount,
    pageIndex,
    hasPageLabels: document.labels !== null,
    pageLabel: document.labels?.[pageIndex] ?? null,
  });
}

export function turned(
  state: ReaderState,
  pageIndex: number,
  labels: readonly string[] | null,
): ReaderState {
  return patch(state, { pageIndex, pageLabel: labels?.[pageIndex] ?? null });
}

export function scaled(
  state: ReaderState,
  scale: number,
  zoom: ReaderZoom,
): ReaderState {
  return patch(state, { scale, zoom });
}

export function intended(
  state: ReaderState,
  intent: ReaderIntent,
): ReaderState {
  return patch(state, {
    zoom: intent.zoom ?? state.zoom,
    spread: intent.spread ?? state.spread,
    themed: intent.themed ?? state.themed,
    showPageLabels: intent.showPageLabels ?? state.showPageLabels,
    sidebar: intent.sidebar
      ? patch(state.sidebar, intent.sidebar)
      : state.sidebar,
    find: intent.find ? patch<FindState>(state.find, intent.find) : state.find,
  });
}
