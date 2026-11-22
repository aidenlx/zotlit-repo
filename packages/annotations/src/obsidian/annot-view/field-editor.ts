import type {
  CommentEdit,
  CommentFormat,
} from "#core/annot-view/comment-format.ts";
import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import {
  Annotation,
  Compartment,
  EditorState,
  Transaction,
} from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import type { Range } from "@codemirror/state";
import { Decoration, EditorView, keymap, placeholder } from "@codemirror/view";
import { Effect } from "effect";
import { Menu, Scope } from "obsidian";
import type { App, ExtendedHotkey } from "obsidian";

import { overlapsSelection } from "@zotlit/obsidian-kit/editor-decoration.ts";
import {
  menuEvent,
  menuSections,
  raiseMenu,
} from "@zotlit/obsidian-kit/menu-events.ts";
import {
  logServices,
  withLogCategory,
} from "@zotlit/plugin-kernel/effect-log.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";

import type { EditorSurface } from "./editor-sheet.ts";

import {
  activeFormats,
  clearFormatting,
  htmlToComment,
  parseComment,
  toggleFormat,
} from "#core/annot-view/comment-format.ts";

declare module "@zotlit/obsidian-kit/menu-events.ts" {
  interface ZotLitMenuEvents {
    "zotlit:comment-editor-menu": {
      surface: EditorSurface;
      editor: EditorView;
    };
  }
}

const commentEditorMenu = menuEvent("zotlit:comment-editor-menu", [
  "selection",
  "clipboard",
  "",
]);

const SECTION = menuSections(commentEditorMenu);

export interface FieldEditorWording {
  placeholder: string;
  label: string;
}

export interface FieldEditorOptions {
  app: App;
  parent: HTMLElement;
  surface: EditorSurface;
  wording: FieldEditorWording;
  text: string;
  readOnly: boolean;
  onChange: (text: string) => void;
  onEscape: () => void;
  onSubmit: () => void;
  onBlur: (next: Node | null) => void;
}

export interface FieldEditor extends Disposable {
  readonly view: EditorView;
  setText(text: string): void;
  setReadOnly(readOnly: boolean): void;
}

let labelSerial = 0;

const external = Annotation.define<boolean>();

export function createFieldEditor(opts: FieldEditorOptions): FieldEditor {
  const readOnly = new Compartment();
  let menuOpen = false;
  let scope: Scope | null = null;
  const releaseKeys = (): void => {
    if (scope) opts.app.keymap.popScope(scope);
    scope = null;
  };

  const label = opts.parent.createSpan({
    cls: "zt:sr-only",
    text: opts.wording.label,
    attr: { id: `zt-field-editor-label-${++labelSerial}` },
  });
  const view = new EditorView({
    parent: opts.parent,
    state: EditorState.create({
      doc: opts.text,
      extensions: [
        readOnly.of(EditorState.readOnly.of(opts.readOnly)),
        history(),
        keymap.of([
          {
            key: "Escape",
            run: () => {
              opts.onEscape();
              return true;
            },
          },
          ...historyKeymap,
          ...defaultKeymap,
        ]),
        EditorView.lineWrapping,
        placeholder(opts.wording.placeholder),
        EditorView.contentAttributes.of({ "aria-labelledby": label.id }),
        commentDecorations,
        commentTheme,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          if (update.transactions.every((tr) => tr.annotation(external)))
            return;
          opts.onChange(update.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          paste: (event, v) => pasteHtml(event, v),
          focus: (_event, v) => {
            releaseKeys();
            scope = editorKeyScope(opts.app, {
              submit: opts.onSubmit,
              toggle: (format) => toggle(v, format),
            });
            opts.app.keymap.pushScope(scope);
          },
          blur: (event) => {
            releaseKeys();
            if (!menuOpen) opts.onBlur(event.relatedTarget as Node | null);
          },
          contextmenu: (event, v) => {
            event.preventDefault();
            const menu = new Menu();
            fillCommentMenu(menu, v);
            raiseMenu(menu, {
              workspace: opts.app.workspace,
              event: commentEditorMenu,
              info: {
                surface: opts.surface,
                editor: v,
              },
            });
            menu.setParentElement(v.dom);
            menuOpen = true;
            menu.onHide(() => {
              menuOpen = false;
              v.focus();
            });
            if (event.clientX === 0 && event.clientY === 0) {
              const caret = v.coordsAtPos(v.state.selection.main.head);
              menu.showAtPosition(
                { x: caret?.left ?? 0, y: caret?.bottom ?? 0 },
                v.dom.doc,
              );
            } else {
              menu.showAtMouseEvent(event);
            }
            return true;
          },
        }),
      ],
    }),
  });

  return {
    view,
    setText(text) {
      const edit = diff(view.state.doc.toString(), text);
      if (!edit) return;
      view.dispatch({
        changes: edit,
        annotations: [external.of(true), Transaction.addToHistory.of(false)],
      });
    },
    setReadOnly(value) {
      view.dispatch({
        effects: readOnly.reconfigure(EditorState.readOnly.of(value)),
      });
    },
    [Symbol.dispose]() {
      releaseKeys();
      view.destroy();
      label.remove();
    },
  };
}

