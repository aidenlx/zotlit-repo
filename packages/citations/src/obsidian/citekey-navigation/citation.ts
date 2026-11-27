import type { ShownCitation } from "#obsidian/citation-text/present.ts";
import { Effect } from "effect";
import type { HoverParent, Workspace } from "obsidian";
import { Menu } from "obsidian";

import {
  menuEvent,
  menuSections,
  raiseMenu,
} from "@zotlit/obsidian-kit/menu-events.ts";
import {
  logServices,
  withLogCategory,
  logLevelEnabled,
} from "@zotlit/plugin-kernel/effect-log.ts";

import type { CitationHoverIntent, HoverPreferences } from "./hover.ts";
import { citationHoverIntent } from "./hover.ts";
import type {
  CitationClickIntent,
  CitedWork,
  HoveredWork,
  NavigationPane,
} from "./intent.ts";
import {
  citationClickIntent,
  citationTarget,
  navigationIntent,
} from "./intent.ts";
import type { GestureSurface } from "./shell.ts";
import { hoverGesture, mouseGesture, triggerCitekeyHover } from "./shell.ts";

declare module "@zotlit/obsidian-kit/menu-events.ts" {
  interface ZotLitMenuEvents {
    "zotlit:cited-works-menu": { works: readonly CitedWork[] };
  }
}

const citedWorksMenu = menuEvent("zotlit:cited-works-menu", ["open", ""]);

const SECTION = menuSections(citedWorksMenu);

export interface CitationHoverTarget {
  workspace: Pick<Workspace, "trigger">;
  hoverParent: HoverParent;
  sourcePath: string;
}

export interface CitationHoverRequest {
  event: MouseEvent;
  hoverParent: HoverParent;
  sourcePath: string;
  targetEl: HTMLElement;
  works: readonly HoveredWork[];
  shown?: ShownCitation;
  open: (citekey: string, pane: NavigationPane) => void;
}

export interface CitationHover {
  works: readonly HoveredWork[];
  shown?: ShownCitation;
  where: GestureSurface;
  open: (citekey: string, pane: NavigationPane) => void;
  showPopover: (request: CitationHoverRequest) => void;
  hoverPreferences: () => HoverPreferences;
  hoverTarget: () => CitationHoverTarget | null;
}

export interface CitationNavigation extends CitationHover {
  works: readonly CitedWork[];
  workspace: Pick<Workspace, "trigger">;
  hoverNotePath: (citekey: string) => string | null;
}

export type CitationClickAffordance = "open" | "edit" | "none";

const CLICK_CURSOR_CLASSES = [
  "zt:data-[zt-click=open]:cursor-link",
  "zt:data-[zt-click=edit]:cursor-text",
  "zt:data-[zt-click=none]:cursor-text",
];

export function markCitationClick(
  element: HTMLElement,
  click: CitationClickAffordance,
  { cursor = true }: { cursor?: boolean } = {},
): void {
  element.dataset.ztClick = click;
  if (cursor) element.classList.add(...CLICK_CURSOR_CLASSES);
}

export function attachCitationHover(
  element: HTMLElement,
  navigation: CitationNavigation,
): void {
  element.addEventListener("mouseover", (event) => {
    hover(event, element, navigation);
  });
}

export function attachCitationNavigation(
  element: HTMLElement,
  navigation: CitationNavigation,
): void {
  attachCitationHover(element, navigation);
  element.addEventListener("click", (event) => {
    if (event.button === 0) navigate(event, navigation);
  });
  element.addEventListener("mousedown", (event) => {
    if (event.button === 1) navigate(event, navigation);
  });
}

export function attachClosedCitationGestures(
  element: HTMLElement,
  navigation: CitationNavigation,
): void {
  attachCitationHover(element, navigation);
  element.addEventListener("click", (event) => {
    if (clickIntentOf(event, navigation.where) === "navigate") {
      navigate(event, navigation);
    }
  });
}

export function clickWikilinkCitation(
  event: MouseEvent,
  {
    where,
    edit,
  }: { where: GestureSurface; edit?: (event: MouseEvent) => void },
): void {
  if (event.button !== 0) return;
  const intent = clickIntentOf(event, where);
  if (intent === "navigate") return;
  event.preventDefault();
  event.stopPropagation();
  if (logLevelEnabled("debug"))
    Effect.runSyncWith(logServices)(
      Effect.logDebug("Wikilink citation keeps its note closed").pipe(
        Effect.annotateLogs({
          surface: where.surface,
          intent,
        }),
        withLogCategory("citekey-navigation"),
      ),
    );
  if (intent === "edit") edit?.(event);
}

function clickIntentOf(
  event: MouseEvent,
  where: GestureSurface,
): CitationClickIntent {
  if (event.button !== 0) return "nothing";
  return citationClickIntent(mouseGesture(event, "click", where));
}

