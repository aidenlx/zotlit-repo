import { Scope } from "obsidian";
import type { App } from "obsidian";

export interface PointerDrag {
  app: Pick<App, "scope" | "keymap">;
  press: Pick<PointerEvent, "pointerId" | "clientX" | "clientY">;
  axis?: "x" | "y";
  handle: HTMLElement;
  cursor: string;
  controller: AbortController;
  move: (delta: number) => void;
  drop: (delta: number) => void;
  end: () => void;
}

export function pointerDrag({
  app,
  press,
  axis = "x",
  handle,
  cursor,
  controller,
  move,
  drop,
  end,
}: PointerDrag): void {
  const { doc, win } = handle;
  const { signal } = controller;
  const at = (pointer: Pick<PointerEvent, "clientX" | "clientY">) =>
    axis === "x" ? pointer.clientX : pointer.clientY;
  const { pointerId } = press;
  const origin = at(press);
  let delta = 0;
  let moved = false;
  let frame = 0;
  try {
    handle.setPointerCapture(pointerId);
  } catch {
    // A pointer the browser does not track, as a test sends, has no capture.
  }
  handle.classList.add("is-active");
  doc.body.classList.add(cursor);
  const scope = new Scope(app.scope);
  scope.register([], "Escape", () => {
    controller.abort();
    return false;
  });
  app.keymap.pushScope(scope);
  signal.addEventListener(
    "abort",
    () => {
      app.keymap.popScope(scope);
      win.cancelAnimationFrame(frame);
      handle.classList.remove("is-active");
      doc.body.classList.remove(cursor);
      if (handle.hasPointerCapture?.(pointerId))
        handle.releasePointerCapture(pointerId);
      end();
    },
    { once: true },
  );
  const options = { capture: true, signal };
  const mine = (pointer: PointerEvent) => pointer.pointerId === pointerId;
  win.addEventListener(
    "pointermove",
    (event) => {
      if (!mine(event)) return;
      if (at(event) !== origin) moved = true;
      if (!moved) return;
      delta = at(event) - origin;
      if (frame) return;
      frame = win.requestAnimationFrame(() => {
        frame = 0;
        move(delta);
      });
    },
    options,
  );
  win.addEventListener(
    "pointerup",
    (event) => {
      if (!mine(event)) return;
      if (moved) {
        win.cancelAnimationFrame(frame);
        frame = 0;
        drop(delta);
      }
      controller.abort();
    },
    options,
  );
  win.addEventListener(
    "pointercancel",
    (event) => {
      if (mine(event)) controller.abort();
    },
    options,
  );
}
