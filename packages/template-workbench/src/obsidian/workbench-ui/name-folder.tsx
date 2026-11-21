// The Name and folder and Profile forms share manifest controls. Name and
// folder owns the note path (the folder and the note-name template) and the
// other bindings; Profile owns identity, language, and compatibility details.

import type {
  ManifestScalar,
  WorkbenchDocumentController,
  WorkbenchSliceRange,
} from "#core/document/index.ts";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { citationStyleLabel } from "@zotlit/citations/core/pandoc/citation-style.ts";
import { Icon } from "@zotlit/obsidian-kit/components/obsidian/icon.tsx";
import { cn, tooltipAttrs } from "@zotlit/obsidian-kit/utils.ts";
import * as m from "@zotlit/plugin-messages/messages.ts";
import { joinNotePath } from "@zotlit/templates";
import { useUniqueId } from "@zotlit/ui";

import { ExampleActions, useExampleState } from "./example-state.tsx";
import { useOptionalHost } from "./host.tsx";
import { templateWorkbenchButton, editorBox } from "./look.ts";
import { renderDiagnosis } from "./problems.ts";
import { WorkbenchSelect, WorkbenchOption } from "./select.tsx";
import { SliceEditor } from "./slice-editor.tsx";
import type { SuggestionSource } from "./slice-editor.tsx";

const nameFolderSourceButton = templateWorkbenchButton;
const nameFolderPane = cn(
  "zt:flex zt:min-w-0 zt:flex-col zt:gap-3",
  "zt:gap-6",
);
const nameFolderPathRow = cn(
  "zt:flex zt:min-w-0 zt:flex-col zt:gap-1.5",
  "zt:py-2",
);
const nameFolderBindingLabel = "zt:font-medium";
const nameFolderFilenameEditor = editorBox;
const nameFolderHelp =
  "zt:text-xs zt:leading-normal zt:text-muted-foreground zt:text-pretty";
const nameFolderMuted =
  "zt:text-xs zt:leading-normal zt:text-muted-foreground zt:text-pretty";
const nameFolderSecondary =
  "zt:text-xs zt:leading-normal zt:text-muted-foreground zt:text-pretty";
const nameFolderIdentityFields = cn(
  "zt:flex zt:min-w-0 zt:flex-col zt:gap-3",
  "zt:pt-3",
);
const nameFolderAdvancedFields = cn(
  "zt:flex zt:min-w-0 zt:flex-col zt:gap-3",
  "zt:gap-6 zt:pt-3",
);
const nameFolderFields = "zt:flex zt:min-w-0 zt:flex-col zt:gap-3";
const nameFolderReadonlyInput = "zt:w-full zt:min-w-0";
const nameFolderConfirmation = cn(
  "zt:flex zt:min-w-0 zt:flex-col zt:gap-3",
  "zt:rounded-md zt:bg-card zt:p-3",
);
const nameFolderConfirmButton = cn(templateWorkbenchButton, "zt:ms-auto");
const nameFolderCancelButton = templateWorkbenchButton;

/** The manifest, named without depending on the templates package. */
type ProfileManifest = NonNullable<
  WorkbenchDocumentController["document"]
>["manifest"];

/** The manifest keys that carry a vault-local value the Profile may override. */
type BindingKey =
  | "folder"
  | "citationStyle"
  | "importFolder"
  | "importColoredHighlights"
  | "importAnnotationsAsTemplate";

interface Binding {
  readonly key: BindingKey;
  readonly label: () => string;
  /**
   * The control the value is edited through. A style is picked from the vault's
   * installed styles while the host lists them, and typed as its CSL ID when no
   * list is given.
   */
  readonly kind: "path" | "style" | "toggle";
}

/** The folder part of the note path, which the note path group holds. */
const FOLDER_BINDING: Binding = {
  key: "folder",
  label: m.workbench_name_binding_folder,
  kind: "path",
};

/** The bindings outside the note path, which keep a group of their own. */
const BINDINGS: readonly Binding[] = [
  {
    key: "citationStyle",
    label: m.workbench_name_binding_citation_style,
    kind: "style",
  },
  {
    key: "importFolder",
    label: m.workbench_name_binding_import_folder,
    kind: "path",
  },
  {
    key: "importColoredHighlights",
    label: m.workbench_name_binding_colored_highlights,
    kind: "toggle",
  },
  {
    key: "importAnnotationsAsTemplate",
    label: m.workbench_name_binding_annotation_template,
    kind: "toggle",
  },
];

