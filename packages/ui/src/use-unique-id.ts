import { useState } from "react";

let sequence = 0;

export function useUniqueId(): string {
  const [id] = useState(() => `zt-${(sequence += 1)}`);
  return id;
}