function navigate(event: MouseEvent, navigation: CitationNavigation): void {
  const { works, where } = navigation;
  const surface = where.surface;
  const intent = navigationIntent(
    mouseGesture(event, "click", where),
    citationTarget(works),
  );
  if (intent.kind === "open") {
    event.preventDefault();
    if (logLevelEnabled("debug"))
      Effect.runSyncWith(logServices)(
        Effect.logDebug("Rendered citation opens note").pipe(
          Effect.annotateLogs({
            surface,
            citekey: intent.citekey,
            pane: intent.pane,
          }),
          withLogCategory("citekey-navigation"),
        ),
      );
    navigation.open(intent.citekey, intent.pane);
    return;
  }
  if (intent.kind !== "show-citation-menu") {
    if (logLevelEnabled("debug"))
      Effect.runSyncWith(logServices)(
        Effect.logDebug("Rendered citation click not followed").pipe(
          Effect.annotateLogs({
            surface,
            works: works.length,
            intent: intent.kind,
          }),
          withLogCategory("citekey-navigation"),
        ),
      );
    return;
  }
  event.preventDefault();

  if (logLevelEnabled("debug"))
    Effect.runSyncWith(logServices)(
      Effect.logDebug("Rendered citation offers its works").pipe(
        Effect.annotateLogs({
          surface,
          works: works.length,
          pane: intent.pane,
        }),
        withLogCategory("citekey-navigation"),
      ),
    );
  const menu = new Menu();
  for (const work of works) {
    menu.addItem((item) =>
      item
        .setSection(SECTION.open)
        .setTitle(work.label)
        .onClick(() => {
          navigation.open(work.citekey, intent.pane);
        }),
    );
  }
  raiseMenu(menu, {
    workspace: navigation.workspace,
    event: citedWorksMenu,
    info: { works },
  });
  menu.showAtMouseEvent(event);
}

export function hoverWikilinkCitation(
  event: MouseEvent,
  element: HTMLElement,
  hover: CitationHover,
): void {
  const preferences = hover.hoverPreferences();
  if (preferences.action === "popover") event.stopPropagation();
  const answer = hoverResult(event, element, { hover, preferences });
  if (answer === null || answer.intent.kind !== "popover") return;
  if (logLevelEnabled("trace"))
    Effect.runSyncWith(logServices)(
      Effect.logTrace("Wikilink citation shows its entries").pipe(
        Effect.annotateLogs({
          surface: hover.where.surface,
          works: hover.works.length,
          path: answer.target.sourcePath,
        }),
        withLogCategory("citekey-navigation"),
      ),
    );
  hover.showPopover({
    hoverParent: answer.target.hoverParent,
    sourcePath: answer.target.sourcePath,
    event,
    targetEl: element,
    works: hover.works,
    shown: hover.shown,
    open: hover.open,
  });
}

function hover(
  event: MouseEvent,
  element: HTMLElement,
  navigation: CitationNavigation,
): void {
  const { works, where } = navigation;
  const surface = where.surface;
  const answer = hoverResult(event, element, {
    hover: navigation,
    preferences: navigation.hoverPreferences(),
  });
  if (answer === null) return;
  const { intent, target } = answer;

  if (intent.kind === "page-preview") {
    const notePath = navigation.hoverNotePath(intent.citekey);
    if (notePath === null) {
      if (logLevelEnabled("trace"))
        Effect.runSyncWith(logServices)(
          Effect.logTrace("Rendered citation hover suppressed").pipe(
            Effect.annotateLogs({
              surface,
              works: works.length,
              reason: "no-note",
            }),
            withLogCategory("citekey-navigation"),
          ),
        );
      return;
    }
    if (logLevelEnabled("trace"))
      Effect.runSyncWith(logServices)(
        Effect.logTrace("Rendered citation previews note").pipe(
          Effect.annotateLogs({
            surface,
            citekey: intent.citekey,
            path: notePath,
          }),
          withLogCategory("citekey-navigation"),
        ),
      );
    triggerCitekeyHover(target.workspace, {
      event,
      hoverParent: target.hoverParent,
      targetEl: element,
      linktext: notePath,
      sourcePath: target.sourcePath,
    });
    return;
  }

  if (logLevelEnabled("trace"))
    Effect.runSyncWith(logServices)(
      Effect.logTrace("Rendered citation shows its entries").pipe(
        Effect.annotateLogs({
          surface,
          works: intent.citekeys.length,
          path: target.sourcePath,
        }),
        withLogCategory("citekey-navigation"),
      ),
    );
  navigation.showPopover({
    hoverParent: target.hoverParent,
    sourcePath: target.sourcePath,
    event,
    targetEl: element,
    works,
    shown: navigation.shown,
    open: navigation.open,
  });
}

type ShownHoverIntent = Exclude<CitationHoverIntent, { kind: "nothing" }>;

function hoverResult(
  event: MouseEvent,
  element: HTMLElement,
  {
    hover,
    preferences,
  }: { hover: CitationHover; preferences: HoverPreferences },
): { intent: ShownHoverIntent; target: CitationHoverTarget } | null {
  const { works, where } = hover;
  const surface = where.surface;
  const relatedTarget = event.relatedTarget as Node | null;
  if (relatedTarget?.instanceOf(Node) && element.contains(relatedTarget)) {
    return null;
  }

  const intent = citationHoverIntent(
    hoverGesture(event, where),
    preferences,
    works.map((work) => work.citekey),
  );
  if (intent.kind === "nothing") {
    if (logLevelEnabled("trace"))
      Effect.runSyncWith(logServices)(
        Effect.logTrace("Rendered citation hover suppressed").pipe(
          Effect.annotateLogs({
            surface,
            works: works.length,
            reason: intent.reason,
          }),
          withLogCategory("citekey-navigation"),
        ),
      );
    return null;
  }

  const target = hover.hoverTarget();
  if (!target) {
    if (logLevelEnabled("trace"))
      Effect.runSyncWith(logServices)(
        Effect.logTrace("Rendered citation sits in no view").pipe(
          Effect.annotateLogs({ surface }),
          withLogCategory("citekey-navigation"),
        ),
      );
    return null;
  }
  return { intent, target };
}
