import { formatObjectKeys, identityForObject } from "@/lib/indexed-key.ts";
import { logger as appLogger } from "@/lib/logger.ts";

const logger = appLogger.getChild(["menus", "copy-key"]);

type KeyedObject = Pick<Zotero.Item, "key" | "libraryID">;

export function copyObjectKeys(objects: KeyedObject[]): void {
  const identities = objects
    .map((object) => identityForObject(object))
    .filter((identity) => identity !== null);
  if (identities.length === 0) {
    logger.error("no selected object carries an Indexed Key", {
      count: objects.length,
    });
    return;
  }
  Zotero.Utilities.Internal.copyTextToClipboard(formatObjectKeys(identities));
}
