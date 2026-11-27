import { useCallback, useState } from "react";

export interface Retention<K> {
  isRetained: (key: K) => boolean;
  open: (key: K) => void;
}

export function useRetention<K>(
  occupants: ReadonlyMap<K, string>,
): Retention<K> {
  const [held, setHeld] = useState<ReadonlyMap<K, string>>(() => new Map());
  const [seen, setSeen] = useState(occupants);
  if (seen !== occupants) {
    setSeen(occupants);
    setHeld((current) => {
      const kept = new Map(
        [...current].filter(([key, id]) => occupants.get(key) === id),
      );
      return kept.size === current.size ? current : kept;
    });
  }
  const isRetained = useCallback(
    (key: K) => occupants.has(key) && held.get(key) === occupants.get(key),
    [held, occupants],
  );
  const open = useCallback(
    (key: K) =>
      setHeld((current) => {
        const id = occupants.get(key);
        if (id === undefined || current.get(key) === id) return current;
        return new Map(current).set(key, id);
      }),
    [occupants],
  );
  return { isRetained, open };
}
