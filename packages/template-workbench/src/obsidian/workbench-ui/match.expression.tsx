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

const matchExpression = cn(
  themeHook.templateEditor,
  editorBox,
  "zt:min-h-(--input-height) zt:w-full zt:min-w-0 zt:cursor-text zt:font-mono zt:text-sm zt:leading-normal zt:[transition:var(--input-transition)]",
  "zt:hover:bg-(--background-modifier-form-field-hover) zt:not-focus-within:not-has-[[aria-invalid=true]]:hover:border-border-hover zt:has-[[aria-invalid=true]]:border-(--text-error)",
  "zt:[&_.cm-placeholder]:text-(--text-faint)",
);

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

const completionOf = (props: {
  readonly current: { vocabulary?: ExpressionVocabulary };
}) =>
  filterExpressionCompletion(
    () => props.current.vocabulary,
    nativeCompletion(expressionOption),
  );

const fromValue = Annotation.define<true>();

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
  fault?: PlacedFault;
  onChange: (text: string, win: Window) => void;
  onBlur?: () => void;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  placeholder?: string;
  lines?: number;
  vocabulary?: ExpressionVocabulary;
}

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
  const hostExtension = useMemo(
    () => [hostedEditor, popoverTooltips, obsidianPopupKeys(app)],
    [app],
  );
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const labelId = useUniqueId();
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
  useLayoutEffect(() => {
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
  });
  const attributes = useRef(new Compartment());
  const completer = useRef(new Compartment());
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
          EditorState.transactionExtender.of((tr) =>
            tr.docChanged
              ? {
                  effects: setDiagnosticsEffect.of(
                    underlines(tr.newDoc.toString(), props.current.fault),
                  ),
                }
              : null,
          ),
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
