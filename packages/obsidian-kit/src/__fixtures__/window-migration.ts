import { vi } from "vitest";

const NODE_INSERT_CLASS = "node-insert-event";

export function windowMigration() {
  const original = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "onWindowMigrated",
  );
  const listeners: [HTMLElement, (win: Window) => void][] = [];
  const release = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "onWindowMigrated", {
    configurable: true,
    value(this: HTMLElement, listener: (win: Window) => void) {
      this.classList.add(NODE_INSERT_CLASS);
      listeners.push([this, listener]);
      return release;
    },
  });
  return {
    release,
    move: (win: Window) => {
      for (const [element, listener] of listeners)
        if (element.classList.contains(NODE_INSERT_CLASS)) listener(win);
    },
    [Symbol.dispose]() {
      if (original) {
        Object.defineProperty(
          HTMLElement.prototype,
          "onWindowMigrated",
          original,
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "onWindowMigrated");
      }
    },
  };
}
