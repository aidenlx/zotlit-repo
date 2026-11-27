export interface FillScope {
  Symbol: SymbolConstructor;
  RegExp: RegExpConstructor;
  Error: ErrorConstructor;
  Map: MapConstructor;
  Array: ArrayConstructor;
  DisposableStack?: DisposableStackConstructor;
  AsyncDisposableStack?: AsyncDisposableStackConstructor;
  SuppressedError?: SuppressedErrorConstructor;
  Temporal?: typeof Temporal;
}

type Disposer = () => unknown;

const SYNTAX_CHARACTERS = "^$\\.*+?()[]{}|/";
const OTHER_PUNCTUATORS = ",-=<>#&!%:;@~'`\"";
const CONTROL_ESCAPES: Readonly<Record<string, string>> = {
  "\t": "t",
  "\n": "n",
  "\v": "v",
  "\f": "f",
  "\r": "r",
};
const WHITE_SPACE = /^[\p{Zs}\t\v\f\uFEFF\n\r\u2028\u2029]$/u;
const ASCII_ALPHANUMERIC = /^[0-9A-Za-z]$/;

function hexEscape(char: string): string {
  const point = char.codePointAt(0)!;
  if (point <= 0xff) return `\\x${point.toString(16).padStart(2, "0")}`;
  let out = "";
  for (let i = 0; i < char.length; i++) {
    out += `\\u${char.charCodeAt(i).toString(16).padStart(4, "0")}`;
  }
  return out;
}

function escapeRegExp(text: string): string {
  if (typeof text !== "string") {
    throw new TypeError("RegExp.escape requires a string");
  }
  let out = "";
  let first = true;
  for (const char of text) {
    const point = char.codePointAt(0)!;
    if (first && ASCII_ALPHANUMERIC.test(char)) out += hexEscape(char);
    else if (SYNTAX_CHARACTERS.includes(char)) out += `\\${char}`;
    else if (Object.hasOwn(CONTROL_ESCAPES, char)) {
      out += `\\${CONTROL_ESCAPES[char]}`;
    } else if (
      OTHER_PUNCTUATORS.includes(char) ||
      WHITE_SPACE.test(char) ||
      (point >= 0xd800 && point <= 0xdfff)
    ) {
      out += hexEscape(char);
    } else out += char;
    first = false;
  }
  return out;
}

function suppressedErrorClass(): SuppressedErrorConstructor {
  class FilledSuppressedError extends Error {
    readonly error: unknown;
    readonly suppressed: unknown;
    constructor(error: unknown, suppressed: unknown, message?: string) {
      super(message ?? "An error was suppressed during disposal");
      this.name = "SuppressedError";
      this.error = error;
      this.suppressed = suppressed;
    }
  }
  return FilledSuppressedError as unknown as SuppressedErrorConstructor;
}

function disposedError(): ReferenceError {
  return new ReferenceError("The disposable stack is already disposed");
}

