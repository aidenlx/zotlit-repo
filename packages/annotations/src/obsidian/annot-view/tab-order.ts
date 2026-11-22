import { disposable } from "@zotlit/obsidian-kit/disposables.ts";

const CARD = ".zt-annot-card";
const FOCUSABLE =
  "a[href], button, input, select, textarea, [tabindex], [contenteditable]";
const HELD = "data-zt-held-tabindex";

export function confineTabOrder(grid: HTMLElement): Disposable {
  const observer = new MutationObserver((records) => {
    const written = new Set<Node>();
    const cards = new Set<Element>();
    for (const { target, type } of records) {
      if (!target.instanceOf(Element)) continue;
      if (type === "attributes" && target.hasAttribute(HELD)) {
        if (!written.has(target)) hold(target);
        written.add(target);
      }
      if (target === grid) for (const card of cardsOf(grid)) cards.add(card);
      const card = target.closest(CARD);
      if (card) cards.add(card);
    }
    for (const card of cards) sync(card);
    observer.takeRecords();
  });
  observer.observe(grid, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["tabindex"],
  });
  for (const card of cardsOf(grid)) sync(card);
  observer.takeRecords();
  return disposable(() => {
    observer.disconnect();
    for (const control of grid.querySelectorAll(`[${HELD}]`)) release(control);
  });
}

function cardsOf(grid: HTMLElement): NodeListOf<Element> {
  return grid.querySelectorAll(CARD);
}

function sync(card: Element): void {
  const stop = card.instanceOf(HTMLElement) && card.tabIndex === 0;
  for (const control of card.querySelectorAll(FOCUSABLE)) {
    if (!control.instanceOf(HTMLElement)) continue;
    if (stop) {
      if (control.hasAttribute(HELD)) release(control);
    } else if (!control.hasAttribute(HELD) && control.tabIndex >= 0) {
      hold(control);
    }
  }
}

function hold(control: Element): void {
  control.setAttribute(HELD, control.getAttribute("tabindex") ?? "");
  control.setAttribute("tabindex", "-1");
}

function release(control: Element): void {
  const held = control.getAttribute(HELD) ?? "";
  control.removeAttribute(HELD);
  if (held === "") control.removeAttribute("tabindex");
  else control.setAttribute("tabindex", held);
}
