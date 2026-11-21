import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { SuggestModal } from "@zotlit/obsidian-kit/__mocks__/obsidian.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import { annotationSamples } from "./annotation-samples.ts";
import {
  AnnotationPane,
  AnnotationSampleBar,
  annotationOption,
} from "./annotation.tsx";
import { WorkbenchHostProvider } from "./host.tsx";
import { SampleSuggester } from "./sample-suggester.tsx";
import {
  fakeHost,
  renderInApp as render,
  watchChoosers,
} from "./test-host.tsx";

import { WorkbenchDocumentController } from "#core/document/controller.ts";
import { DEFAULT_PROFILE_SOURCE } from "#core/render/default-profile.ts";
import { SAMPLE_ANNOTATIONS, SAMPLE_ITEMS } from "#core/render/index.ts";

afterEach(cleanup);

it("repairs a missing section and edits only its format through the master history", () => {
  const source = DEFAULT_PROFILE_SOURCE.slice(
    0,
    DEFAULT_PROFILE_SOURCE.indexOf("--- zotlit:annotation ---"),
  );
  const controller = new WorkbenchDocumentController(source);
  const { container } = render(
    <AnnotationPane controller={controller} problem={null} />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_section_repair() }),
  );
  const view = EditorView.findFromDOM(container.querySelector(".cm-editor")!)!;
  act(() =>
    view.dispatch({
      changes: { from: 0, insert: "{{ zt.comment }}" },
      userEvent: "input.type",
    }),
  );
  expect(controller.source).toBe(
    `${source}--- zotlit:annotation ---\n{{ zt.comment }}`,
  );
  act(() => {
    controller.undo();
    controller.undo();
  });
  expect(controller.source).toBe(source);
  expect(
    screen.getByRole("button", { name: m.workbench_section_repair() }),
  ).toBeTruthy();
});

/** The row of `modal` that stands for `id`, drawn as the list draws it. */
function drawnRow(
  modal: ReturnType<typeof watchChoosers>["last"],
  id: string,
): HTMLElement {
  const option = modal.getSuggestions("").find((row) => row.id === id)!;
  const el = document.createElement("div");
  modal.renderSuggestion(option, el);
  return el;
}

it("opens the annotation chooser with current annotations first, then the samples", async () => {
  using choosers = watchChoosers();
  const selected = vi.fn<(id: string) => void>();
  const example = SAMPLE_ANNOTATIONS[0]!;
  render(
    <AnnotationSampleBar current={[]} example={example} onSelect={selected} />,
  );
  const trigger = screen.getByRole("button", {
    name: m.workbench_choose_annotation(),
  });
  expect(screen.getByText(annotationOption(example).label)).toBeTruthy();
  await act(async () => {
    fireEvent.click(trigger);
  });
  const modal = choosers.last;
  const rows = modal.getSuggestions("");
  expect(rows.map((row) => row.id)).toEqual(
    SAMPLE_ANNOTATIONS.map((option) => option.id),
  );
  expect(new Set(rows.map((row) => row.group))).toEqual(
    new Set([m.workbench_sample_examples()]),
  );
  expect(drawnRow(modal, example.id).getAttribute("aria-current")).toBe("true");
  await act(async () =>
    modal.selectSuggestion(
      rows.find((row) => row.id === SAMPLE_ANNOTATIONS[1]!.id)!,
      { type: "click" } as MouseEvent,
    ),
  );
  expect(selected).toHaveBeenCalledWith(SAMPLE_ANNOTATIONS[1]!.id);
  // Closing the chooser gives the focus back to the control that opened it.
  expect(document.activeElement).toBe(trigger);
});

