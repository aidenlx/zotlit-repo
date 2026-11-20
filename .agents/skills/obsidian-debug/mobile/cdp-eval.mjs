import { readFile } from "node:fs/promises";
const [file, timeoutArg] = process.argv.slice(2);
const targets = await fetch("http://127.0.0.1:9224/json/list").then((r) => r.json());
const page = targets.find((t) => t.type === "page");
if (!page) throw new Error("no WebView page");
const code = file === "-" ? await new Response(process.stdin).text() : await readFile(file, "utf8");
const socket = new WebSocket(page.webSocketDebuggerUrl);
const timer = setTimeout(() => { console.log("TIMEOUT"); socket.close(); process.exitCode = 1; }, Number(timeoutArg ?? 120) * 1000);
socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: code, returnByValue: true, awaitPromise: true } })));
socket.addEventListener("message", ({ data }) => {
  const r = JSON.parse(data);
  if (r.id !== 1) return;
  clearTimeout(timer);
  const v = r.result?.result?.value;
  console.log(r.result?.exceptionDetails ? "ERROR " + JSON.stringify(r.result.exceptionDetails).slice(0, 800) : typeof v === "string" ? v : JSON.stringify(v));
  socket.close();
});