const FORMAT_COMMANDS: Record<string, CommentFormat> = {
  "editor:toggle-bold": "b",
  "editor:toggle-italics": "i",
};

function editorKeyScope(
  app: App,
  run: { submit: () => void; toggle: (format: CommentFormat) => void },
): Scope {
  const scope = new Scope(app.scope);
  scope.register(["Mod"], "Enter", () => {
    run.submit();
    return false;
  });
  for (const [id, command] of Object.entries(app.commands.editorCommands)) {
    if (!command.editorCallback && !command.editorCheckCallback) continue;
    const format = FORMAT_COMMANDS[id];
    const hotkeys =
      app.hotkeyManager.getHotkeys(id) ??
      app.hotkeyManager.getDefaultHotkeys(id) ??
      [];
    for (const hotkey of hotkeys) {
      scope.register(hotkey.modifiers, hotkeyKey(hotkey), () => {
        if (!format) return true;
        run.toggle(format);
        return false;
      });
    }
  }
  return scope;
}

function hotkeyKey(hotkey: ExtendedHotkey): string {
  const { code } = hotkey;
  if (!code) return hotkey.key;
  return code.startsWith("Key") && code.length === 4 ? code.charAt(3) : code;
}

const FORMAT_SECTION = { basic: "basic", danger: "danger" } as const;

function fillCommentMenu(menu: Menu, view: EditorView): void {
  const { state } = view;
  const { from, to } = state.selection.main;
  const editable = !state.readOnly;
  const active = activeFormats(state.doc.toString(), from, to);

  menu.addItem((item) => {
    item
      .setSection(SECTION.selection)
      .setTitle(m.comment_editor_format())
      .setIcon("lucide-paintbrush")
      .setDisabled(!editable);
    const sub = item.setSubmenu().addSections(Object.values(FORMAT_SECTION));
    for (const { format, title, icon } of FORMAT_ITEMS) {
      sub.addItem((entry) =>
        entry
          .setSection(FORMAT_SECTION.basic)
          .setTitle(title())
          .setIcon(icon)
          .setChecked(active.has(format))
          .onClick(() => {
            toggle(view, format);
          }),
      );
    }
    sub.addItem((entry) =>
      entry
        .setSection(FORMAT_SECTION.danger)
        .setTitle(m.comment_editor_clear_formatting())
        .setIcon("lucide-eraser")
        .onClick(() => apply(view, clearFormatting(docOf(view), selOf(view)))),
    );
  });

  const selected = from !== to;
  const clipboard: {
    title: string;
    icon: string;
    enabled: boolean;
    run: () => Promise<void>;
  }[] = [
    {
      title: m.comment_editor_cut(),
      icon: "lucide-scissors",
      enabled: selected && editable,
      run: async () => {
        await navigator.clipboard.writeText(state.sliceDoc(from, to));
        view.dispatch({
          changes: { from, to },
          selection: { anchor: from },
          userEvent: "delete.cut",
        });
      },
    },
    {
      title: m.comment_editor_copy(),
      icon: "lucide-copy",
      enabled: selected,
      run: () => navigator.clipboard.writeText(state.sliceDoc(from, to)),
    },
    {
      title: m.comment_editor_paste(),
      icon: "lucide-clipboard-check",
      enabled: editable,
      run: async () => insert(view, await readClipboard(true), "input.paste"),
    },
    {
      title: m.comment_editor_paste_plain(),
      icon: "lucide-clipboard-type",
      enabled: editable,
      run: async () => insert(view, await readClipboard(false), "input.paste"),
    },
  ];
  for (const { title, icon, enabled, run } of clipboard) {
    menu.addItem((item) =>
      item
        .setSection(SECTION.clipboard)
        .setTitle(title)
        .setIcon(icon)
        .setDisabled(!enabled)
        .onClick(() => {
          run().catch((error: unknown) =>
            Effect.runSyncWith(logServices)(
              Effect.logWarning("Comment editor clipboard action failed").pipe(
                Effect.annotateLogs({ error }),
                withLogCategory("views", "annot-view"),
              ),
            ),
          );
        }),
    );
  }
  menu.addItem((item) =>
    item
      .setSection(SECTION.clipboard)
      .setTitle(m.comment_editor_select_all())
      .setIcon("lucide-box-select")
      .onClick(() =>
        view.dispatch({ selection: { anchor: 0, head: state.doc.length } }),
      ),
  );
}

