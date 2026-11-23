import { EventEmitter } from "node:events";
import { createContext, runInContext } from "node:vm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { captureObsidianLayer } from "./capture.ts";

const socketBoundary = vi.hoisted(() => ({
  answer: async (_args: string[]): Promise<string> => "",
}));

vi.mock("node:net", () => ({
  createConnection() {
    const socket = new EventEmitter();
    Object.assign(socket, {
      setNoDelay() {},
      destroy(error: Error) {
        socket.emit("error", error);
      },
      write(request: string) {
        const { argv } = JSON.parse(request) as { argv: string[] };
        void socketBoundary.answer(argv).then(
          (reply) => {
            socket.emit("data", Buffer.from(reply));
            socket.emit("end");
          },
          (error) => socket.emit("error", error),
        );
      },
    });
    queueMicrotask(() => socket.emit("connect"));
    return socket;
  },
}));

interface NoticeBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const capture = {
  lesson: "export-to-word",
  layer: "step-4",
  path: "/captures/step-4.png",
  notice: "Exported report.docx using APA.",
};
const fullyInView = { left: 600, top: 20, right: 780, bottom: 65 };
interface Notice {
  text: string;
  bounds: NoticeBounds;
}
let notices: Notice[];
let screenshots: string[];

beforeEach(() => {
  vi.useFakeTimers();
  notices = [];
  screenshots = [];
  const page = createContext({
    app: { plugins: { plugins: {} } },
    document: {
      querySelectorAll: () =>
        notices.map(({ text, bounds }) => ({
          textContent: text,
          checkVisibility: () => true,
          getBoundingClientRect: () => ({
            ...bounds,
            width: bounds.right - bounds.left,
            height: bounds.bottom - bounds.top,
          }),
        })),
    },
    window: { innerWidth: 800, innerHeight: 600 },
    performance,
    setTimeout,
    requestAnimationFrame: (paint: () => void) => setTimeout(paint, 16),
  });
  socketBoundary.answer = async (args) => {
    const code = args.find((arg) => arg.startsWith("code="))?.slice(5);
    if (code) return `=> ${String(await runInContext(code, page))}`;
    if (args.includes("dev:screenshot"))
      screenshots.push(args.find((arg) => arg.startsWith("path="))!.slice(5));
    return "";
  };
});

afterEach(() => {
  vi.useRealTimers();
});

it.for<[string, Notice[]]>([
  ["absent", []],
  ["replaced by an unrelated notice", [{ bounds: fullyInView, text: "Saved" }]],
  [
    "clipped on the right",
    [{ bounds: { ...fullyInView, right: 801 }, text: capture.notice }],
  ],
  [
    "clipped on the left",
    [{ bounds: { ...fullyInView, left: -1 }, text: capture.notice }],
  ],
  [
    "clipped at the top",
    [{ bounds: { ...fullyInView, top: -1 }, text: capture.notice }],
  ],
  [
    "clipped at the bottom",
    [{ bounds: { ...fullyInView, bottom: 601 }, text: capture.notice }],
  ],
])(
  "rejects the capture when the notice is %s",
  async ([, shown], { annotate }) => {
    await annotate(
      "https://github.com/aidenlx/zotlit-repo/issues/183",
      "issue",
    );
    notices = shown;
    const outcome = captureObsidianLayer("walk-vault", capture).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(2200);
    expect(await outcome).toMatchObject({
      message: 'Could not capture layer "step-4" of lesson "export-to-word"',
      cause: expect.objectContaining({
        message: expect.stringContaining(capture.notice),
      }),
    });
    expect(screenshots).toEqual([]);
  },
);

it("takes the screenshot once the requested notice fits", async () => {
  notices = [{ bounds: { ...fullyInView, right: 801 }, text: capture.notice }];
  const outcome = captureObsidianLayer("walk-vault", capture);
  await vi.advanceTimersByTimeAsync(100);
  expect(screenshots).toEqual([]);
  notices = [{ bounds: fullyInView, text: capture.notice }];
  await vi.advanceTimersByTimeAsync(100);
  await outcome;
  expect(screenshots).toEqual([capture.path]);
});
