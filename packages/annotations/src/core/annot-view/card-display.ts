import { createContext } from "react";

export interface CardDisplay {
  readonly comment: boolean;
  readonly tags: boolean;
  readonly page: boolean;
}

export const CardDisplayContext = createContext<CardDisplay>({
  comment: true,
  tags: true,
  page: true,
});