/** A CSL style the vault has installed: its id and its title. */
export interface InstalledCitationStyle {
  readonly id: string;
  readonly title: string;
}

/**
 * The vault's own value for each sparse binding a Profile may override, so the
 * form shows the default in effect there rather than the plugin's built-in
 * one, and Override writes that same value.
 */
export interface ProfileBindingDefaults {
  readonly folder: string;
  readonly citationStyle: string | null;
  readonly importFolder: string;
  readonly importColoredHighlights: boolean;
  readonly importAnnotationsAsTemplate: boolean;
}

/**
 * What an unset binding inherits with no vault to ask: the plugin's built-in
 * Default Profile, which is what a fresh install starts on. The Obsidian
 * host replaces this with the vault's own effective values.
 * @see apps/obsidian/src/services/settings/schema.ts DEFAULT_LITERATURE_NOTE_PROFILE
 */
export const BUILT_IN_BINDING_DEFAULTS: ProfileBindingDefaults = {
  folder: "literatures",
  citationStyle: null,
  importFolder: "zotero_notes",
  importColoredHighlights: false,
  importAnnotationsAsTemplate: false,
};

/** The Profile whose bindings live in Obsidian's settings rather than here. */
const DEFAULT_PROFILE_ID = "default";

/**
 * The control that holds one manifest key. A problem the parser pinned to a key
 * opens the control under this id, so every field this form writes carries one.
 */
const FieldIdContext = createContext({ prefix: "workbench", readOnly: false });

function fieldId(prefix: string, key: string): string {
  return `${prefix}-field-${key}`;
}

/** One binding value in the words the tab reads it in. */
function valueText(value: string | boolean | null | undefined): string {
  if (value === undefined) return m.workbench_name_unset();
  if (value === null) return citationStyleLabel();
  if (typeof value === "boolean") {
    return value ? m.workbench_name_value_on() : m.workbench_name_value_off();
  }
  return value === "" ? m.workbench_name_value_vault_root() : value;
}

export interface NameFolderPaneProps {
  section?: "name" | "profile";
  controller: WorkbenchDocumentController;
  onOpenSource?: () => void;
  onOpenSettings?: () => void;
  onChooseItem?: () => void;
  onRetry?: () => void;
  /**
   * The manifest this form writes: the last one the document parsed with, so a
   * draft under repair keeps the values the reader is repairing. Null before
   * any parse has succeeded, which is what the form has nothing to show for.
   */
  manifest: ProfileManifest | null;
  /** The note name the current render produced, for the live result. */
  filename: string | null;
  /**
   * The relative Note Path the current render resolved from that note name,
   * which the preview joins under the effective folder. Null where the note
   * name resolves to empty.
   */
  notePath: string | null;
  /**
   * The styles the connected vault has installed, for the citation-style
   * picker. Null standalone, and while the connection lists none.
   */
  citationStyles?: readonly InstalledCitationStyle[] | null;
  /**
   * The values an unset binding inherits. The host gives the vault's own;
   * without them this is the plugin's built-in Default Profile.
   */
  defaults?: ProfileBindingDefaults;
  /**
   * The manifest key to open, named by the problem that sent the reader here.
   * Each new object opens it again.
   */
  focus?: {
    readonly field: string;
    readonly focus?: boolean;
    readonly scrollIntoView?: boolean;
  } | null;
  /** The contract the note-name editor completes and explains against. */
  suggest?: SuggestionSource;
  reveal?: WorkbenchSliceRange | null;
  onSelection?: (selection: WorkbenchSliceRange) => void;
  /**
   * Reads the explanation for a note-name failure, named by its diagnosis. The
   * tab offers the route only while the note name is the surface that failed.
   */
  onShowProblem?: (id: string) => void;
}

