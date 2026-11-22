import { Scope } from "obsidian";
import type { App, Keymap, Modifier } from "obsidian";

import { stubService } from "@zotlit/plugin-kernel/__fixtures__/service-stub.ts";

export function keymapApp(): Pick<App, "scope" | "keymap"> & {
  scopes: Scope[];
} {
  const scopes: Scope[] = [];
  return {
    scope: new Scope(),
    scopes,
    keymap: stubService<Keymap>("Keymap", {
      pushScope: (scope: Scope) => scopes.push(scope),
      popScope: (scope: Scope) => {
        const index = scopes.indexOf(scope);
        if (index !== -1) scopes.splice(index, 1);
      },
    }),
  };
}

const MODIFIER_HELD: Readonly<
  Record<string, (event: KeyboardEvent) => boolean>
> = {
  Ctrl: (event) => event.ctrlKey,
  Meta: (event) => event.metaKey,
  Alt: (event) => event.altKey,
  Shift: (event) => event.shiftKey,
};

function heldModifiers(
  modifiers: Modifier[] | null,
  event: KeyboardEvent,
): boolean {
  if (modifiers === null) return true;
  return Object.entries(MODIFIER_HELD).every(
    ([name, held]) => modifiers.includes(name as Modifier) === held(event),
  );
}

export function dispatchKey(
  scope: Scope,
  init: KeyboardEventInit,
  target: EventTarget,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  Object.defineProperty(event, "target", { value: target });
  if (handleKey(scope, event) === false) {
    event.preventDefault();
    return event;
  }
  target.dispatchEvent(event);
  return event;
}

function handleKey(scope: Scope, event: KeyboardEvent): unknown {
  const { handlers, parent } = scope as unknown as {
    handlers: {
      modifiers: Modifier[] | null;
      key: string | null;
      func: (evt: KeyboardEvent) => boolean | void;
    }[];
    parent?: Scope;
  };
  for (const { modifiers, key, func } of handlers) {
    if (key !== null && key.toLowerCase() !== event.key.toLowerCase()) continue;
    if (!heldModifiers(modifiers, event)) continue;
    const answer = func(event);
    if (answer !== undefined || key !== null || modifiers !== null)
      return answer;
  }
  return parent && handleKey(parent, event);
}

export function pressTop(
  app: { scopes: Scope[] },
  init: KeyboardEventInit,
  target: EventTarget,
): KeyboardEvent {
  const top = app.scopes.at(-1);
  if (!top) throw new Error("No Scope stands on the keymap");
  return dispatchKey(top, init, target);
}
