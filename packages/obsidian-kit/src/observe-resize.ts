import { disposable } from "./disposables.ts";

export function observeResize(
  owner: HTMLElement,
  targets: readonly Element[],
  callback: ResizeObserverCallback,
): Disposable {
  let observer: ResizeObserver | null = null;
  const observe = (win: Window) => {
    observer?.disconnect();
    observer = null;
    const { ResizeObserver } = win as Partial<typeof window>;
    if (!ResizeObserver) return;
    observer = new ResizeObserver(callback);
    for (const target of targets) observer.observe(target);
  };
  observe(owner.win);
  const stopMigration = owner.onWindowMigrated(observe);
  return disposable(() => {
    stopMigration();
    observer?.disconnect();
    observer = null;
  });
}