export function NameFolderPane({
  section = "name",
  controller,
  onOpenSource,
  onOpenSettings,
  onChooseItem,
  onRetry,
  manifest,
  filename,
  notePath,
  citationStyles,
  defaults = BUILT_IN_BINDING_DEFAULTS,
  focus,
  suggest,
  reveal,
  onSelection,
  onShowProblem,
}: NameFolderPaneProps) {
  const example = useExampleState("filename");
  const prefix = useUniqueId();
  const statusId = useUniqueId();
  const previewLabelId = useUniqueId();
  // The note name on screen: this attempt's own, or the last that worked while
  // the Filename Template is under repair. Anything else the tab cannot show,
  // and its condition is read in place of a name.
  const shown =
    // oxlint-disable-next-line zotlit-errors/no-message-match -- the Example's condition text, not an error's message.
    example.message === null
      ? { filename, notePath }
      : example.retained
        ? {
            filename: example.retained.filename,
            notePath: example.retained.notePath,
          }
        : null;
  // A name that rendered and still resolves to nothing creates no note.
  const empty = shown?.filename != null && shown.notePath === null;
  const container = useRef<HTMLDivElement>(null);
  // The control a problem named, brought on screen with the keyboard in it. A
  // key the locked details hold opens that block first, so the reader lands on
  // the field rather than on the summary that hides it.
  useEffect(() => {
    if (!focus || focus.focus === false) return;
    const control = [
      ...(container.current?.querySelectorAll<HTMLElement>("[id]") ?? []),
    ].find((element) => element.id === fieldId(prefix, focus.field));
    if (!control) return;
    control.closest("details")?.setAttribute("open", "");
    if (focus.scrollIntoView !== false)
      control.scrollIntoView({ block: "nearest" });
    control.focus({ preventScroll: focus.scrollIntoView === false });
  }, [focus, prefix]);

  const settingsAction = onOpenSettings && (
    <button
      type="button"
      data-part="source-button"
      className={nameFolderSourceButton}
      onClick={onOpenSettings}
    >
      {m.workbench_open_settings()}
    </button>
  );
  if (!manifest) {
    return (
      <div data-part="pane" className={nameFolderPane}>
        <p data-part="unreadable">{m.workbench_name_unreadable()}</p>
        {settingsAction}
      </div>
    );
  }

  const write = (key: string, value: ManifestScalar | undefined) =>
    controller.setManifestKey(key, value);
  const isDefault = manifest.id === DEFAULT_PROFILE_ID;
  // The folder in effect: the Default Profile's lives in settings, and any
  // other Profile's own value stands over the one it inherits.
  const folder = isDefault
    ? defaults.folder
    : (manifest.folder ?? defaults.folder);
  const fullPath =
    shown?.notePath != null ? joinNotePath(folder, shown.notePath) : null;

  return (
    <FieldIdContext.Provider value={{ prefix, readOnly: controller.readOnly }}>
      <div ref={container} data-part="pane" className={nameFolderPane}>
        {section === "name" && (
          <>
            <Group
              heading={m.workbench_name_path_heading()}
              lede={m.workbench_name_path_lede()}
              region
            >
              {isDefault ? (
                <div data-part="path-row" className={nameFolderPathRow}>
                  <DefaultBindings
                    bindings={[FOLDER_BINDING]}
                    defaults={defaults}
                    note={m.workbench_name_folder_default_note()}
                  />
                </div>
              ) : (
                <BindingRow
                  binding={FOLDER_BINDING}
                  value={manifest.folder}
                  fallback={defaults.folder}
                  citationStyles={null}
                  onWrite={(value) => write(FOLDER_BINDING.key, value)}
                />
              )}
              {controller.filenameSlice ? (
                <div data-part="path-row" className={nameFolderPathRow}>
                  {/* The editor carries this name itself; the caption shows it. */}
                  <span
                    aria-hidden
                    data-part="binding-label"
                    className={nameFolderBindingLabel}
                  >
                    {m.workbench_name_filename_label()}
                  </span>
                  <div
                    data-part="filename-editor"
                    className={nameFolderFilenameEditor}
                  >
                    <SliceEditor
                      controller={controller}
                      slice="filename"
                      label={m.workbench_name_filename_label()}
                      singleLine
                      invalid={example.kind === "failed" || empty}
                      describedBy={statusId}
                      reveal={reveal}
                      suggest={suggest}
                      onSelection={onSelection}
                    />
                  </div>
                </div>
              ) : (
                <p data-part="help" className={nameFolderHelp}>
                  {m.workbench_name_filename_source_only()}
                  {onOpenSource && (
                    <button
                      type="button"
                      data-part="source-button"
                      className={nameFolderSourceButton}
                      onClick={onOpenSource}
                    >
                      {m.workbench_open_source()}
                    </button>
                  )}
                </p>
              )}
              <p
                data-part="filename-result"
                className="zt:flex zt:flex-wrap zt:items-center zt:gap-x-2 zt:gap-y-1 zt:text-xs zt:leading-normal"
              >
                <span
                  id={previewLabelId}
                  data-part="muted"
                  className={nameFolderMuted}
                >
                  {m.workbench_name_filename_result()}
                </span>
                <span
                  id={statusId}
                  data-part="filename-status"
                  data-state={empty ? "failed" : example.kind}
                  className="zt:flex zt:min-w-0 zt:flex-wrap zt:items-baseline zt:gap-x-2 zt:gap-y-0.5 zt:data-[state=failed]:text-(--text-error)"
                >
                  <output
                    aria-labelledby={previewLabelId}
                    data-part="filename-output"
                    data-state={empty ? "failed" : example.kind}
                    className="zt:min-w-0 zt:[overflow-wrap:anywhere]"
                  >
                    {fullPath ??
                      (empty
                        ? m.workbench_name_path_empty()
                        : (example.message ?? m.workbench_property_unset()))}
                  </output>
                  {
                    // oxlint-disable-next-line zotlit-errors/no-message-match -- the Example's condition text, not an error's message.
                    shown !== null && example.message !== null && (
                      <span
                        data-part="secondary"
                        className={nameFolderSecondary}
                      >
                        {example.message}
                      </span>
                    )
                  }
                </span>
                {example.failure !== null && onShowProblem && (
                  <button
                    type="button"
                    data-part="source-button"
                    className={nameFolderSourceButton}
                    onClick={() =>
                      onShowProblem(renderDiagnosis(example.failure!).id)
                    }
                  >
                    {m.workbench_problem_show()}
                  </button>
                )}
                <ExampleActions
                  chooseLabel={m.workbench_choose_preview_item()}
                  onChooseItem={onChooseItem}
                  onRetry={example.kind === "error" ? onRetry : undefined}
                />
              </p>
            </Group>

            <Group
              heading={m.workbench_name_bindings_heading()}
              region
              lede={
                isDefault
                  ? m.workbench_name_default_lede()
                  : m.workbench_name_bindings_lede()
              }
            >
              {isDefault ? (
                <DefaultBindings
                  bindings={BINDINGS}
                  defaults={defaults}
                  note={m.workbench_name_default_note()}
                />
              ) : (
                BINDINGS.map((binding) => (
                  <BindingRow
                    key={binding.key}
                    binding={binding}
                    value={manifest[binding.key]}
                    fallback={defaults[binding.key]}
                    citationStyles={citationStyles ?? null}
                    onWrite={(value) => write(binding.key, value)}
                  />
                ))
              )}
            </Group>

            {settingsAction}
          </>
        )}
        {section === "profile" && (
          <>
            <div
              data-part="identity-fields"
              className={nameFolderIdentityFields}
            >
              <Field label={m.workbench_name_field_name()}>
                <TextValue
                  field="name"
                  value={manifest.name}
                  onCommit={(value) => write("name", value)}
                />
              </Field>
              <Field label={m.workbench_name_field_description()}>
                <TextValue
                  field="description"
                  value={manifest.description ?? ""}
                  optional
                  onCommit={(value) => write("description", value)}
                />
              </Field>
              <Field label={m.workbench_name_field_version()}>
                <TextValue
                  field="version"
                  value={manifest.version}
                  onCommit={(value) => write("version", value)}
                />
              </Field>
              <Field label={m.workbench_name_field_author()}>
                <TextValue
                  field="author"
                  value={manifest.author ?? ""}
                  optional
                  onCommit={(value) => write("author", value)}
                />
              </Field>
            </div>

            <details data-part="details" className="zt:group/details">
              <summary
                data-part="summary"
                className="zt:flex zt:cursor-(--cursor-clickable) zt:items-center zt:gap-2 zt:font-medium"
              >
                <span
                  aria-hidden
                  data-part="details-icon"
                  className="zt:inline-flex zt:group-open/details:rotate-90"
                >
                  <Icon name="chevron-right" />
                </span>
                {m.workbench_name_advanced_summary()}
              </summary>
              <div
                data-part="advanced-fields"
                className={nameFolderAdvancedFields}
              >
                <LanguageGroup language={manifest.language} onWrite={write} />

                <div data-part="fields" className={nameFolderFields}>
                  <Field label={m.workbench_name_field_id()}>
                    <input
                      type="text"
                      readOnly
                      value={manifest.id}
                      data-part="readonly-input"
                      className={nameFolderReadonlyInput}
                    />
                  </Field>
                  <p data-part="help" className={nameFolderHelp}>
                    {m.workbench_name_id_note()}
                  </p>
                  <Field label={m.workbench_name_field_contract()}>
                    <input
                      type="text"
                      readOnly
                      value={String(manifest.contract)}
                      data-part="readonly-input"
                      className={nameFolderReadonlyInput}
                    />
                  </Field>
                  <Field label={m.workbench_name_field_min_app_version()}>
                    <input
                      type="text"
                      readOnly
                      value={manifest.minAppVersion ?? m.workbench_name_unset()}
                      data-part="readonly-input"
                      className={nameFolderReadonlyInput}
                    />
                  </Field>
                  <p data-part="help" className={nameFolderHelp}>
                    {m.workbench_name_locked_note()}
                  </p>
                </div>
                <div data-part="fields" className={nameFolderFields}>
                  <Field label={m.workbench_name_field_sample_item_type()}>
                    <TextValue
                      field="sampleItemType"
                      value={manifest.sampleItemType ?? ""}
                      optional
                      onCommit={(value) => write("sampleItemType", value)}
                    />
                  </Field>
                  <p data-part="help" className={nameFolderHelp}>
                    {m.workbench_name_sample_item_type_note()}
                  </p>
                </div>
              </div>
            </details>
          </>
        )}
      </div>
    </FieldIdContext.Provider>
  );
}

