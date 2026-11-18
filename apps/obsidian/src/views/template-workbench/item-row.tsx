// The Template Workbench View's one item row: above the panels, it names the
// data the Fields Panel, the editor and the Preview Panel all read, beside the
// one control that chooses other data.
import { useAtomValue } from "@effect/atom-react";

import { citationExampleLabel, ItemRow } from "@zotlit/workbench/ui";

import { Icon } from "@/components/obsidian/icon.tsx";
import { selectionControl } from "@/components/obsidian/selection-control.ts";
import * as m from "@/lib/i18n/generated/messages.ts";
import { cn, tooltipAttrs } from "@/lib/utils.ts";

import { previewTarget } from "./preview-panel.tsx";
import { selectionName } from "./selection.tsx";
import type { TemplateWorkbenchView } from "./view.tsx";

/** The chooser keeps its width beside the name, which gives way first. */
const trigger = cn(selectionControl({ kind: "trigger" }), "zt:shrink-0");

export function ViewItemRow({ view }: { view: TemplateWorkbenchView }) {
  const { workbench, model } = view;
  const kind = useAtomValue(workbench.document.kind);
  const root = useAtomValue(workbench.root);
  const item = useAtomValue(workbench.item);
  const title = useAtomValue(model.title);
  const { example } = useAtomValue(workbench.examples);
  const { citationExample } = useAtomValue(workbench.choices);
  // A partial reads the data its chosen caller reads.
  const { citationSet, annotationMode } = previewTarget(kind, root);
  const name = citationSet
    ? citationExample === null
      ? title
      : // A built-in set reads as an example, as a built-in Item does.
        m.workbench_example_title({
          name: citationExampleLabel(m, citationExample),
        })
    : selectionName({
        item: item && { id: item.id, title },
        annotation: example,
        annotationMode,
      });
  return (
    <ItemRow
      label={
        // A name the row cuts short shows in full on hover.
        name && <span {...tooltipAttrs(name)}>{name}</span>
      }
    >
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
