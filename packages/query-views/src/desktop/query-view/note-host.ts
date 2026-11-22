import { Component, Scope } from "obsidian";

import { observeResize } from "@zotlit/obsidian-kit/observe-resize.ts";
import { itemKeyFromFrontmatter } from "@zotlit/plugin-services/obsidian/note-index/parse.ts";

import { QueryView } from "./view.tsx";
import "./note-host.css";
import type { QueryViewDeps, QueryViewHost } from "./view.tsx";

import { keepPlaces } from "#obsidian/query-view/keep-places.ts";
import { makeNoteBindingAtom } from "#obsidian/query-view/note-binding.ts";

export type NoteStorage = Pick<QueryViewHost, "save" | "canSave" | "openFile">;

const drawnHeights = new Map<string, number>();
const reserving = new Set<NoteQueryHost>();

export class NoteQueryHost extends Component {
  readonly #query: QueryView;
  readonly #deps: QueryViewDeps;
  readonly #el: HTMLElement;
  readonly #sourcePath: () => string;
  readonly #scope: Scope;
  #item: string | null;
  readonly #binding: ReturnType<typeof makeNoteBindingAtom>;
  readonly #start = Promise.withResolvers<void>();
  #key: string;

  constructor(
    deps: QueryViewDeps,
    {
      el,
      sourcePath,
      storage,
      view,
    }: {
      el: HTMLElement;
      sourcePath: () => string;
      storage: NoteStorage;
      view: string;
    },
  ) {
    super();
    this.#deps = deps;
    this.#el = el;
    this.#sourcePath = sourcePath;
    this.#scope = new Scope(deps.app.scope);
    this.#item = this.#readItem();
    this.#binding = makeNoteBindingAtom(sourcePath, this.#item);
    el.addClass("zt-root", "zt-query-note", "interactive-child");
    this.#query = new QueryView(deps, {
      ...storage,
      scope: this.#scope,
      sourcePath,
      context: () => (this.#item === null ? undefined : { item: this.#item }),
      contextSource: "note",
      start: this.#start.promise,
    });
    el.dataset.queryWaiting = "";
    this.#key = JSON.stringify([sourcePath(), view]);
    this.#reserve(drawnHeights.get(this.#key));
    if (__DEV__) Object.assign(el, { zotlitQueryView: this.#query });
  }

  override onload(): void {
    this.addChild(this.#query);
    this.#query.render(this.#el);
    this.register(this.#deps.nearScreen(this.#el, () => this.#start.resolve()));
    reserving.add(this);
    this.register(() => reserving.delete(this));
    this.register(
      this.#query.state.subscribe((state) => {
        const settled =
          state.phase === "ready" ||
          state.phase === "failed" ||
          state.problems.length > 0;
        if (!settled) return;
        const done = () => {
          delete this.#el.dataset.queryWaiting;
          reserving.delete(this);
        };
        if (state.phase === "ready") void this.#query.drawn().then(done);
        else done();
      }),
    );
    const resize = observeResize(this.#el, [this.#el], () => this.#drew());
    this.register(() => resize[Symbol.dispose]());
    const places = keepPlaces(this.#el);
    this.register(() => places[Symbol.dispose]());
    const keys = this.#deps.cardFocus.hold(this.#el, this.#scope, this.#query);
    this.register(() => keys[Symbol.dispose]());
    const { registry } = this.#deps;
    this.register(registry.mount(this.#binding));
    this.register(
      registry.subscribe(this.#binding, (key) => {
        this.#item = key;
        this.#query.contextChanged();
      }),
    );
  }

  setText(text: string): void {
    this.#query.setText(text);
  }

  selectView(name: string | null): void {
    this.#query.selectView(name);
  }

  get viewName(): string | null {
    return this.#query.viewName;
  }

  async shown(): Promise<void> {
    if (this.#el.closest(".print")) this.#start.resolve();
    else if (this.#query.state.getState().phase === "waiting") return;
    await this.#query.shownIn(this.#el);
  }

  showsAs(view: string): void {
    const height = drawnHeights.get(this.#key);
    this.#key = JSON.stringify([this.#sourcePath(), view]);
    if (height !== undefined) drawnHeights.set(this.#key, height);
  }

  #reserve(height: number | undefined): void {
    if (height !== undefined)
      this.#el.style.setProperty("--zt-query-note-reserve", `${height}px`);
  }

  #drew(): void {
    const el = this.#el;
    if (reserving.has(this) || el.closest(".print")) return;
    const { height } = el.getBoundingClientRect();
    if (height === 0) return;
    drawnHeights.set(this.#key, height);
    for (const host of reserving)
      if (host.#key === this.#key) host.#reserve(height);
  }

  #readItem(): string | null {
    const { vault, metadataCache } = this.#deps.app;
    const note = vault.getFileByPath(this.#sourcePath());
    return note === null
      ? null
      : itemKeyFromFrontmatter(metadataCache.getFileCache(note));
  }
}

export function whenNear(el: HTMLElement, near: () => void): () => void {
  let observer: IntersectionObserver | null = null;
  let frame: { win: Window; id: number } | null = null;
  let done = false;
  const end = () => {
    observer?.disconnect();
    observer = null;
    if (frame) frame.win.cancelAnimationFrame(frame.id);
    frame = null;
  };
  const watch = (win: Window) => {
    end();
    if (done) return;
    if (!el.isConnected) {
      frame = { win, id: win.requestAnimationFrame(() => watch(win)) };
      return;
    }
    const { IntersectionObserver } = win as typeof window;
    observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        done = true;
        end();
        near();
      },
      { root: scrollBox(el), rootMargin: "100% 0px" },
    );
    observer.observe(el);
  };
  watch(el.win);
  const unmigrate = el.onWindowMigrated(watch);
  return () => {
    done = true;
    unmigrate();
    end();
  };
}

function scrollBox(el: HTMLElement): HTMLElement | null {
  for (let box = el.parentElement; box; box = box.parentElement) {
    const { overflowY } = box.win.getComputedStyle(box);
    if (overflowY === "auto" || overflowY === "scroll") return box;
  }
  return null;
}
