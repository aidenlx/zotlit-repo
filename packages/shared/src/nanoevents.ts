/**
 * Tiny event emitter, in-house port of `nanoevents` with added `.once` support.
 *
 * Original implementation © 2016 Andrey Sitnik <andrey@sitnik.ru>, MIT License.
 * Source: https://github.com/ai/nanoevents
 *
 * ## Event naming
 *
 * Use `dash-case` for event names. Single words stay bare (`"changed"`,
 * `"degraded"`); multi-word names use hyphens (`"refresh-failed"`, not
 * `"refreshFailed"` or `"refresh_failed"`). Matches DOM event conventions
 * and keeps event names visually distinct from method/property identifiers
 * in calling code.
 *
 * ## Example
 *
 * ```ts
 * interface MyEvents {
 *   changed: () => void;
 *   "refresh-failed": (error: Error) => void;
 * }
 *
 * const emitter = createNanoEvents<MyEvents>();
 *
 * const off = emitter.on("refresh-failed", (err) => {
 *   console.log("oops", err);
 * });
 *
 * emitter.emit("refresh-failed", new Error("boom"));
 * off();
 * ```
 */

interface EventsMap {
  [event: string]: any;
}

interface DefaultEvents extends EventsMap {
  [event: string]: (...args: any) => void;
}

export interface Unsubscribe {
  (): void;
}

export interface Emitter<Events extends EventsMap = DefaultEvents> {
  emit<K extends keyof Events>(
    this: this,
    event: K,
    ...args: Parameters<Events[K]>
  ): void;

  events: Partial<{ [E in keyof Events]: Events[E][] }>;

  on<K extends keyof Events>(this: this, event: K, cb: Events[K]): Unsubscribe;

  once<K extends keyof Events>(
    this: this,
    event: K,
    cb: Events[K],
  ): Unsubscribe;
}

export interface EmitterMixin<Events extends EventsMap = DefaultEvents> {
  on<K extends keyof Events>(event: K, cb: Events[K]): Unsubscribe;
  once<K extends keyof Events>(event: K, cb: Events[K]): Unsubscribe;
}

export const createNanoEvents = <
  Events extends EventsMap = DefaultEvents,
>(): Emitter<Events> => ({
  events: {},
  emit(event, ...args) {
    const callbacks = this.events[event] || [];
    for (let i = 0, length = callbacks.length; i < length; i++) {
      callbacks[i]!(...args);
    }
  },
  on(event, cb) {
    (this.events[event] ||= []).push(cb);
    return () => {
      this.events[event] = this.events[event]?.filter((i) => cb !== i);
    };
  },
  once(event, cb) {
    const wrapper = ((...args: Parameters<typeof cb>) => {
      unbind();
      (cb as (...args: Parameters<typeof cb>) => void)(...args);
    }) as typeof cb;
    const unbind = this.on(event, wrapper);
    return unbind;
  },
});
