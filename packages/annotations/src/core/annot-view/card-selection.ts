declare const CARD_PLACE: unique symbol;

export type CardPlace = string & { readonly [CARD_PLACE]: true };

export function cardPlace(key: string, groupKey: string | null): CardPlace {
  return (groupKey === null ? key : `${groupKey}\n${key}`) as CardPlace;
}

export function placedKey(place: CardPlace): string {
  return place.slice(place.lastIndexOf("\n") + 1);
}

export interface CardSelection {
  readonly selected: readonly string[];
  readonly anchor: CardPlace | null;
  readonly focus: CardPlace | null;
}

export const NO_SELECTION: CardSelection = {
  selected: [],
  anchor: null,
  focus: null,
};

export interface NamedCard {
  key: string;
  place?: CardPlace;
}

export type SelectionChange =
  | ({ kind: "click" } & NamedCard)
  | ({ kind: "toggle" } & NamedCard)
  | ({ kind: "range" } & NamedCard)
  | { kind: "all" }
  | { kind: "clear" }
  | { kind: "prune" }
  | { kind: "replace"; keys: readonly string[] }
  | { kind: "move"; step: 1 | -1 }
  | { kind: "extend"; step: 1 | -1 };

export type CardClick = Extract<
  SelectionChange["kind"],
  "click" | "toggle" | "range"
>;

export function nextCardSelection(
  current: CardSelection,
  visible: readonly CardPlace[],
  change: SelectionChange,
): CardSelection {
  const next = transition(current, visible, change);
  return sameSelection(current, next) ? current : next;
}

export function moveOrigin(
  current: CardSelection,
  visible: readonly CardPlace[],
): CardPlace | null {
  for (const place of [current.focus, current.anchor])
    if (place !== null && visible.includes(place)) return place;
  return (
    visible.find((place) => current.selected.includes(placedKey(place))) ?? null
  );
}

function placeOf(
  current: CardSelection,
  visible: readonly CardPlace[],
  { key, place }: NamedCard,
): CardPlace | undefined {
  if (place !== undefined) return visible.includes(place) ? place : undefined;
  if (
    current.focus !== null &&
    placedKey(current.focus) === key &&
    visible.includes(current.focus)
  )
    return current.focus;
  return visible.find((at) => placedKey(at) === key);
}

function cardsAt(places: readonly CardPlace[]): string[] {
  return [...new Set(places.map(placedKey))];
}

function rangeOrigin(
  current: CardSelection,
  visible: readonly CardPlace[],
): CardPlace | null {
  return current.anchor !== null && visible.includes(current.anchor)
    ? current.anchor
    : moveOrigin(current, visible);
}

function span(
  visible: readonly CardPlace[],
  from: CardPlace,
  to: CardPlace,
): string[] {
  const a = visible.indexOf(from);
  const b = visible.indexOf(to);
  return cardsAt(visible.slice(Math.min(a, b), Math.max(a, b) + 1));
}

function alone(place: CardPlace): CardSelection {
  return { selected: [placedKey(place)], anchor: place, focus: place };
}

function stepFromOrigin(
  current: CardSelection,
  visible: readonly CardPlace[],
  step: 1 | -1,
): CardPlace | undefined {
  const from = moveOrigin(current, visible);
  if (from === null) return visible.at(step > 0 ? 0 : -1);
  const at = visible.indexOf(from) + step;
  return visible[Math.min(Math.max(at, 0), visible.length - 1)] ?? from;
}

function transition(
  current: CardSelection,
  visible: readonly CardPlace[],
  change: SelectionChange,
): CardSelection {
  switch (change.kind) {
    case "click": {
      const place = placeOf(current, visible, change);
      if (place === undefined) return current;
      return alone(place);
    }
    case "toggle": {
      const place = placeOf(current, visible, change);
      if (place === undefined) return current;
      const key = placedKey(place);
      const joins = !current.selected.includes(key);
      return {
        selected: cardsAt(visible).filter((card) =>
          card === key ? joins : current.selected.includes(card),
        ),
        anchor: place,
        focus: place,
      };
    }
    case "range": {
      const place = placeOf(current, visible, change);
      if (place === undefined) return current;
      const origin = rangeOrigin(current, visible);
      if (origin === null) return alone(place);
      return {
        selected: span(visible, origin, place),
        anchor: origin,
        focus: place,
      };
    }
    case "all":
      return { ...current, selected: cardsAt(visible) };
    case "clear":
      return NO_SELECTION;
    case "prune": {
      const shown = new Set(visible.map(placedKey));
      return {
        ...current,
        selected: current.selected.filter((key) => shown.has(key)),
      };
    }
    case "replace": {
      const places = visible.filter((place) =>
        change.keys.includes(placedKey(place)),
      );
      const first = places[0] ?? null;
      return { selected: cardsAt(places), anchor: first, focus: first };
    }
    case "move": {
      const key = stepFromOrigin(current, visible, change.step);
      return key === undefined ? current : alone(key);
    }
    case "extend": {
      const origin = rangeOrigin(current, visible);
      const key = stepFromOrigin(current, visible, change.step);
      if (key === undefined) return current;
      if (origin === null) return alone(key);
      return {
        selected: span(visible, origin, key),
        anchor: origin,
        focus: key,
      };
    }
  }
}

function sameSelection(a: CardSelection, b: CardSelection): boolean {
  return (
    a.anchor === b.anchor &&
    a.focus === b.focus &&
    sameKeys(a.selected, b.selected)
  );
}

export function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}
