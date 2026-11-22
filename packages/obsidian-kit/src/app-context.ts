import type { App } from "obsidian";
import { createContext, useContext } from "react";

export const AppContext = createContext<App | null>(null);

export function useObsidianApp(): App {
  const app = useContext(AppContext);
  if (!app) throw new Error("Rendered outside an Obsidian AppContext");
  return app;
}
