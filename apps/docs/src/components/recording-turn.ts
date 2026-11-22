let holder: symbol | null = null;
let held = false;
const rests = new Map<symbol, () => void>();
const waiting = new Map<symbol, () => void>();

export function takeTurn(me: symbol, rest: () => void) {
  if (holder && holder !== me) rests.get(holder)?.();
  holder = me;
  held = false;
  rests.set(me, rest);
}

export function askTurn(me: symbol, rest: () => void) {
  if (held && holder !== me) return false;
  takeTurn(me, rest);
  return true;
}

export function holdTurn(me: symbol) {
  if (holder !== me) return;
  held = true;
  rests.delete(me);
}

export function endTurn(me: symbol) {
  rests.delete(me);
  if (holder !== me) return;
  holder = null;
  held = false;
  const [next] = waiting.entries();
  if (next) {
    waiting.delete(next[0]);
    next[1]();
  }
}

export function awaitTurn(me: symbol, resume: () => void) {
  waiting.set(me, resume);
}

export function stopWaiting(me: symbol) {
  waiting.delete(me);
}