const FORMAT_ITEMS: {
  format: CommentFormat;
  title: () => string;
  icon: string;
}[] = [
  { format: "b", title: m.comment_editor_bold, icon: "lucide-bold" },
  { format: "i", title: m.comment_editor_italic, icon: "lucide-italic" },
  {
    format: "sub",
    title: m.comment_editor_subscript,
    icon: "lucide-subscript",
  },
  {
    format: "sup",
    title: m.comment_editor_superscript,
    icon: "lucide-superscript",
  },
];

function toggle(view: EditorView, format: CommentFormat): boolean {
  if (view.state.readOnly) return false;
  apply(view, toggleFormat(docOf(view), selOf(view), format));
  return true;
}

const docOf = (view: EditorView): string => view.state.doc.toString();
const selOf = (view: EditorView) => {
  const { anchor, head } = view.state.selection.main;
  return { anchor, head };
};

function apply(view: EditorView, edit: CommentEdit): void {
  view.dispatch({
    changes: diff(docOf(view), edit.text) ?? [],
    selection: { anchor: edit.anchor, head: edit.head },
    userEvent: "input.format",
  });
  view.focus();
}

function insert(view: EditorView, text: string, userEvent: string): void {
  view.dispatch(view.state.replaceSelection(text), { userEvent });
  view.focus();
}

function pasteHtml(event: ClipboardEvent, view: EditorView): boolean {
  const html = event.clipboardData?.getData("text/html");
  if (!html || view.state.readOnly) return false;
  event.preventDefault();
  insert(view, parseHtml(html), "input.paste");
  return true;
}

async function readClipboard(rich: boolean): Promise<string> {
  if (rich) {
    try {
      for (const item of await navigator.clipboard.read()) {
        if (!item.types.includes("text/html")) continue;
        const blob = await item.getType("text/html");
        return parseHtml(await blob.text());
      }
    } catch (error) {
      Effect.runSyncWith(logServices)(
        Effect.logDebug("Rich clipboard read failed; pasting plain text").pipe(
          Effect.annotateLogs({
            error,
          }),
          withLogCategory("views", "annot-view"),
        ),
      );
    }
  }
  return navigator.clipboard.readText();
}

function parseHtml(html: string): string {
  const parser = new DOMParser();
  return htmlToComment(parser.parseFromString(html, "text/html").body);
}

function diff(from: string, to: string) {
  if (from === to) return null;
  let start = 0;
  while (start < from.length && start < to.length && from[start] === to[start])
    start++;
  let end = 0;
  while (
    end < from.length - start &&
    end < to.length - start &&
    from[from.length - 1 - end] === to[to.length - 1 - end]
  )
    end++;
  return {
    from: start,
    to: from.length - end,
    insert: to.slice(start, to.length - end),
  };
}

const FORMAT_MARKS: Record<CommentFormat, Decoration> = {
  b: Decoration.mark({ tagName: "b" }),
  i: Decoration.mark({ tagName: "i" }),
  sub: Decoration.mark({ tagName: "sub" }),
  sup: Decoration.mark({ tagName: "sup" }),
};
const SHOWN_TAG = Decoration.mark({ class: "zt:text-faint" });
const HIDDEN_TAG = Decoration.replace({});

const commentDecorations: Extension = EditorView.decorations.compute(
  ["doc", "selection"],
  (state) => {
    const ranges = state.selection.ranges;
    const decorations: Range<Decoration>[] = [];
    for (const span of parseComment(state.doc.toString())) {
      if (span.contentTo > span.contentFrom) {
        decorations.push(
          FORMAT_MARKS[span.format].range(span.contentFrom, span.contentTo),
        );
      }
      const tag = overlapsSelection(ranges, span.from, span.to)
        ? SHOWN_TAG
        : HIDDEN_TAG;
      decorations.push(
        tag.range(span.from, span.contentFrom),
        tag.range(span.contentTo, span.to),
      );
    }
    return Decoration.set(decorations, true);
  },
);

const commentTheme = EditorView.theme({
  "&": { fontSize: "inherit" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "inherit" },
  ".cm-content": { padding: "0", caretColor: "var(--caret-color)" },
  ".cm-line": { padding: "0" },
  ".cm-placeholder": { color: "var(--text-faint)" },
});
