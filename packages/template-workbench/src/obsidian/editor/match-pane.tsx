import type { WorkbenchDocumentController } from "#core/document/index.ts";
import { useAtomValue } from "@effect/atom-react";

import { zoteroRevisionAtom } from "@zotlit/zotero-reads/client/atoms.ts";

import { MatchPane } from "#obsidian/workbench-ui/index.tsx";

export function ViewMatchPane({
  controller,
  onChooseItem,
}: {
  controller: WorkbenchDocumentController;
  onChooseItem?: () => void;
}) {
  const vocabularyRevision = useAtomValue(zoteroRevisionAtom);
  return (
    <MatchPane
      onChooseItem={onChooseItem}
      controller={controller}
      vocabularyRevision={vocabularyRevision}
    />
  );
}
