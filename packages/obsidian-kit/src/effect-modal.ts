import { Effect } from "effect";

export interface ClosableModal {
  close(): void;
}

export function awaitModal<A>(
  open: (settle: (answer: A) => void) => ClosableModal,
): Effect.Effect<A> {
  return Effect.callback<A>((resume) => {
    const modal = open((answer) => resume(Effect.succeed(answer)));
    return Effect.sync(() => modal.close());
  });
}

export function openModalIn(modal: { open(): void }, win: Window): void {
  activeWindow = win;
  activeDocument = win.document;
  modal.open();
}