function Group({
  heading,
  lede,
  region = false,
  children,
}: {
  heading: string;
  lede?: string;
  /** Names the group by its heading, as a landmark the reader can reach. */
  region?: boolean;
  children: ReactNode;
}) {
  const headingId = useUniqueId();
  return (
    <section
      aria-labelledby={region ? headingId : undefined}
      data-part="group"
      className="zt:flex zt:min-w-0 zt:flex-col zt:gap-3"
    >
      <h3
        id={headingId}
        data-part="heading"
        className="zt-template-workbench-heading"
      >
        {heading}
      </h3>
      {lede && (
        <p data-part="help" className={nameFolderHelp}>
          {lede}
        </p>
      )}
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label
      data-part="field"
      className="zt:flex zt:min-w-0 zt:flex-col zt:gap-1.5"
    >
      {label}
      {children}
    </label>
  );
}

/**
 * A box the reader types in freely, written to the manifest when they leave it,
 * so one edit is one undo step and no keystroke re-parses the document. The
 * draft is this box's own; a value written from anywhere else — an undo,
 * Override, Use default — replaces it. The box itself outlives every write, so
 * the control the reader moves focus to receives their click.
 */
function DraftText({
  id,
  value,
  disabled = false,
  placeholder,
  onCommit,
  binding = false,
}: {
  id?: string;
  value: string;
  disabled?: boolean;
  placeholder?: string;
  onCommit: (value: string) => void;
  binding?: boolean;
}) {
  const readOnly = useContext(FieldIdContext).readOnly;
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      type="text"
      id={id}
      value={draft}
      disabled={disabled}
      readOnly={readOnly}
      placeholder={placeholder}
      onInput={(event) => setDraft(event.currentTarget.value)}
      onBlur={(event) => {
        // The text in the box, even when the blur precedes the draft's render.
        const next = event.currentTarget.value.trim();
        if (next !== value) onCommit(next);
      }}
      data-part={binding ? "binding-input" : "input"}
      className="zt:w-full zt:min-w-0"
    />
  );
}

