import { logger as appLogger } from "@/lib/logger.ts";

import { registerActiveReaderNotify } from "./active-reader.ts";
import { registerAnnotSelectNotify } from "./annot-select.ts";
import { registerFreshness } from "./freshness.ts";
import type { WalCheckpoint } from "./freshness.ts";
import { createSender } from "./send.ts";

const logger = appLogger.getChild("notify");

export interface Notify extends Disposable {
  checkpoint: WalCheckpoint;
}

export async function registerNotify(): Promise<Notify> {
  logger.info("registering notify");
  using stack = new DisposableStack();
  const send = createSender();
  stack.use(registerActiveReaderNotify(send));
  stack.use(registerAnnotSelectNotify(send));
  const checkpoint = stack.use(await registerFreshness(send));
  stack.defer(() => {
    logger.info("notify torn down");
  });
  logger.info("notify registered");
  const disposable = stack.move();
  return {
    checkpoint,
    [Symbol.dispose]() {
      disposable[Symbol.dispose]();
    },
  };
}