it.each(["compact", "hideLabel"] as const)(
  "opens the same annotation choices from a %s native trigger without repeating its label",
  async (prop) => {
    using choosers = watchChoosers();
    const example = SAMPLE_ANNOTATIONS[0]!;
    const selected = vi.fn<(id: string) => void>();
    render(
      <AnnotationSampleBar
        {...{ [prop]: true }}
        current={[example]}
        example={example}
        onSelect={selected}
      />,
    );
    expect(screen.queryByText(annotationOption(example).label)).toBeNull();
    const trigger = screen.getByRole("button", {
      name: m.workbench_change_annotation(),
    });
    await act(async () => fireEvent.click(trigger));
    const modal = choosers.last;
    const rows = modal.getSuggestions("");
    expect(rows[0]).toMatchObject({
      id: example.id,
      label: annotationOption(example).label,
      hint: annotationOption(example).description,
    });
    expect(drawnRow(modal, example.id).getAttribute("aria-current")).toBe(
      "true",
    );
    await act(async () =>
      modal.selectSuggestion(
        rows.find((row) => row.id === SAMPLE_ANNOTATIONS[1]!.id)!,
        { type: "click" } as MouseEvent,
      ),
    );
    expect(selected).toHaveBeenCalledWith(SAMPLE_ANNOTATIONS[1]!.id);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  },
);

