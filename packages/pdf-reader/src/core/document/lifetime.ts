import type {
  HeadlessDocument,
  ManagedDocument,
  ReaderDocument,
} from "#/core/document/document.ts";
import type { DocumentSource, PdfEngine } from "#/core/engine/engine.ts";
import type { Emitter } from "#/core/extensions/events.ts";
import type { ReaderHost } from "#/core/host.ts";
import type { ReaderAtoms } from "#/core/state/atoms.ts";
import type {
  NavigateOutcome,
  NavigationTarget,
  ReaderPage,
  ReaderState,
} from "#/core/types.ts";
import type { PageRegistry } from "#/core/viewer/pages.ts";
import type { ReaderViewer } from "#/core/viewer/viewer.ts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";

import { holdDocument } from "#/core/document/document.ts";
import { PdfLoadError } from "#/core/engine/error.ts";
import { readerServices } from "#/core/internal/scheduler.ts";
import { askPassword, fail, loading, ready } from "#/core/state/transitions.ts";
import { SelectionLinks } from "#/core/subpath/legacy-selection.ts";
import { isPainted } from "#/core/viewer/viewer.ts";

export interface Held {
  readonly headless: HeadlessDocument;
  readonly lease: ManagedDocument;
  readonly links: SelectionLinks;
  labels: readonly string[] | null;
}

export interface Queued {
  readonly target: NavigationTarget;
  readonly resolve: (outcome: NavigateOutcome) => void;
}

type Failure = NonNullable<ReaderState["failure"]>;

type End = "reloaded" | "disposed" | Failure;

interface LifetimeView<K> {
  theme(): void;
  show(held: Held, kept: K | null): Promise<void>;
  resumed(): void;
  closing(): void;
  quiet(): boolean;
}

interface LifetimeOptions<K> {
  readonly engine: PdfEngine;
  readonly source: DocumentSource;
  readonly host: ReaderHost;
  readonly root: HTMLElement;
  readonly deferUntilVisible: boolean;
  readonly atoms: ReaderAtoms;
  readonly emitter: Emitter;
  readonly viewer: ReaderViewer;
  readonly pages: PageRegistry;
  readonly view: LifetimeView<K>;
}

function failureOf(error: PdfLoadError): Failure {
  switch (error.reason) {
    case "unreadable":
    case "invalid":
    case "engine-disposed":
      return { reason: error.reason, message: error.message };
    default:
      return { reason: "invalid", message: error.message };
  }
}

function untilVisible(element: HTMLElement): Effect.Effect<void> {
  return Effect.callback<void>((resume) => {
    const View = element.ownerDocument.defaultView?.IntersectionObserver;
    if (!View) {
      resume(Effect.void);
      return;
    }
    const observer = new View((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        resume(Effect.void);
      }
    });
    observer.observe(element);
    return Effect.sync(() => observer.disconnect());
  });
}

export class DocumentLifetime<K> {
  readonly #options: LifetimeOptions<K>;
  readonly #scope = Scope.makeUnsafe();
  readonly #readyWaiters = new Set<(document: ReaderDocument | null) => void>();
  readonly #renderWaiters = new Map<
    number,
    Set<(page: ReaderPage | null) => void>
  >();
  readonly #settleChecks = new Set<() => void>();
  #session: Fiber.Fiber<void> | null = null;
  #current: Held | null = null;
  #password: string | undefined = undefined;
  #queued: Queued | null = null;
  #hadReady = false;
  #disposed = false;

  constructor(options: LifetimeOptions<K>) {
    this.#options = options;
  }

  get current(): Held | null {
    return this.#current;
  }

  get hadReady(): boolean {
    return this.#hadReady;
  }

  open(): void {
    this.#start(this.#open(null, { deferred: this.#deferred() }));
  }