/**
 * One manifest string. An emptied optional field removes its key rather than
 * writing the empty string the schema refuses.
 */
function TextValue({
  field,
  value,
  optional = false,
  onCommit,
}: {
  /** The manifest key this box writes, which names the control. */
  field: string;
  value: string;
  optional?: boolean;
  onCommit: (value: string | undefined) => void;
}) {
  const { prefix } = useContext(FieldIdContext);
  return (
    <DraftText
      id={fieldId(prefix, field)}
      value={value}
      placeholder={optional ? m.workbench_name_optional() : undefined}
      onCommit={(next) => onCommit(optional && next === "" ? undefined : next)}
    />
  );
}

/** The Default Profile's bindings, read-only: they live in the host's settings. */
function DefaultBindings({
  bindings,
  defaults,
  note,
}: {
  bindings: readonly Binding[];
  defaults: ProfileBindingDefaults;
  note: string;
}) {
  return (
    <>
      <dl data-part="defaults" className="zt:flex zt:flex-col zt:gap-2">
        {bindings.map((binding) => (
          <div
            key={binding.key}
            data-part="actions"
            className="zt:flex zt:flex-wrap zt:items-center zt:gap-2"
          >
            <dt data-part="default-label" className="zt:min-w-0 zt:flex-1">
              {binding.label()}
            </dt>
            <dd
              data-part="default-value"
              className="zt:min-w-0 zt:text-muted-foreground zt:[overflow-wrap:anywhere]"
            >
              {valueText(defaults[binding.key])}
            </dd>
          </div>
        ))}
      </dl>
      <p data-part="secondary" className={nameFolderSecondary}>
        {note}
      </p>
    </>
  );
}

