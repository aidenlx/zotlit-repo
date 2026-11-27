import {
  history,
  isolateHistory,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from "@codemirror/commands";
import type {
  ChangeSpec,
  Transaction,
  TransactionSpec,
} from "@codemirror/state";
import { Annotation, ChangeSet, EditorState, Text } from "@codemirror/state";
import { diffChars } from "diff";

import type { PartialContext } from "@zotlit/notes/core/template-preview/partial-preview.ts";
import { DEFAULT_PARTIAL_CONTEXT } from "@zotlit/notes/core/template-preview/partial-preview.ts";
import { ANNOTATION_HEADER } from "@zotlit/templates/constants";
import type { TemplateLanguage } from "@zotlit/templates/constants";
import { updateLiteratureNoteTemplateMatch } from "@zotlit/templates/facade";
import type { MatchTree } from "@zotlit/templates/facade";
import {
  formatPlainTemplateDocument,
  LiteratureNoteTemplateError,
  parsePlainTemplateDocument,
  parseLiteratureNoteTemplate,
  PlainTemplateDocumentError,
} from "@zotlit/templates/facade";
import type {
  LiteratureNoteTemplateDocument,
  LiteratureNoteTemplateErrorCode,
  PlainTemplateDocument,
} from "@zotlit/templates/facade";
import {
  literatureNoteTemplateDependencies,
  updateLiteratureNotePackMetadata,
} from "@zotlit/templates/literature-note-pack";

import { jsonSliceHistory } from "./json-source.ts";
import type {
  ManagedEntryAction,
  ManagedEntrySource,
  ManifestScalar,
  WorkbenchSliceRange,
} from "./manifest-patch.ts";
import {
  managedEntryEdit,
  managedFrontmatterEntries,
  manifestKeyEdit,
  manifestNodeRange,
  manifestScalarSlice,
  manifestValueEdit,
} from "./manifest-patch.ts";
import type { NoteRegions } from "./regions.ts";
import { noteRegions, RESERVED_CALL_NAMES } from "./regions.ts";
import { yamlValue } from "./scalar-source.ts";
import type { SliceCodec } from "./slice-codec.ts";
import { jsonCodec, scalarCodec, sourceCodec } from "./slice-codec.ts";

import { pairingState, pairingHistory } from "#core/language/pairing-state.ts";

export type WorkbenchEntrySliceId = `entry:${number}`;

export type WorkbenchDocumentKind = "profile" | "citation" | "partial";

export type WorkbenchSliceId =
  | "note"
  | "annotation"
  | "filename"
  | "advanced"
  | "details"
  | "source"
  | WorkbenchEntrySliceId;

export interface WorkbenchAnnotationSection {
  readonly header: WorkbenchSliceRange;
  readonly source: WorkbenchSliceRange;
}

export type { WorkbenchSliceRange } from "./manifest-patch.ts";

export function entrySlice(position: number): WorkbenchEntrySliceId {
  return `entry:${position}`;
}

export function entryPosition(id: WorkbenchSliceId): number | null {
  const [name, position] = id.split(":");
  return name === "entry" ? Number(position) : null;
}

export type WorkbenchProblemCode =
  | LiteratureNoteTemplateErrorCode
  | "bundled-partial";

export interface WorkbenchProblem {
  readonly code: WorkbenchProblemCode;
  readonly params?: Readonly<Record<string, string>>;
  readonly error?: Error;
  readonly slice: WorkbenchSliceId;
  readonly range?: WorkbenchSliceRange;
}

export interface WorkbenchSliceEditor {
  replay(changes: ChangeSpec, userEvent: string | undefined): void;
}

interface Quarantine {
  readonly id: WorkbenchSliceId;
  readonly editor: WorkbenchSliceEditor;
  readonly range: WorkbenchSliceRange;
}

export interface WorkbenchUpdate {
  readonly transaction: Transaction;
  readonly docChanged: boolean;
}

export const sliceEdit = Annotation.define<WorkbenchSliceId>();

export const externalEdit = Annotation.define<boolean>();

export class WorkbenchDocumentController {
  #state: EditorState;
  #readOnly: boolean;
  readonly #kind: WorkbenchDocumentKind;
  readonly #context: () => PartialContext;
  #document: LiteratureNoteTemplateDocument | null = null;
  #manifest: LiteratureNoteTemplateDocument["manifest"] | null = null;
  #plain: PlainTemplateDocument | null = null;
  #problems: readonly WorkbenchProblem[] = [];
  #focused: WorkbenchSliceId | null = null;
  #entries: readonly ManagedEntrySource[] | null = null;
  #entriesHeld = false;
  #dependencies: readonly string[] = [];
  #regions: NoteRegions = { annotationCalls: [], managedBlock: null };
  readonly #ranges = new Map<WorkbenchSliceId, WorkbenchSliceRange>([
    ["note", { from: 0, to: 0 }],
    ["advanced", { from: 0, to: 0 }],
  ]);
  readonly #codecs = new Map<WorkbenchSliceId, SliceCodec>();
  readonly #slices = new Map<WorkbenchSliceId, WorkbenchSliceEditor>();
  readonly #listeners = new Set<(update: WorkbenchUpdate) => void>();

  constructor(
    source: string,
    options: {
      readOnly?: boolean;
      kind?: WorkbenchDocumentKind;
      context?: () => PartialContext;
    } = {},
  ) {
    this.#kind = options.kind ?? "profile";
    this.#context = options.context ?? (() => DEFAULT_PARTIAL_CONTEXT);
    this.#readOnly = options.readOnly ?? false;
    this.#state = EditorState.create({
      doc: source,
      extensions: [
        EditorState.lineSeparator.of(source.includes("\r\n") ? "\r\n" : "\n"),
        history(),
        pairingState,
        pairingHistory,
        jsonSliceHistory,
        EditorState.changeFilter.of((transaction) => {
          const quarantine = this.#quarantine(transaction);
          if (quarantine === null) return true;
          const { from, to } = quarantine.range;
          return [from, to];
        }),
      ],
    });
    if (this.#kind !== "profile")
      this.#ranges.set("source", { from: 0, to: source.length });
    this.#analyze();
  }

  get source(): string {
    const { doc } = this.#state;
    return doc.sliceString(0, doc.length, this.#state.lineBreak);
  }

  get #text(): string {
    return this.#state.doc.toString();
  }

  get state(): EditorState {
    return this.#state;
  }

  get kind(): WorkbenchDocumentKind {
    return this.#kind;
  }

  get partialContext(): PartialContext {
    return this.#context();
  }

  #language: "liquid" | "eta" = "liquid";

  get templateLanguage(): "liquid" | "eta" {
    return this.#language;
  }

  get document(): LiteratureNoteTemplateDocument | null {
    return this.#document;
  }

  get parsed(): boolean {
    return (this.#kind === "profile" ? this.#document : this.#plain) !== null;
  }

  get manifest(): LiteratureNoteTemplateDocument["manifest"] | null {
    return this.#manifest;
  }

  get plainDocument(): PlainTemplateDocument | null {
    return this.#plain;
  }

  get language(): TemplateLanguage {
    return (
      this.#document?.manifest.language ??
      this.#plain?.manifest.language ??
      "liquid"
    );
  }

  setPlainLanguage(language: TemplateLanguage): boolean {
    if (this.#kind === "profile") return false;
    const plain = this.#plain;
    if (plain === null) return false;
    if (plain.sourceStart > 0) {
      return this.setManifestKey("language", language);
    }
    this.dispatch({
      changes: {
        from: 0,
        to: 0,
        insert: formatPlainTemplateDocument("", language),
      },
      userEvent: "input.form",
      annotations: isolateHistory.of("full"),
    });
    return true;
  }

  get problems(): readonly WorkbenchProblem[] {
    return this.#problems;
  }

  get managedEntries(): readonly ManagedEntrySource[] | null {
    return this.#entries;
  }

  get managedEntriesHeld(): boolean {
    return this.#entriesHeld;
  }

  get dependencies(): readonly string[] {
    return this.#dependencies;
  }

  get filenameSlice(): WorkbenchSliceRange | null {
    return this.#ranges.get("filename") ?? null;
  }

  get noteRegions(): NoteRegions {
    return this.#regions;
  }

  get annotationSection(): WorkbenchAnnotationSection | null {
    const source = this.#ranges.get("annotation");
    if (!source) return null;
    const line = this.#state.doc.lineAt(Math.max(source.from - 1, 0));
    return { header: { from: line.from, to: line.to }, source };
  }

  get templateRegions(): readonly (WorkbenchSliceRange & {
    root: "note" | "annotation" | "filename" | "citation";
    expression: boolean;
    language?: "liquid" | "eta" | "json-e";
  })[] {
    if (this.#kind !== "profile") {
      return [
        {
          ...this.sliceRange("source"),
          root: this.#kind === "citation" ? "citation" : this.#context(),
          expression: false,
        },
      ];
    }
    const annotation = this.annotationSection?.source;
    const filename =
      this.filenameSlice ?? manifestNodeRange(this.source, ["filename"]);
    const language = this.templateLanguage;
    return [
      ...(annotation
        ? [
            {
              ...annotation,
              root: "annotation" as const,
              expression: false,
              language,
            },
          ]
        : []),
      { ...this.sliceRange("note"), root: "note", expression: false, language },
      ...(filename
        ? [
            {
              ...filename,
              root: "filename" as const,
              expression: false,
              language,
            },
          ]
        : []),
      ...(this.managedEntries ?? [])
        .filter(
          (entry) => entry.language === "expr" || entry.language === "value",
        )
        .map((entry) => ({
          ...entry.expression,
          root: "note" as const,
          expression: entry.language === "expr",
          ...(entry.language === "value"
            ? { language: "json-e" as const }
            : {}),
        })),
    ];
  }

  get canUndo(): boolean {
    return !this.#readOnly && undoDepth(this.#state) > 0;
  }

  get canRedo(): boolean {
    return !this.#readOnly && redoDepth(this.#state) > 0;
  }

  hasSlice(id: WorkbenchSliceId): boolean {
    return this.#ranges.has(id);
  }

  sliceRange(id: WorkbenchSliceId): WorkbenchSliceRange {
    return this.#ranges.get(id) ?? { from: 0, to: 0 };
  }

  get slices(): ReadonlyMap<WorkbenchSliceId, WorkbenchSliceRange> {
    return new Map(this.#ranges);
  }

  sliceText(id: WorkbenchSliceId): string {
    const { from, to } = this.sliceRange(id);
    return this.#state.doc.sliceString(from, to);
  }

  slicePrefix(id: WorkbenchSliceId): string {
    const { from } = this.sliceRange(id);
    return this.#state.doc.sliceString(this.#state.doc.lineAt(from).from, from);
  }

  sliceCodec(id: WorkbenchSliceId): SliceCodec {
    return this.#codecs.get(id) ?? sourceCodec;
  }

  setFocusedSlice(id: WorkbenchSliceId | null): void {
    this.#focused = id;
  }

  registerSlice(
    id: WorkbenchSliceId,
    editor: WorkbenchSliceEditor,
  ): () => void {
    this.#slices.set(id, editor);
    return () => {
      if (this.#slices.get(id) === editor) this.#slices.delete(id);
    };
  }

  subscribe(listener: (update: WorkbenchUpdate) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  applyExternalSource(source: string): void {
    const next = EditorState.create({ doc: source }).doc.toString();
    if (next === this.#text) return;
    const changes: ChangeSpec[] = [];
    let offset = 0;
    for (const part of diffChars(this.#text, next)) {
      if (part.added) changes.push({ from: offset, insert: part.value });
      else {
        if (part.removed)
          changes.push({ from: offset, to: offset + part.value.length });
        offset += part.value.length;
      }
    }
    this.dispatch({
      changes,
      annotations: [externalEdit.of(true), isolateHistory.of("full")],
    });
  }

  get readOnly(): boolean {
    return this.#readOnly;
  }

  setReadOnly(value: boolean): void {
    if (value === this.#readOnly) return;
    this.#readOnly = value;
    this.#apply(this.#state.update({}));
  }

  dispatch(spec: TransactionSpec): void {
    if (this.#readOnly) return;
    const before = this.#state;
    let changes =
      spec.changes === undefined ? undefined : splitLineBreaks(spec.changes);
    if (
      changes !== undefined &&
      this.annotationSection?.header.from === this.sliceRange("note").to
    ) {
      const proposed = before.update({ ...spec, changes, filter: false });
      const note = this.sliceRange("note");
      if (
        proposed.annotation(sliceEdit) === "note" &&
        proposed.changes.mapPos(note.to, 1) > note.from
      ) {
        changes = proposed.changes.compose(
          ChangeSet.of(
            {
              from: proposed.changes.mapPos(note.to, 1),
              insert: "\n",
            },
            proposed.newDoc.length,
          ),
        );
      }
    }
    const transaction = before.update(
      changes === undefined ? spec : { ...spec, changes },
    );
    const quarantine = this.#quarantine(transaction);
    const suppressed =
      quarantine === null || changes === undefined
        ? null
        : suppressedChanges(before.changes(changes), quarantine.range);
    this.#apply(transaction);
    if (quarantine && suppressed) {
      this.#replay(
        quarantine,
        suppressed.map(transaction.changes),
        spec.userEvent,
      );
    }
  }

  undo(): boolean {
    return !this.#readOnly && undo(this.#target());
  }

  redo(): boolean {
    return !this.#readOnly && redo(this.#target());
  }

  setManifestValue(
    path: readonly (string | number)[],
    value: ManifestScalar,
  ): boolean {
    const edit = manifestValueEdit(this.#text, path, value);
    if (!edit) return false;
    this.dispatch({ changes: edit, userEvent: "input.form" });
    return true;
  }

  setMatch(match: MatchTree | undefined): boolean {
    let next: string;
    try {
      next = updateLiteratureNoteTemplateMatch(this.#text, match);
    } catch {
      return false;
    }
    this.#rewrite(next);
    return true;
  }

  dropBundledPartials(names: readonly string[]): boolean {
    let document;
    try {
      document = parseLiteratureNoteTemplate(this.#text);
    } catch {
      return false;
    }
    const partials = document.manifest.partials ?? [];
    const kept = partials.filter(({ name }) => !names.includes(name));
    if (kept.length === partials.length) return false;
    let next: string;
    try {
      next = updateLiteratureNotePackMetadata(this.#text, {
        partials: kept.length > 0 ? kept : undefined,
      });
    } catch {
      return false;
    }
    this.#rewrite(next);
    return true;
  }

  #rewrite(next: string): void {
    if (next === this.#text) return;
    let from = 0;
    while (
      from < this.#text.length &&
      from < next.length &&
      this.#text[from] === next[from]
    )
      from++;
    let to = this.#text.length;
    let end = next.length;
    while (to > from && end > from && this.#text[to - 1] === next[end - 1]) {
      to--;
      end--;
    }
    this.dispatch({
      changes: { from, to, insert: next.slice(from, end) },
      userEvent: "input.form",
      annotations: isolateHistory.of("full"),
    });
  }

  setManifestKey(key: string, value: ManifestScalar | undefined): boolean {
    const edit = manifestKeyEdit(this.#text, key, value);
    if (!edit) return false;
    this.dispatch({
      changes: edit,
      userEvent: "input.form",
      annotations: isolateHistory.of("full"),
    });
    return true;
  }

  repairAnnotationSection(): boolean {
    if (
      !this.#problems.some(({ code }) => code === "missing-annotation-section")
    ) {
      return false;
    }
    const { doc } = this.#state;
    const start = doc.line(doc.lines).length === 0 ? "" : "\n";
    this.dispatch({
      changes: { from: doc.length, insert: `${start}${ANNOTATION_HEADER}\n` },
      userEvent: "input.form",
      annotations: isolateHistory.of("full"),
    });
    return true;
  }

  editManagedEntry(action: ManagedEntryAction): boolean {
    const edit = managedEntryEdit(this.#text, action);
    if (!edit) return false;
    this.setFocusedSlice(null);
    this.dispatch({
      changes: edit,
      userEvent: "input.form",
      annotations: isolateHistory.of("full"),
    });
    return true;
  }

  #quarantine(transaction: Transaction): Quarantine | null {
    const focused = this.#focused;
    const editor = focused === null ? undefined : this.#slices.get(focused);
    const range = focused === null ? undefined : this.#ranges.get(focused);
    if (
      focused === null ||
      editor === undefined ||
      range === undefined ||
      transaction.annotation(sliceEdit) === focused ||
      transaction.annotation(externalEdit) === true ||
      transaction.isUserEvent("undo") ||
      transaction.isUserEvent("redo")
    ) {
      return null;
    }
    return { id: focused, editor, range };
  }

  #replay(
    { id, editor }: Quarantine,
    changes: ChangeSet,
    userEvent: string | undefined,
  ): void {
    const { from, to } = this.sliceRange(id);
    const replay: ChangeSpec[] = [];
    // oxlint-disable-next-line max-params -- CM's iterChanges callback signature.
    changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      replay.push({
        from: clamp(fromA - from, to - from),
        to: clamp(toA - from, to - from),
        insert: inserted,
      });
    });
    if (replay.length > 0) editor.replay(replay, userEvent);
  }

  #lineAround(offset: number): WorkbenchSliceRange {
    const { doc } = this.#state;
    const line = doc.lineAt(clamp(offset, doc.length));
    return { from: line.from, to: line.to };
  }

  #target() {
    return {
      state: this.#state,
      dispatch: (transaction: Transaction) => this.#apply(transaction),
    };
  }

  #apply(transaction: Transaction): void {
    this.#state = transaction.state;
    if (transaction.docChanged) {
      for (const [id, range] of this.#ranges) {
        this.#ranges.set(id, {
          from: transaction.changes.mapPos(range.from, -1),
          to: transaction.changes.mapPos(range.to, 1),
        });
      }
      this.#analyze();
    }
    const update: WorkbenchUpdate = {
      transaction,
      docChanged: transaction.docChanged,
    };
    for (const listener of this.#listeners) listener(update);
  }

  #readManifest(source: string): void {
    const list = managedFrontmatterEntries(source);
    this.#entriesHeld = list.status === "unparsed";
    if (list.status === "unparsed") return;
    const filename = manifestScalarSlice(source, ["filename"]);
    this.#codecs.clear();
    if (filename) {
      this.#ranges.set("filename", { from: filename.from, to: filename.to });
      if (!filename.literal) this.#codecs.set("filename", scalarCodec);
    } else this.#ranges.delete("filename");
    const entries = list.status === "rows" ? list.entries : null;
    this.#entries = entries;
    for (const id of this.#ranges.keys()) {
      if (id.startsWith("entry:")) this.#ranges.delete(id);
    }
    for (const entry of entries ?? []) {
      const id = entrySlice(entry.position);
      this.#ranges.set(id, entry.expression);
      if (entry.language === "expr") this.#codecs.set(id, scalarCodec);
      if (entry.language === "value") this.#codecs.set(id, jsonCodec);
    }
  }

  #analyze(): void {
    const source = this.#text;
    this.#ranges.set("advanced", { from: 0, to: source.length });
    if (this.#kind !== "profile") {
      this.#analyzePlain(source);
      return;
    }
    this.#readManifest(source);
    try {
      const document = parseLiteratureNoteTemplate(source);
      this.#document = document;
      this.#manifest = document.manifest;
      this.#language = document.manifest.language;
      this.#ranges.set("note", {
        from: document.bodyStart,
        to: document.annotationSection.headerStart,
      });
      this.#ranges.set("annotation", {
        from: document.annotationSection.start,
        to: document.annotationSection.end,
      });
      this.#dependencies = literatureNoteTemplateDependencies(document).filter(
        (name) => !RESERVED_CALL_NAMES.includes(name),
      );
      this.#problems = bundledPartialProblems(document, source);
    } catch (error) {
      if (!(error instanceof LiteratureNoteTemplateError)) throw error;
      this.#document = null;
      const entry = error.manifestPath ? null : this.#unreadableEntry();
      const range =
        entry?.range ??
        (error.manifestPath
          ? manifestNodeRange(source, error.manifestPath)
          : null) ??
        (error.offset === undefined ? null : this.#lineAround(error.offset));
      this.#problems = [
        {
          code: error.code,
          error,
          ...(error.manifestPath
            ? { params: { field: error.manifestPath.join(".") } }
            : {}),
          slice: entry?.id ?? this.#sliceFor(error),
          ...(range ? { range } : {}),
        },
      ];
    }
    const section = this.annotationSection;
    const note = this.sliceRange("note");
    if (
      section &&
      source.slice(section.header.from, section.header.to) === ANNOTATION_HEADER
    ) {
      this.#ranges.set("note", {
        from: note.from,
        to: Math.min(note.to, Math.max(note.from, section.header.from - 1)),
      });
    }
    this.#regions = noteRegions(source, this.sliceRange("note"));
  }

  #analyzePlain(source: string): void {
    try {
      const plain = parsePlainTemplateDocument(source);
      this.#plain = plain;
      this.#ranges.set("source", {
        from: plain.sourceStart,
        to: source.length,
      });
      this.#problems = [];
    } catch (error) {
      if (!(error instanceof PlainTemplateDocumentError)) throw error;
      this.#plain = null;
      this.#ranges.set("source", { from: 0, to: source.length });
      this.#problems = [
        {
          code: error.code,
          error,
          slice: "source",
          range: this.#lineAround(error.offset),
        },
      ];
    }
  }

  #unreadableEntry(): {
    id: WorkbenchSliceId;
    range: WorkbenchSliceRange;
  } | null {
    for (const [id, range] of this.#ranges) {
      if (entryPosition(id) === null) continue;
      if (yamlValue(this.sliceText(id), this.slicePrefix(id)) === undefined)
        return { id, range };
    }
    return null;
  }

  #sliceFor(error: LiteratureNoteTemplateError): WorkbenchSliceId {
    const path = error.manifestPath;
    const index = path?.[0] === "frontmatter" ? path[1] : undefined;
    if (typeof index === "number") {
      const position = index + 1;
      return this.#entries?.some((entry) => entry.position === position)
        ? entrySlice(position)
        : "advanced";
    }
    if (path?.[0] === "filename" && this.filenameSlice) return "filename";
    if (typeof path?.[0] === "string" && DETAIL_KEYS.has(path[0])) {
      return "details";
    }
    return this.#inNoteBody(error) ? "note" : "advanced";
  }

  #inNoteBody({ code, offset }: LiteratureNoteTemplateError): boolean {
    if (offset === undefined || !NOTE_BODY_ERRORS.has(code)) return false;
    const note = this.#ranges.get("note");
    return note !== undefined && offset >= note.from && offset < note.to;
  }
}

