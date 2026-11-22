import type { DesktopState } from "./desktop-states.ts";
import childProcess from "node:child_process";
import { readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

import { DESKTOP_STATES } from "./desktop-states.ts";

Object.defineProperty(process, "platform", { value: "darwin" });

function current() {
  const state = readFileSync(process.env.ZOTLIT_TEST_DESKTOP!, "utf8").trim();
  return DESKTOP_STATES[state as DesktopState](process.getuid!());
}

childProcess.execFile = new Proxy(childProcess.execFile, {
  apply(target, receiver, args: Parameters<typeof childProcess.execFile>) {
    const outputs: Record<string, () => string> = {
      system_profiler: () => current().displays,
      ioreg: () => "",
      plutil: () => current().sessions,
    };
    const output = outputs[args[0]];
    if (!output) return Reflect.apply(target, receiver, args);
    const callback = args.findLast((arg) => typeof arg === "function") as (
      error: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    const stdout = output();
    queueMicrotask(() => callback(null, stdout, ""));
    return new childProcess.ChildProcess();
  },
});

childProcess.spawn = new Proxy(childProcess.spawn, {
  apply(target, receiver, args: Parameters<typeof childProcess.spawn>) {
    if (args[0] !== "caffeinate") return Reflect.apply(target, receiver, args);
    const record = `require("node:fs").appendFileSync(${JSON.stringify(process.env.ZOTLIT_TEST_CAFFEINATE)}, process.pid + " " + ${JSON.stringify((args[1] as string[]).join(" "))} + "\\n"); setInterval(() => {}, 1000);`;
    return Reflect.apply(target, receiver, [
      process.execPath,
      ["-e", record],
      args[2],
    ]);
  },
});
syncBuiltinESMExports();