/** Editing an inherited binding stores an override; resetting removes its key. */
function BindingRow({
  binding,
  value,
  fallback,
  citationStyles,
  onWrite,
}: {
  binding: Binding;
  value: string | boolean | null | undefined;
  /** The value in effect where this binding is unset. */
  fallback: string | boolean | null;
  citationStyles: readonly InstalledCitationStyle[] | null;
  onWrite: (value: ManifestScalar | undefined) => void;
}) {
  const { prefix } = useContext(FieldIdContext);
  const readOnly = useContext(FieldIdContext).readOnly;
  const host = useOptionalHost();
  const Toggle = host?.toggle;
  const label = binding.label();
  const inherits = value === undefined;
  const effective = inherits ? fallback : value;
  const id = fieldId(prefix, binding.key);
  return (
    <div
      data-part="binding-row"
      className="zt:flex zt:min-w-0 zt:flex-wrap zt:items-center zt:gap-2 zt:py-2"
    >
      <div
        data-part="binding-heading"
        className="zt:flex zt:min-w-0 zt:basis-full zt:flex-wrap zt:items-center zt:gap-2"
      >
        <label
          htmlFor={id}
          id={`${id}-label`}
          data-part="binding-label"
          className={nameFolderBindingLabel}
        >
          {label}
        </label>
        <span data-part="secondary" className={nameFolderSecondary}>
          {inherits
            ? m.workbench_name_origin_default()
            : m.workbench_name_origin_profile()}
        </span>
        {!inherits && (
          <button
            type="button"
            data-part="reset-button"
            className="clickable-icon zt:ms-auto"
            disabled={readOnly}
            {...tooltipAttrs(m.workbench_name_use_default())}
            onClick={() => onWrite(undefined)}
          >
            <Icon name="rotate-ccw" />
            <span data-part="reset-label" className="zt:sr-only">
              {m.workbench_name_use_default()}
            </span>
          </button>
        )}
      </div>
      {binding.kind === "style" && citationStyles ? (
        <StylePicker
          id={id}
          value={typeof effective === "string" ? effective : null}
          styles={citationStyles}
          onWrite={onWrite}
        />
      ) : binding.kind === "toggle" ? (
        <span
          data-part="toggle-row"
          className="zt:flex zt:items-center zt:gap-2"
        >
          {Toggle ? (
            <Toggle
              id={id}
              aria-labelledby={`${id}-label`}
              value={effective === true}
              disabled={readOnly}
              onChange={onWrite}
            />
          ) : (
            <button
              type="button"
              disabled={readOnly}
              role="switch"
              id={id}
              aria-checked={effective === true}
              data-part="switch"
              data-state={effective === true ? "checked" : "unchecked"}
              onClick={() => onWrite(effective !== true)}
            >
              <span
                data-part="switch-thumb"
                data-state={effective === true ? "checked" : "unchecked"}
              />
            </button>
          )}
          <span data-part="muted" className={nameFolderMuted}>
            {valueText(effective)}
          </span>
        </span>
      ) : (
        <DraftText
          id={id}
          value={effective === null ? "" : String(effective)}
          placeholder={
            binding.kind === "style"
              ? m.workbench_name_citation_style_placeholder()
              : m.workbench_name_value_vault_root()
          }
          // A style is named or absent; a folder path is a string, and its
          // empty form is the vault root.
          onCommit={(next) =>
            onWrite(binding.kind === "style" && next === "" ? null : next)
          }
          binding
        />
      )}
    </div>
  );
}

