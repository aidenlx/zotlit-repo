import type { StartupPageTimes } from "./startup-probe.ts";

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  children?: number[];
}

export interface CpuProfile {
  nodes: ProfileNode[];
  startTime: number;
  samples: number[];
  timeDeltas: number[];
}

export interface WindowCost {
  readonly name: string;
  readonly wallMs: number;
  readonly busyMs: number;
  readonly top: readonly { readonly frame: string; readonly ms: number }[];
}

export interface ProfileSplit {
  readonly pluginMs: number;
  readonly clockErrorMs: number;
  readonly windows: readonly WindowCost[];
}

const TOP = 6;

function frameName({ callFrame }: ProfileNode): string {
  const file = callFrame.url.split("/").at(-1) || callFrame.url;
  return `${callFrame.functionName || "(anonymous)"}${file ? ` ${file}:${callFrame.lineNumber + 1}` : ""}`;
}

export function splitProfile(
  profile: CpuProfile,
  times: StartupPageTimes,
  pluginMs: number,
): ProfileSplit {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const parent = new Map<number, number>();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parent.set(child, node.id);
  const inSync = (id: number): boolean => {
    for (let at: number | undefined = id; at !== undefined; at = parent.get(at))
      if (byId.get(at)?.callFrame.functionName === "__ztClockSync") return true;
    return false;
  };

  const stamps: number[] = [];
  let clock = profile.startTime;
  for (const delta of profile.timeDeltas) {
    clock += delta;
    stamps.push(clock);
  }
  const syncIndex = profile.samples.findIndex((id) => inSync(id));
  if (syncIndex < 0 || times.clockSync === undefined) {
    throw new Error("the profile holds no clock sync sample");
  }
  const offsetUs = stamps[syncIndex]! - times.clockSync * 1000;
  const clockErrorMs =
    (stamps[syncIndex]! - (stamps[syncIndex - 1] ?? profile.startTime)) / 1000;
  const toMs = (stamp: number): number => (stamp - offsetUs) / 1000;

  const { marks } = times;
  const need = (name: string): number => {
    const value = marks[name];
    if (value === undefined) throw new Error(`the gate recorded no ${name}`);
    return value;
  };
  const cssEnd = need("css:end");
  const pluginStart = cssEnd - pluginMs;
  const callbacks = times.layoutCallbacks;
  const spans: [string, number, number][] = [
    ["read and compile main.js", pluginStart, need("eval:start")],
    ["module top level", need("eval:start"), need("eval:end")],
    ["constructor", need("eval:end"), need("onload:start")],
    ["onload", need("onload:start"), need("onload:end")],
    ["between onload and loadCSS", need("onload:end"), need("css:start")],
    ["loadCSS", need("css:start"), cssEnd],
  ];
  if (callbacks.length > 0) {
    spans.push([
      "onLayoutReady callbacks",
      Math.min(...callbacks.map(({ start }) => start)),
      Math.max(
        ...callbacks.map(({ end, syncEnd, start }) => end ?? syncEnd ?? start),
      ),
    ]);
  }
  if (times.layoutReady !== undefined && times.callbacksDone !== undefined) {
    spans.push([
      "layout ready to callbacks done",
      times.layoutReady,
      times.callbacksDone,
    ]);
  }

  const windows = spans.map(([name, start, end]): WindowCost => {
    const self = new Map<string, number>();
    let busyUs = 0;
    profile.samples.forEach((id, index) => {
      const at = toMs(stamps[index]!);
      if (at < start || at >= end) return;
      const weight = (profile.timeDeltas[index + 1] ?? 0) || 0;
      const node = byId.get(id)!;
      if (node.callFrame.functionName === "(idle)") return;
      busyUs += weight;
      const frame = frameName(node);
      self.set(frame, (self.get(frame) ?? 0) + weight);
    });
    return {
      name,
      wallMs: Math.round((end - start) * 10) / 10,
      busyMs: Math.round(busyUs / 100) / 10,
      top: [...self]
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP)
        .map(([frame, us]) => ({ frame, ms: Math.round(us / 100) / 10 })),
    };
  });
  return { pluginMs, clockErrorMs, windows };
}