function stackClasses(
  dispose: symbol,
  asyncDispose: symbol,
  Suppressed: SuppressedErrorConstructor,
) {
  const disposerOf = (value: object, key: symbol): Disposer => {
    const method = (value as Record<symbol, unknown>)[key];
    if (typeof method !== "function") {
      throw new TypeError("The value is not disposable");
    }
    return () => method.call(value);
  };

  class Stack {
    #disposers: Disposer[] | null = [];

    get disposed(): boolean {
      return this.#disposers === null;
    }

    protected live(): Disposer[] {
      if (!this.#disposers) throw disposedError();
      return this.#disposers;
    }

    protected take(): Disposer[] | null {
      const disposers = this.#disposers;
      this.#disposers = null;
      return disposers;
    }

    protected hold(disposers: Disposer[]): this {
      this.#disposers = disposers;
      return this;
    }

    adopt<T>(value: T, onDispose: (value: T) => unknown): T {
      this.live().push(() => onDispose(value));
      return value;
    }

    defer(onDispose: () => unknown): void {
      this.live().push(onDispose);
    }
  }

  const failure = (previous: { error?: unknown }, error: unknown) => {
    previous.error =
      "error" in previous ? new Suppressed(error, previous.error) : error;
  };

  class FilledDisposableStack extends Stack {
    use<T extends Disposable | null | undefined>(value: T): T {
      const disposers = this.live();
      if (value != null) disposers.push(disposerOf(value, dispose));
      return value;
    }

    move(): FilledDisposableStack {
      const disposers = this.live();
      this.take();
      return new FilledDisposableStack().hold(disposers);
    }

    dispose(): void {
      const disposers = this.take();
      if (!disposers) return;
      const state: { error?: unknown } = {};
      for (let i = disposers.length - 1; i >= 0; i--) {
        try {
          disposers[i]!();
        } catch (error) {
          failure(state, error);
        }
      }
      if ("error" in state) throw state.error;
    }

    [dispose](): void {
      this.dispose();
    }
  }

  class FilledAsyncDisposableStack extends Stack {
    use<T extends AsyncDisposable | Disposable | null | undefined>(
      value: T,
    ): T {
      const disposers = this.live();
      if (value != null) {
        const key =
          typeof (value as unknown as Record<symbol, unknown>)[asyncDispose] ===
          "function"
            ? asyncDispose
            : dispose;
        disposers.push(disposerOf(value, key));
      }
      return value;
    }

    move(): FilledAsyncDisposableStack {
      const disposers = this.live();
      this.take();
      return new FilledAsyncDisposableStack().hold(disposers);
    }

    async disposeAsync(): Promise<void> {
      const disposers = this.take();
      if (!disposers) return;
      const state: { error?: unknown } = {};
      for (let i = disposers.length - 1; i >= 0; i--) {
        try {
          await disposers[i]!();
        } catch (error) {
          failure(state, error);
        }
      }
      if ("error" in state) throw state.error;
    }

    [asyncDispose](): Promise<void> {
      return this.disposeAsync();
    }
  }

  return {
    DisposableStack:
      FilledDisposableStack as unknown as DisposableStackConstructor,
    AsyncDisposableStack:
      FilledAsyncDisposableStack as unknown as AsyncDisposableStackConstructor,
  };
}

function groupBy<K, T>(
  items: Iterable<T>,
  keyOf: (item: T, index: number) => K,
): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  let index = 0;
  for (const item of items) {
    const key = keyOf(item, index++);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

function toSorted<T>(
  this: ArrayLike<T>,
  compare?: (a: T, b: T) => number,
): T[] {
  if (compare !== undefined && typeof compare !== "function") {
    throw new TypeError("The comparison function must be a function");
  }
  return Array.from(this).sort(compare);
}

function toReversed<T>(this: ArrayLike<T>): T[] {
  return Array.from(this).reverse();
}

function isError(value: unknown): value is Error {
  if (typeof value !== "object" || value === null) return false;
  if (typeof DOMException === "function" && value instanceof DOMException)
    return true;
  return (
    !(Symbol.toStringTag in value) &&
    Object.prototype.toString.call(value) === "[object Error]"
  );
}

function fillMethod(owner: object, name: string, value: unknown): void {
  if (typeof Reflect.get(owner, name) === "function") return;
  Object.defineProperty(owner, name, {
    value,
    writable: true,
    configurable: true,
  });
}

function fillSymbol(scope: FillScope, name: "dispose" | "asyncDispose"): void {
  if (typeof scope.Symbol[name] === "symbol") return;
  Object.defineProperty(scope.Symbol, name, {
    value: Symbol.for(`Symbol.${name}`),
  });
}

export interface FillPieces {
  readonly temporal: () => void | Promise<void>;
}

export async function fillMissing(
  scope: FillScope,
  pieces: FillPieces,
): Promise<void> {
  if (typeof Reflect.get(scope.Error, "captureStackTrace") !== "function") {
    Object.defineProperty(scope.Error, "captureStackTrace", {
      value: () => undefined,
      writable: true,
      configurable: true,
    });
  }
  fillSymbol(scope, "dispose");
  fillSymbol(scope, "asyncDispose");
  fillMethod(scope.Map, "groupBy", groupBy);
  fillMethod(scope.Array.prototype, "toSorted", toSorted);
  fillMethod(scope.Array.prototype, "toReversed", toReversed);
  fillMethod(scope.Error, "isError", isError);
  if (typeof scope.RegExp.escape !== "function") {
    Object.defineProperty(scope.RegExp, "escape", {
      value: escapeRegExp,
      writable: true,
      configurable: true,
    });
  }
  scope.SuppressedError ??= suppressedErrorClass();
  if (!scope.DisposableStack || !scope.AsyncDisposableStack) {
    const filled = stackClasses(
      scope.Symbol.dispose,
      scope.Symbol.asyncDispose,
      scope.SuppressedError,
    );
    scope.DisposableStack ??= filled.DisposableStack;
    scope.AsyncDisposableStack ??= filled.AsyncDisposableStack;
  }
  if (typeof scope.Temporal === "undefined") await pieces.temporal();
}