const DETAIL_KEYS = new Set([
  "name",
  "description",
  "version",
  "author",
  "folder",
  "citationStyle",
  "importFolder",
  "importColoredHighlights",
  "importAnnotationsAsTemplate",
  "language",
  "sampleItemType",
]);

const NOTE_BODY_ERRORS = new Set<LiteratureNoteTemplateErrorCode>([
  "invalid-managed-block",
  "duplicate-managed-block",
  "unknown-section-header",
]);

function suppressedChanges(
  changes: ChangeSet,
  { from, to }: WorkbenchSliceRange,
): ChangeSet {
  const suppressed: ChangeSpec[] = [];
  // oxlint-disable-next-line max-params -- CM's iterChanges callback signature.
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const start = Math.max(fromA, from);
    const end = Math.min(toA, to);
    if (fromA === toA ? fromA <= from || fromA >= to : start >= end) return;
    suppressed.push({
      from: start,
      to: end,
      ...(fromA >= from ? { insert: inserted } : {}),
    });
  });
  return ChangeSet.of(suppressed, changes.length);
}

function bundledPartialProblems(
  document: LiteratureNoteTemplateDocument,
  source: string,
): readonly WorkbenchProblem[] {
  const partials = document.manifest.partials ?? [];
  if (partials.length === 0) return [];
  return [
    {
      code: "bundled-partial",
      params: { names: partials.map(({ name }) => name).join(", ") },
      slice: "advanced",
      ...at(source, ["partials"]),
    },
  ];
}

function at(
  source: string,
  path: readonly (string | number)[],
): { range?: WorkbenchSliceRange } {
  const range = manifestNodeRange(source, path);
  return range ? { range } : {};
}

function splitLineBreaks(changes: ChangeSpec): ChangeSpec {
  if (Array.isArray(changes)) return changes.map(splitLineBreaks);
  if (
    typeof changes !== "object" ||
    !("insert" in changes) ||
    typeof changes.insert !== "string"
  ) {
    return changes;
  }
  return { ...changes, insert: Text.of(changes.insert.split(/\r\n|[\n\r]/)) };
}

function clamp(offset: number, length: number): number {
  return Math.min(Math.max(offset, 0), length);
}
