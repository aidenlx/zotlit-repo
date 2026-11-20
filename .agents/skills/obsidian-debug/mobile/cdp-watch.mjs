import { readFile } from "node:fs/promises";
const [file, secs] = process.argv.slice(2);
const page = (await fetch("http://127.0.0.1:9224/json/list").then((r) => r.json())).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const send = (method, params = {}, sessionId) => ws.send(JSON.stringify({ id: ++id, method, params, ...(sessionId ? { sessionId } : {}) }));
const out = [];
ws.addEventListener("message", ({ data }) => {
  const m = JSON.parse(data);
  if (m.method === "Target.attachedToTarget") { const s = m.params.sessionId; out.push("attached " + m.params.targetInfo.type + " " + m.params.targetInfo.url.slice(0, 60)); send("Runtime.enable", {}, s); send("Log.enable", {}, s); send("Runtime.runIfWaitingForDebugger", {}, s); }
  if (m.method === "Runtime.exceptionThrown") out.push((m.sessionId ? "W " : "P ") + "EXC " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 400));
  if (m.method === "Runtime.consoleAPICalled" && true) out.push((m.sessionId ? "W " : "P ") + m.params.type + " " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
  if (m.method === "Log.entryAdded") out.push((m.sessionId ? "W " : "P ") + "log " + m.params.entry.level + " " + m.params.entry.text.slice(0, 300));
});
ws.addEventListener("open", async () => {
  send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  send("Runtime.enable"); send("Log.enable");
  const code = await readFile(file, "utf8");
  setTimeout(() => send("Runtime.evaluate", { expression: code, awaitPromise: true, returnByValue: true }), 500);
  setTimeout(() => { console.log(out.join("\n")); ws.close(); }, Number(secs ?? 20) * 1000);
});