it("keeps a compact annotation selection when its chooser is dismissed", async () => {
  using choosers = watchChoosers();
  const selected = vi.fn<(id: string) => void>();
  render(
    <AnnotationSampleBar
      compact
      current={[]}
      example={null}
      onSelect={selected}
    />,
  );
  const trigger = screen.getByRole("button", {
    name: m.workbench_choose_annotation(),
  });
  await act(async () => fireEvent.click(trigger));
  await act(async () => choosers.last.close());
  expect(selected).not.toHaveBeenCalled();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("keeps Item selection unchanged when its chooser is dismissed", async () => {
  using choosers = watchChoosers();
  const select = vi.fn<(id: string) => void>();
  render(
    <SampleSuggester
      title="Choose Item"
      label="Item A"
      selected="a"
      groups={[
        {
          heading: "Items",
          options: [{ value: "a", label: "Item A", description: "Author A" }],
        },
      ]}
      onSelect={select}
    />,
  );
  const trigger = screen.getByRole("button", { name: "Choose Item" });
  await act(async () => {
    fireEvent.click(trigger);
  });
  await act(async () => choosers.last.close());
  expect(select).not.toHaveBeenCalled();
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(trigger.getAttribute("aria-label")).toBe("Choose Item");
});

it("draws the Item chooser alone where a row names the Item beside it", () => {
  const { container } = render(
    <WorkbenchHostProvider host={fakeHost()}>
      <SampleSuggester
        title="Choose Item"
        selected="a"
        groups={[
          {
            heading: "Items",
            options: [{ value: "a", label: "Item A", description: "Author A" }],
          },
        ]}
        onSelect={() => {}}
      />
    </WorkbenchHostProvider>,
  );
  const trigger = screen.getByRole("button", { name: "Choose Item" });
  expect(container.firstElementChild).toBe(trigger);
  expect(container.textContent).not.toContain("Item A");
});

it("keeps bundled annotation identity when the Item changes and current identity when reordered", () => {
  const bundled = SAMPLE_ANNOTATIONS[2]!;
  expect(annotationSamples(SAMPLE_ITEMS[0]!, bundled.id).example).toBe(bundled);
  expect(annotationSamples(SAMPLE_ITEMS[1]!, bundled.id).example).toBe(bundled);
  const original = SAMPLE_ITEMS.find(
    (item) => item.roots.annotations.length > 0,
  )!;
  const sample = {
    ...original,
    roots: {
      ...original.roots,
      annotations: [
        original.roots.annotations[0]!,
        { ...original.roots.annotations[0]!, indexedKey: "second" },
      ],
    },
    descriptors: {
      ...original.descriptors,
      annotations: [
        original.descriptors.annotations[0]!,
        original.descriptors.annotations[0]!,
      ],
    },
  };
  const selection = annotationSamples(sample, null).current[1]!;
  const reordered = {
    ...sample,
    roots: {
      ...sample.roots,
      annotations: sample.roots.annotations.toReversed(),
    },
    descriptors: {
      ...sample.descriptors,
      annotations: sample.descriptors.annotations.toReversed(),
    },
  };
  expect(
    annotationSamples(reordered, selection.id).example.root.indexedKey,
  ).toBe(selection.root.indexedKey);
  expect(annotationSamples(reordered, selection.id).example.descriptors).toBe(
    selection.descriptors,
  );
});

it("uses distinct problem descriptions per pane", () => {
  const { container } = render(
    <>
      {[1, 2].map((id) => (
        <AnnotationPane
          key={id}
          controller={new WorkbenchDocumentController(DEFAULT_PROFILE_SOURCE)}
          problem="Format problem"
        />
      ))}
    </>,
  );
  const problems = [...container.querySelectorAll('[role="status"]')];
  expect(new Set(problems.map((p) => p.id)).size).toBe(2);
  expect(
    [...container.querySelectorAll(".cm-content")].map((p) =>
      p.getAttribute("aria-describedby"),
    ),
  ).toEqual(problems.map((p) => p.id));
});

it("repairs a missing section without inserting a note call", () => {
  const source = DEFAULT_PROFILE_SOURCE.replace(
    "{% for annotation in zt.annotations %}\n{% render_annotation annotation %}\n{% endfor %}\n",
    "",
  );
  const silent = source.slice(0, source.indexOf("--- zotlit:annotation ---"));
  const controller = new WorkbenchDocumentController(silent);
  render(
    <WorkbenchHostProvider host={fakeHost()}>
      <AnnotationPane controller={controller} problem={null} />
    </WorkbenchHostProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", { name: m.workbench_section_repair() }),
  );
  expect(controller.source).toBe(`${silent}--- zotlit:annotation ---\n`);
  expect(controller.source).not.toContain("render_annotation");
  expect(
    screen.getByRole("textbox", { name: m.workbench_annotation_label() }),
  ).toBeDefined();
});

it("edits the annotation format without a note call and leaves the rest of the Profile unchanged", () => {
  const source = DEFAULT_PROFILE_SOURCE.replace(
    "{% for annotation in zt.annotations %}\n{% render_annotation annotation %}\n{% endfor %}\n",
    "",
  );
  const controller = new WorkbenchDocumentController(source);
  const { container } = render(
    <WorkbenchHostProvider host={fakeHost()}>
      <AnnotationPane controller={controller} problem={null} />
    </WorkbenchHostProvider>,
  );
  const format = EditorView.findFromDOM(
    container.querySelector(".cm-editor")!,
  )!;
  act(() =>
    format.dispatch({
      changes: {
        from: 0,
        to: format.state.doc.length,
        insert: "Example: {{ zt.text }}",
      },
      userEvent: "input.type",
    }),
  );
  expect(controller.source).toBe(
    `${source.slice(0, source.indexOf("--- zotlit:annotation ---"))}--- zotlit:annotation ---\nExample: {{ zt.text }}`,
  );
  act(() => {
    controller.undo();
  });
  expect(controller.source).toBe(source);
});

it("offers annotation examples before an annotation has been selected", async () => {
  using choosers = watchChoosers();
  const selected = vi.fn<(id: string) => void>();
  render(
    <AnnotationSampleBar current={[]} example={null} onSelect={selected} />,
  );
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: m.workbench_choose_annotation() }),
    );
  });
  const modal = choosers.last;
  const rows = modal.getSuggestions("");
  expect(rows.map((row) => row.id)).toEqual(
    SAMPLE_ANNOTATIONS.map((option) => option.id),
  );
  expect(
    rows.map((row) => drawnRow(modal, row.id).getAttribute("aria-current")),
  ).toEqual(rows.map(() => null));
  await act(async () =>
    modal.selectSuggestion(rows[1]!, { type: "click" } as MouseEvent),
  );
  expect(selected).toHaveBeenCalledWith(SAMPLE_ANNOTATIONS[1]!.id);
});

it("closes a chooser it opened when the sample bar goes", async () => {
  using choosers = watchChoosers();
  using close = vi.spyOn(SuggestModal.prototype, "close");
  const selected = vi.fn<(id: string) => void>();
  const { unmount } = render(
    <AnnotationSampleBar current={[]} example={null} onSelect={selected} />,
  );
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: m.workbench_choose_annotation() }),
    ),
  );
  expect(choosers.opened).toBe(1);

  act(() => unmount());

  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(selected).not.toHaveBeenCalled();
});
