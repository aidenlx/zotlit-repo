type Start = () => boolean | PromiseLike<boolean>;

interface Loop {
  rest(): void;
  start?: Start;
}

interface Turn {
  me: symbol;
  loop: Loop;
}

let holder: Turn | { me: symbol; loop: null } | null = null;
const waiting = new Map<symbol, Turn>();

export function takeTurn(me: symbol, loop: Loop) {
  const previous = holder;
  waiting.delete(me);
  holder = { me, loop };
  if (previous?.loop && previous.me !== me) {
    if (previous.loop.start) waiting.set(previous.me, previous);
    previous.loop.rest();
  }

  const finishStart = (started: boolean) => {
    if (!started) endTurn(me);
  };
  const started = loop.start?.();
  if (typeof started === "boolean") finishStart(started);
  else if (started) void Promise.resolve(started).then(finishStart);
}

export function askTurn(me: symbol, loop: Loop & { start: Start }) {
  if (holder?.loop === null && holder.me !== me) {
    waiting.set(me, { me, loop });
  } else {
    takeTurn(me, loop);
  }
}

export function holdTurn(me: symbol) {
  waiting.delete(me);
  if (holder?.me === me) holder = { me, loop: null };
}

export function endTurn(me: symbol) {
  waiting.delete(me);
  if (holder?.me !== me) return;
  holder = null;
  const next = waiting.values().next().value;
  if (next) takeTurn(next.me, next.loop);
}
