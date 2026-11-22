export class AbortError extends DOMException {
  constructor(message = "Aborted") {
    super(message, "AbortError");
  }

  static test(err: unknown): err is DOMException {
    return err instanceof DOMException && err.name === "AbortError";
  }
}

export function passAborted(error: unknown): void {
  if (!AbortError.test(error)) throw error;
}
