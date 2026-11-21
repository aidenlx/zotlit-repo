// The expression input of a Match condition and of a Formula: a small
// CodeMirror editor that colors its Filter Expression as the template panes
// color theirs, and underlines its Syntax Fault, else the Fault a run found.

import type { ExpressionVocabulary } from "#core/language/filter-expression-completion.ts";
import type { PlacedFault } from "#core/language/span.ts";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { setDiagnostics, setDiagnosticsEffect } from "@codemirror/lint";
import type { Diagnostic } from "@codemirror/lint";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder as placeholderText,
} from "@codemirror/view";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { parseExpression } from "@zotlit/filter-expression";
import { useObsidianApp } from "@zotlit/obsidian-kit/app-context.ts";
import { cn } from "@zotlit/obsidian-kit/utils.ts";
import { themeHook } from "@zotlit/plugin-kernel/theme-hooks.ts";
import { useUniqueId } from "@zotlit/ui";

import { HiddenName } from "./host.tsx";
import { editorBox } from "./look.ts";
import { underlineOnlyLint } from "./underline-lint.ts";

import { nativeCompletion } from "#core/editor/native-completion.ts";
import { filterExpressionCompletion } from "#core/language/filter-expression-completion.ts";
import {
  filterExpressionHighlighting,
  filterExpressionLanguage,
  filterExpressionPairing,
} from "#core/language/filter-expression.ts";
import { expressionOption } from "#core/language/index.ts";
import { signatureHint } from "#core/language/signature-hint-tooltip.ts";
import {
  hostedEditor,
  popoverTooltips,
} from "#obsidian/editor/editor-extension.ts";
import { obsidianPopupKeys } from "#obsidian/editor/field-popup.ts";

// A CodeMirror field drawn as an Obsidian text input, at least as tall
// as one; the editor hook scopes the template token colors to it.
const matchExpression = cn(
  themeHook.templateEditor,
  editorBox,
  "zt:min-h-(--input-height) zt:w-full zt:min-w-0 zt:cursor-text zt:font-mono zt:text-sm zt:leading-normal zt:[transition:var(--input-transition)]",
  "zt:hover:bg-(--background-modifier-form-field-hover) zt:not-focus-within:not-has-[[aria-invalid=true]]:hover:border-border-hover zt:has-[[aria-invalid=true]]:border-(--text-error)",
  "zt:[&_.cm-placeholder]:text-(--text-faint)",
);

/**
 * The label and validity of the field, on its editable content. The label
 * is a hidden element the content points at, so the text takes no tooltip.
 */
const contentAttributes = ({
  label,
  labelId,
  invalid,
}: {
  label: string | undefined;
  labelId: string;
  invalid: boolean;
}) =>
  EditorView.contentAttributes.of({
    "aria-invalid": String(invalid),
    ...(label === undefined ? {} : { "aria-labelledby": labelId }),
  });

/** Expression Completion over the vocabulary the field holds now. */
const completionOf = (props: {
  readonly current: { vocabulary?: ExpressionVocabulary };
}) =>
  filterExpressionCompletion(
    () => props.current.vocabulary,
    nativeCompletion(expressionOption),
  );

/** Marks the edit that brings in a new `value`, which is not the user's. */
const fromValue = Annotation.define<true>();

/**
 * What the field underlines in `text`: its Syntax Fault, else the run's
 * Fault while `text` is the text that run planned.
 */
function underlines(
  text: string,
  fault: PlacedFault | undefined,
): Diagnostic[] {
  const { error } = parseExpression(text);
  const span = error ? error.span : fault?.text === text ? fault.span : null;
  return span ? [{ ...span, message: "", severity: "error" }] : [];
}

export interface MatchExpressionInputProps {
  value: string;
  /**
   * Where the last run found a Fault, which the field underlines while its
   * text is the text that run planned. The field underlines its own Syntax
   * Fault first. The owner's status line reports both; the field shows no
   * tooltip over them.
   */
  fault?: PlacedFault;
  /**
   * Each edit, with the window the field is in. The owner gives a text it
   * keeps back as `value` in the render the edit causes; a `value` that
   * differs from the field's text then replaces it.
   */
  onChange: (text: string, win: Window) => void;
  onBlur?: () => void;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  placeholder?: string;
  /** The lines the field shows before it grows with its text. */
  lines?: number;
  /**
   * What the field can read, read per keystroke: Expression Completion
   * offers its names, and the Signature Hint types a method call's receiver
   * by it. A field without one offers no completion, and its Signature Hint
   * names every definition of a method.
   */
  vocabulary?: ExpressionVocabulary;
}

