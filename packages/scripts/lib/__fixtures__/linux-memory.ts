import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename, join } from "node:path";

const root = process.env.ZOTLIT_TEST_LINUX_MEMORY!;
Object.defineProperty(process, "platform", { value: "linux" });
fs.readFileSync = new Proxy(fs.readFileSync, {
  apply(target, receiver, args: Parameters<typeof fs.readFileSync>) {
    const [path, options] = args;
    if (
      path === "/proc/meminfo" ||
      path === "/sys/fs/cgroup/memory.max" ||
      path === "/sys/fs/cgroup/memory.current"
    ) {
      return Reflect.apply(target, receiver, [
        join(root, basename(path)),
        options,
      ]);
    }
    return Reflect.apply(target, receiver, args);
  },
});
syncBuiltinESMExports();