  reload(kept: K | null): void {
    if (this.#disposed) return;
    this.#session?.interruptUnsafe();
    this.#session = null;
    this.#end("reloaded");
    this.#start(this.#open(kept, { deferred: this.#deferred() }));
  }

  submitPassword(password: string): void {
    if (this.#disposed || this.#status() !== "password") return;
    this.#password = password;
    this.#options.atoms.update(loading);
    this.#start(this.#open(null, { deferred: false }));
  }

  cancelPassword(): void {
    if (this.#disposed || this.#status() !== "password") return;
    this.#password = undefined;
    this.#end({
      reason: "password-cancelled",
      message: "The password prompt was cancelled",
    });
  }

  inRange(pageIndex: number): boolean {
    return (
      Number.isInteger(pageIndex) &&
      pageIndex >= 0 &&
      pageIndex < (this.#current?.headless.proxy.numPages ?? 0)
    );
  }

  queue(target: NavigationTarget): Promise<NavigateOutcome> {
    const { promise, resolve } = Promise.withResolvers<NavigateOutcome>();
    this.#queued?.resolve("superseded");
    this.#queued = { target, resolve };
    return promise;
  }

  takeQueued(): Queued | null {
    const queued = this.#queued;
    this.#queued = null;
    return queued;
  }

  whenReady(): Promise<ReaderDocument | null> {
    if (this.#disposed) return Promise.resolve(null);
    const status = this.#status();
    if (status === "ready" && this.#current) {
      return Promise.resolve(this.#current.lease.document);
    }
    if (status === "failed") return Promise.resolve(null);
    const { promise, resolve } = Promise.withResolvers<ReaderDocument | null>();
    this.#readyWaiters.add(resolve);
    return promise;
  }

  whenRendered(pageIndex: number): Promise<ReaderPage | null> {
    if (this.#disposed || this.#status() === "failed") {
      return Promise.resolve(null);
    }
    if (this.#current && !this.inRange(pageIndex)) {
      return Promise.resolve(null);
    }
    const { pages } = this.#options;
    const view = pages.view(pageIndex);
    if (view && isPainted(view)) return Promise.resolve(pages.page(pageIndex));
    const { promise, resolve } = Promise.withResolvers<ReaderPage | null>();
    let waiters = this.#renderWaiters.get(pageIndex);
    if (!waiters) {
      waiters = new Set();
      this.#renderWaiters.set(pageIndex, waiters);
    }
    waiters.add(resolve);
    return promise;
  }

  rendered(page: ReaderPage): void {
    const waiters = this.#renderWaiters.get(page.pageIndex);
    if (waiters) {
      this.#renderWaiters.delete(page.pageIndex);
      for (const answer of waiters) answer(page);
    }
    this.check();
  }

  settled(): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const check = () => {
      if (this.#disposed) {
        this.#settleChecks.delete(check);
        reject(new DOMException("The reader was disposed", "AbortError"));
      } else if (this.#settledNow()) {
        this.#settleChecks.delete(check);
        resolve();
      }
    };
    this.#settleChecks.add(check);
    check();
    return promise;
  }

  check(): void {
    for (const check of this.#settleChecks) check();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#session?.interruptUnsafe();
    this.#session = null;
    this.#end("disposed");
    Effect.runForkWith(readerServices)(Scope.close(this.#scope, Exit.void));
  }

  #status(): ReaderState["status"] {
    return this.#options.atoms.state.get().status;
  }

  #deferred(): boolean {
    return this.#options.deferUntilVisible && !this.#hadReady;
  }

  #settledNow(): boolean {
    const status = this.#status();
    if (status === "failed" || status === "password") return true;
    if (status !== "ready" || this.#queued) return false;
    return this.#options.view.quiet();
  }

  #start(effect: Effect.Effect<void>): void {
    this.#session?.interruptUnsafe();
    const bounded = effect.pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterruptsOnly(cause),
        (cause) =>
          Effect.sync(() => {
            const error = Cause.squash(cause);
            this.#options.host.report(error, { phase: "load" });
            this.#failed(new PdfLoadError("invalid", { cause: error }));
          }),
      ),
    );
    this.#session = Effect.runSyncWith(readerServices)(
      Effect.forkIn(bounded, this.#scope),
    );
  }

  #open(
    kept: K | null,
    options: { readonly deferred: boolean },
  ): Effect.Effect<void> {
    const { engine, source, host, root, viewer, view } = this.#options;
    const password = this.#password;
    const load = Effect.tryPromise({
      try: (signal) =>
        engine.load(source, {
          signal,
          ownerDocument: root.ownerDocument,
          ...(password === undefined ? {} : { password }),
        }),
      catch: (cause) =>
        cause instanceof PdfLoadError
          ? cause
          : new PdfLoadError("invalid", { cause }),
    });
    const adopt = Effect.uninterruptibleMask((restore) =>
      restore(load).pipe(
        Effect.map((headless): Held => {
          const lease = holdDocument(headless);
          const held: Held = {
            headless,
            lease,
            links: new SelectionLinks(host, lease.document, password),
            labels: null,
          };
          this.#current = held;
          this.#answerOutOfRange();
          return held;
        }),
      ),
    );
    return Effect.gen({ self: this }, function* () {
      if (options.deferred) yield* untilVisible(root);
      const held = yield* adopt.pipe(
        Effect.catch((error: PdfLoadError) =>
          Effect.sync(() => {
            this.#failed(error);
            return null;
          }),
        ),
      );
      if (!held) return;
      held.labels = yield* Effect.tryPromise(() =>
        held.headless.proxy.getPageLabels(),
      ).pipe(Effect.orElseSucceed(() => null));
      const viewShown = yield* Effect.callback<boolean, PdfLoadError>(
        (resume) => {
          const shown = new AbortController();
          viewer.eventBus.on(
            "pagesinit",
            () => {
              shown.abort();
              try {
                const viewSet = view.show(held, kept);
                resume(Effect.promise(() => viewSet.then(() => true)));
              } catch (error) {
                resume(Effect.die(error));
              }
            },
            { signal: shown.signal },
          );
          view.theme();
          viewer.open(held.headless.proxy);
          (viewer.pdfViewer.pagesPromise as Promise<unknown>).catch(
            (cause: unknown) => {
              if (shown.signal.aborted) return;
              shown.abort();
              resume(Effect.fail(new PdfLoadError("invalid", { cause })));
            },
          );
          return Effect.sync(() => shown.abort());
        },
      ).pipe(
        Effect.catch((error: PdfLoadError) =>
          Effect.sync(() => {
            this.#failed(error);
            return false;
          }),
        ),
      );
      if (viewShown) this.#ready(held);
    });
  }

