import { logger as appLogger } from "@/lib/logger.ts";

import { registerCollectionMenu } from "./collection.ts";
import { registerItemMenu } from "./item.ts";
import { registerReaderAnnotationMenu } from "./reader-annotation.ts";
import { registerReaderPageMenu } from "./reader-page.ts";

const logger = appLogger.getChild("menus");

/**
 * Register all menu surfaces. Returns an {@link AsyncDisposable} that
 * unregisters them in LIFO order on shutdown — important for RDP dev
 * reloads where pluginID-scoped auto-cleanup would otherwise leave stale
 * registrations until full plugin teardown.
 */
export async function registerMenus(
  pluginID: string,
): Promise<AsyncDisposable> {
  logger.info("registering menus", { pluginID });
  await using stack = new AsyncDisposableStack();
  stack.use(registerItemMenu(pluginID));
  stack.use(registerCollectionMenu(pluginID));
  stack.use(await registerReaderAnnotationMenu(pluginID));
  stack.use(await registerReaderPageMenu(pluginID));
  stack.defer(() => {
    logger.info("menus torn down");
  });
  logger.info("menus registered");
  return stack.move();
}