/**
 * The citation style as the vault's own list. A style the profile names that the
 * vault has not installed keeps its place in the list, so opening the picker
 * never quietly rewrites a value the reader did not touch.
 */
function StylePicker({
  id,
  value,
  styles,
  onWrite,
}: {
  id: string;
  value: string | null;
  styles: readonly InstalledCitationStyle[];
  onWrite: (value: ManifestScalar) => void;
}) {
  const readOnly = useContext(FieldIdContext).readOnly;
  const options =
    value !== null &&
    value !== "" &&
    !styles.some((style) => style.id === value)
      ? [{ id: value, title: value }, ...styles]
      : styles;
  return (
    <WorkbenchSelect
      id={id}
      disabled={readOnly}
      value={value ?? ""}
      onInput={(event) =>
        onWrite(
          event.currentTarget.value === "" ? null : event.currentTarget.value,
        )
      }
    >
      <WorkbenchOption value="">{citationStyleLabel()}</WorkbenchOption>
      {options.map((style) => (
        <WorkbenchOption key={style.id} value={style.id}>
          {style.title}
        </WorkbenchOption>
      ))}
    </WorkbenchSelect>
  );
}

/**
 * The language key, which one confirmation changes on its own. Nothing is
 * translated: the note name, the note, and the Annotation Section stay as the
 * author wrote them, one undo away.
 */
function LanguageGroup({
  language,
  onWrite,
}: {
  language: string;
  onWrite: (key: string, value: ManifestScalar) => void;
}) {
  const { prefix } = useContext(FieldIdContext);
  const readOnly = useContext(FieldIdContext).readOnly;
  const [pending, setPending] = useState<string | null>(null);
  return (
    <Group
      heading={m.workbench_name_language_heading()}
      lede={m.workbench_name_language_lede()}
    >
      <Field label={m.workbench_name_language_heading()}>
        <WorkbenchSelect
          disabled={readOnly}
          id={fieldId(prefix, "language")}
          value={pending ?? language}
          onInput={(event) => setPending(event.currentTarget.value)}
        >
          <WorkbenchOption value="liquid">
            {m.workbench_name_language_liquid()}
          </WorkbenchOption>
          <WorkbenchOption value="eta">
            {m.workbench_name_language_eta()}
          </WorkbenchOption>
        </WorkbenchSelect>
      </Field>
      {pending !== null && pending !== language && (
        <div
          role="alert"
          data-part="confirmation"
          className={nameFolderConfirmation}
        >
          <strong data-part="strong">
            {m.workbench_name_language_confirm_heading()}
          </strong>
          <p data-part="prose">{m.workbench_name_language_confirm_body()}</p>
          <div
            data-part="confirmation-actions"
            className="zt:flex zt:flex-wrap zt:items-center zt:gap-2"
          >
            <button
              type="button"
              disabled={readOnly}
              data-part="confirm-button"
              className={nameFolderConfirmButton}
              onClick={() => {
                onWrite("language", pending);
                setPending(null);
              }}
            >
              {m.workbench_name_language_confirm()}
            </button>
            <button
              type="button"
              data-part="cancel-button"
              className={nameFolderCancelButton}
              onClick={() => setPending(null)}
            >
              {m.workbench_name_language_cancel()}
            </button>
          </div>
        </div>
      )}
    </Group>
  );
}
