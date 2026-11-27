import { Effect } from "effect";

import { AbortError } from "@zotlit/plugin-kernel/abort-error.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";

import type { NoticeMessage } from "./notice.ts";
import { LazyNotice, loadingNotice, noticeText } from "./notice.ts";

interface ToastPromiseOptions<T> {
  loading?: NoticeMessage;
  success?: ((data: T) => NoticeMessage | undefined) | NoticeMessage;
  error?:
    | ((errorMessage: string, error: unknown) => NoticeMessage | undefined)
    | NoticeMessage;
  loadingDelay?: number;
  successDuration?: number;
  errorDuration?: number;
  throwAborted?: boolean;
}

interface RethrowWithNoticeOptions {
  error:
    | ((errorMessage: string, error: unknown) => NoticeMessage | undefined)
    | NoticeMessage;
  errorDuration?: number;
  throwAborted?: boolean;
}

const LOADING_SYMBOL = Symbol("loading");

async function promiseToast<T>(
  promise: Promise<T>,
  options: ToastPromiseOptions<T>,
): Promise<void> {
  const {
    loading,
    loadingDelay = 200,
    successDuration = 2000,
    errorDuration = 4000,
    throwAborted = false,
  } = options;

  using notice = new LazyNotice();

  if (loading) {
    try {
      const loadingTimeout =
        loadingDelay > 0 ? sleep(loadingDelay) : Promise.resolve();

      const raceResult = await Promise.race([
        promise,
        loadingTimeout.then(() => LOADING_SYMBOL),
      ]);

      if (raceResult === LOADING_SYMBOL) {
        notice.setMessage(loadingNotice(loading));
      }
    } catch {
      // handled below
    }
  }

  try {
    const result = await promise;

    const successMessage =
      typeof options.success === "function"
        ? options.success(result)
        : options.success;
    if (!successMessage) return;
    notice.setMessage(successMessage);
    await sleep(successDuration);
  } catch (error) {
    if (!throwAborted && AbortError.test(error)) {
      return;
    }
    if (options.error === undefined) return;
    const errorMessage =
      typeof options.error === "function"
        ? options.error(formatErrorMessage(error), error)
        : options.error;
    const errorMessageText =
      errorMessage === undefined ? undefined : noticeText(errorMessage);
    Effect.runSyncWith(logServices)(
      Effect.logError("Toast reported error: {message}").pipe(
        Effect.annotateLogs({
          message: errorMessageText,
          error,
        }),
        withLogCategory("toast"),
      ),
    );
    if (!errorMessage) return;
    notice.setMessage(errorMessage);
    await sleep(errorDuration);
  }
}

export async function promise<T>(
  promise: Promise<T>,
  options: ToastPromiseOptions<T> & {
    swallowError: false;
  },
): Promise<T>;
export async function promise<T>(
  promise: Promise<T>,
  options: ToastPromiseOptions<T> & {
    swallowError?: true;
  },
): Promise<void>;
export async function promise<T>(
  promise: Promise<T>,
  {
    swallowError = true,
    ...options
  }: ToastPromiseOptions<T> & { swallowError?: boolean },
): Promise<T | undefined> {
  try {
    promiseToast(promise, options).catch(() => void 0);
    const result = await promise;
    if (!swallowError) return result;
  } catch (err) {
    if (swallowError) {
      return;
    }
    throw err;
  }
}

export function rethrowWithNotice(
  error: unknown,
  options: RethrowWithNoticeOptions,
): never {
  promiseToast(
    Promise.reject(
      error instanceof Error
        ? error
        : new Error(String(error), { cause: error }),
    ),
    options,
  ).catch(() => void 0);
  throw error;
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}
