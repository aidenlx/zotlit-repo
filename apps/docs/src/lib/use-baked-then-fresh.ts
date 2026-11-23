import { useEffect, useState } from "react";

export function currentFact<T>(baked: T | null, fresh: T | null): T | null {
  return baked === null ? null : (fresh ?? baked);
}

export function useBakedThenFresh<T>(endpoint: string, baked: T): T;
export function useBakedThenFresh<T>(
  endpoint: string,
  baked: T | null,
): T | null;
export function useBakedThenFresh<T>(
  endpoint: string,
  baked: T | null,
): T | null {
  const [fresh, setFresh] = useState<T | null>(null);
  const carriesFact = baked !== null;
  if (!carriesFact && fresh !== null) setFresh(null);

  useEffect(() => {
    if (!carriesFact) return;
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((latest) => {
        if (latest) setFresh(latest as T);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [endpoint, carriesFact]);

  return currentFact(baked, fresh);
}
