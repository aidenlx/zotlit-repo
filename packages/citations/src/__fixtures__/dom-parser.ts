import { Window } from "happy-dom";
import { afterAll, vi } from "vitest";

const parserWindow = new Window();
vi.stubGlobal("DOMParser", parserWindow.DOMParser);
afterAll(async () => {
  await parserWindow.happyDOM.close();
  vi.unstubAllGlobals();
});
