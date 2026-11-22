import { useAtomValue } from "@effect/atom-react";

import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { selectionControl } from "@zotlit/obsidian-kit/components/obsidian/selection-control.ts";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { previewTarget } from "./preview-panel.tsx";
import type { TemplateWorkbenchView } from "./view.tsx";

import { selectionName } from "#obsidian/editor/selection.tsx";
import {
  citationExampleLabel,
  ItemRow,
} from "#obsidian/workbench-ui/index.tsx";

const trigger = cn(selectionControl({ kind: "trigger" }), "zt:shrink-0");

export function ViewItemRow({ view }: { view: TemplateWorkbenchView }) {
  const { workbench, model } = view;
  const kind = useAtomValue(workbench.document.kind);
  const root = useAtomValue(workbench.root);
  const item = useAtomValue(workbench.item);
  const title = useAtomValue(model.title);
  const { example } = useAtomValue(workbench.examples);
  const { citationExample } = useAtomValue(workbench.choices);
  const { citationSet, annotationMode } = previewTarget(kind, root);
  const name = citationSet
    ? citationExample === null
      ? title
      : m.workbench_example_title({
          name: citationExampleLabel(citationExample),
        })
    : selectionName({
        item: item && { id: item.id, title },
        annotation: example,
        annotationMode,
      });
  return (
    <ItemRow label={name && <span {...tooltipAttrs(name)}>{name}</span>}>
      <button
        type="button"
        className={trigger}
        onClick={() =>
          annotationMode ? view.startAnnotationChoice() : view.startItemChoice()
        }
      >
        <Icon name="search" />
        <span>
          {annotationMode
            ? m.workbench_choose_annotation()
            : m.workbench_choose_item()}
        </span>
      </button>
    </ItemRow>
  );
}
