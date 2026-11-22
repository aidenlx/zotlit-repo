import type { ClosableModal } from "#effect-modal.ts";

export function modalAnswer<A>(
  open: (settle: (answer: A) => void) => ClosableModal,
): Promise<A> {
  return new Promise<A>((resolve) => {
    open(resolve);
  });
}