  #failed(error: PdfLoadError): void {
    if (
      error.reason === "password-required" ||
      error.reason === "password-incorrect"
    ) {
      if (error.reason === "password-incorrect") this.#password = undefined;
      this.#options.atoms.update((state) =>
        askPassword(state, error.reason === "password-incorrect"),
      );
      this.check();
      return;
    }
    this.#end(failureOf(error));
  }

  #ready(held: Held): void {
    const { atoms, emitter, view } = this.#options;
    const { document } = held.lease;
    const first = !this.#hadReady;
    this.#hadReady = true;
    atoms.update(ready);
    view.resumed();
    emitter.emit("ready", { document, first });
    this.#answerReady(document);
    this.check();
  }

  #end(end: End): void {
    const { atoms } = this.#options;
    this.#close();
    if (end === "reloaded") {
      atoms.update(loading);
      return;
    }
    if (end !== "disposed") atoms.update((state) => fail(state, end));
    this.#queued?.resolve("no-document");
    this.#queued = null;
    this.#answerReady(null);
    this.check();
  }

  #close(): void {
    const { atoms, emitter, host, viewer, pages, view } = this.#options;
    const held = this.#current;
    this.#current = null;
    view.closing();
    if (held) {
      held.lease.retire();
      held.links[Symbol.dispose]();
      atoms.setDocument(null);
      emitter.emit("document", { document: null });
    }
    viewer.open(null);
    pages.clear();
    const waiters = [...this.#renderWaiters.values()].flatMap((set) => [
      ...set,
    ]);
    this.#renderWaiters.clear();
    for (const answer of waiters) answer(null);
    if (held) {
      held.headless[Symbol.asyncDispose]().then(undefined, (error: unknown) => {
        host.report(error, { phase: "dispose" });
      });
    }
  }

  #answerReady(document: ReaderDocument | null): void {
    const waiters = [...this.#readyWaiters];
    this.#readyWaiters.clear();
    for (const answer of waiters) answer(document);
  }

  #answerOutOfRange(): void {
    for (const [pageIndex, waiters] of this.#renderWaiters) {
      if (this.inRange(pageIndex)) continue;
      this.#renderWaiters.delete(pageIndex);
      for (const answer of waiters) answer(null);
    }
  }
}
