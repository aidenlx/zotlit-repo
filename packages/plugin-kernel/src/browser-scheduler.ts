import { MixedScheduler } from "effect/Scheduler";

export function scheduleBrowserTask(task: () => void): () => void {
  const { port1, port2 } = new MessageChannel();
  const close = () => {
    port1.onmessage = null;
    port1.close();
    port2.close();
  };
  port1.onmessage = () => {
    close();
    task();
  };
  port2.postMessage(null);
  return close;
}

export const browserScheduler = new MixedScheduler(
  "async",
  scheduleBrowserTask,
);