/**
 * A Filter Expression field. The `data-*` attributes go on its `expression`
 * part. The editor draws no focus outline and no padding, so the part owns
 * both: it must show `:focus-within`. The part also sets the box height: a
 * part as tall as Obsidian's text inputs reads like one, as the editor stands
 * at its vertical centre while the text is shorter than the box.
 */
export function MatchExpressionInput({
  value,
  fault,
  onChange,
  onBlur,
  "aria-label": label,
  "aria-invalid": invalid = false,
  placeholder,
  lines = 1,
  vocabulary,
  ...data
}: MatchExpressionInputProps & Partial<Record<`data-${string}`, string>>) {
  const app = useObsidianApp();
  // The editor draws in its own window and over the chooser page or popover it
  // stands in, and its popup keys sit on the keymap as Obsidian's suggesters
  // take them. One extension per app, so a render hands the editor the same.
  const hostExtension = useMemo(
    () => [hostedEditor, popoverTooltips, obsidianPopupKeys(app)],
    [app],
  );
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const labelId = useUniqueId();
  // The editor is made once; it reads what it needs then, and later props,
  // through this ref.
  const props = useRef({
    value,
    onChange,
    onBlur,
    label,
    labelId,
    invalid,
    placeholder,
    lines,
    hostExtension,
    vocabulary,
    fault,
  });
  props.current = {
    value,
    onChange,
    onBlur,
    label,
    labelId,
    invalid,
    placeholder,
    lines,
    hostExtension,
    vocabulary,
    fault,
  };
  const attributes = useRef(new Compartment());
  const completer = useRef(new Compartment());
  // The vocabulary is read per keystroke, so only its arrival or its leaving
  // changes the editor; the editor starts with what this holds.
  const completes = vocabulary !== undefined;
  const completing = useRef(completes);
  useEffect(() => {
    const { value, placeholder, lines, hostExtension } = props.current;
    const parent = host.current!;
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          filterExpressionLanguage,
          filterExpressionHighlighting,
          filterExpressionPairing,
          signatureHint({
            receiver: (source, at) =>
              props.current.vocabulary?.receiver?.(source, at),
          }),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          underlineOnlyLint,
          // Each edit underlines its own text, so no underline is carried to
          // a text it was not found in.
          EditorState.transactionExtender.of((tr) =>
            tr.docChanged
              ? {
                  effects: setDiagnosticsEffect.of(
                    underlines(tr.newDoc.toString(), props.current.fault),
                  ),
                }
              : null,
          ),
          // CodeMirror's base theme is unlayered CSS, so it outranks a
          // host's layered utilities on these parts. The text takes the
          // part's font and line height, as a textarea takes its own, and
          // the field is `lines` of that line tall before it grows.
          EditorView.theme({
            "&.cm-focused": { outline: "none" },
            ".cm-scroller": { fontFamily: "inherit", lineHeight: "inherit" },
            ".cm-content": { minHeight: `${lines}lh`, padding: "0" },
            ".cm-line": { padding: "0" },
          }),
          placeholder ? placeholderText(placeholder) : [],
          EditorView.contentAttributes.of({ spellcheck: "false" }),
          attributes.current.of(contentAttributes(props.current)),
          hostExtension,
          completer.current.of(completing.current ? completionOf(props) : []),
          EditorView.updateListener.of((update) => {
            if (
              !update.docChanged ||
              update.transactions.some((tr) => tr.annotation(fromValue))
            )
              return;
            const text = update.state.doc.toString();
            props.current.onChange(
              text,
              parent.ownerDocument.defaultView ?? window,
            );
          }),
          EditorView.domEventHandlers({
            blur: () => {
              props.current.onBlur?.();
            },
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (!editor || completing.current === completes) return;
    completing.current = completes;
    editor.dispatch({
      effects: completer.current.reconfigure(
        completes ? completionOf(props) : [],
      ),
    });
  }, [completes]);
  // Read as the owner's render commits, before the next key: an effect
  // waits for paint, and the user may type again before it runs, so the
  // owner's echo of a text the field sent would read as an older text and
  // undo the typing.
  useLayoutEffect(() => {
    const editor = view.current;
    if (!editor) return;
    if (editor.state.doc.toString() === value) return;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
      annotations: fromValue.of(true),
    });
  }, [value]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch(
      setDiagnostics(
        editor.state,
        underlines(editor.state.doc.toString(), fault),
      ),
    );
  }, [fault]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({
      effects: attributes.current.reconfigure(
        contentAttributes({ label, labelId, invalid }),
      ),
    });
  }, [invalid, label, labelId]);
  // A column that centres the editor: one line stands where a text input's
  // text stands, and wrapped text grows the box.
  return (
    <>
      <div
        ref={host}
        data-part="expression"
        className={matchExpression}
        {...data}
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      />
      {label !== undefined && <HiddenName id={labelId}>{label}</HiddenName>}
    </>
  );
}
