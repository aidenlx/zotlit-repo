import { disposable } from "@zotlit/obsidian-kit/disposables.ts";
import { observeResize } from "@zotlit/obsidian-kit/observe-resize.ts";

export function keepPlaces(root: HTMLElement): Disposable {
  const places = new Map<HTMLElement, { top: number; left: number }>();
  const onScroll = (event: Event) => {
    if (!root.isConnected) return;
    const box = event.target as Node;
    if (!box.instanceOf(HTMLElement)) return;
    if (box.scrollTop === 0 && box.scrollLeft === 0) places.delete(box);
    else places.set(box, { top: box.scrollTop, left: box.scrollLeft });
  };
  root.addEventListener("scroll", onScroll, { capture: true, passive: true });
  const restore = () => {
    for (const [box, { top, left }] of places) {
      if (!root.contains(box)) places.delete(box);
      else box.scrollTo({ top, left, behavior: "instant" });
    }
  };
  let shown = root.clientHeight > 0;
  const observing = observeResize(root, [root], () => {
    const shows = root.clientHeight > 0;
    if (shows && !shown) restore();
    shown = shows;
  });
  return disposable(() => {
    root.removeEventListener("scroll", onScroll, { capture: true });
    observing[Symbol.dispose]();
    places.clear();
  });
}
