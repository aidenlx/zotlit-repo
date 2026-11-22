# UI seams

Functional core, imperative shell — logic returns data and publishes events;
the seam owns rendering. Effect code shows notices through the `Notifier`
service (`packages/obsidian-kit/src/notifier.ts`: `show`, `reportOutcome`, `reportProgress`).
A Promise edge with no Notifier uses `BaseNotice` (`@zotlit/obsidian-kit/notice.ts`) or
`toast.promise` (`@zotlit/obsidian-kit/toast.ts`). Unload silence follows `unload.md`.

Conditional flows decide when to show UI; a dedicated function at the seam
owns what to render and stays callable independently of the trigger. This also
lets `/obsidian-debug` inspect the UI without falsifying trigger state.

Reach for the lowest rung that fits:

1. A function returns the outcome; the caller renders it
   (`packages/notes/src/desktop/note-import/batch-import-notices.ts`).
2. A service publishes on its `changes` Stream; a notices layer shows each
   event (`@zotlit/notes/desktop/note-feature/notices.ts`).
3. A decision tag, only when the user's answer feeds back mid-flow: it
   answers a typed value, a dismissal included (`awaitConfirm`,
   `packages/obsidian-kit/src/confirm.ts`). Work that a dialog's callbacks started stops with
   `UserCancelled` (`packages/plugin-kernel/src/user-cancel.ts`) when the user closes the dialog
   (`runDialog`, `@zotlit/notes/desktop/profile/dialogs.ts`); unload stops it as an
   interrupt (`unload.md`).

Tests observe the core: returns, events, and decision answers. Only a test of
notice behavior itself checks Notifier calls through `testNotifier()` /
`layerSignalling` (`packages/obsidian-kit/src/__fixtures__/notifier.ts`): the Notifier, a notices
layer, a function that renders an outcome. A test that needs a notice to see
what its module did marks a module to reshape onto a rung above. A test that
would mock `@zotlit/obsidian-kit/notice.ts` or `@zotlit/obsidian-kit/toast.ts` marks a module to move behind the
Notifier; lint rule `zotlit-effect-tests/no-notice-mock` enforces this.

## View state and menus

View state is a **per-leaf model of Effect atoms**, changed by pure transitions and read through the view registry ([ADR 0082](../docs/adr/0082-obsidian-views-read-effect-services-through-view-atoms.md)). Follow `packages/annotations/src/obsidian/annot-view/model.ts`; the vanilla-DOM surfaces in the PDF reader follow `packages/annotations/src/obsidian/pdf-annotation-editor/reader-surface-model.ts`.

Menus and popovers are Obsidian's own `Menu` and popover primitives, built imperatively and shown from the gesture that opens them — inside a Preact tree as much as in vanilla DOM. The Annotation View's cards are the pattern: `packages/annotations/src/obsidian/annot-view/presentation.ts` answers which entries exist, `packages/annotations/src/desktop/annot-view/menus.ts` fills a `Menu` from them, `actions.tsx` beside it shows it, and the component calls the action; `pane-menu.ts` puts the same entries in the pane menu. A menu opened from a control is anchored under it with `showMenuAtButton` from `packages/obsidian-kit/src/menu.ts`, which keeps a keyboard-activated control and a popout host both correct; `showAtMouseEvent` is for a right-click. Obsidian owns placement, viewport clamping, theme, and chrome ([ADR 0044](../docs/adr/0044-menus-and-popovers-are-obsidians-own-primitives.md)). A menu opened from inside a Chooser — the "…" of a Chooser page — is `Chooser.PageMenu`, a popover nested in the popup, since a `Menu` paints under the popup's top layer.

A control that opens a popup — a `Select`, a Chooser, a popover of its own — meets every item of [Keyboard and focus](../docs/bases-toolbar-menu.md#keyboard-and-focus).

## Chooser page fields

A field on a `Chooser.Page` keeps its typed text with `useChooserPageText` and saves through `useChooserPageSave`, plus its own blur and Enter handlers (both hooks live in `packages/obsidian-kit/src/components/chooser.tsx`). A page unmounts with no blur event, and an input followed by a key in the same task reads stale state; the save reads the `typed` ref from `useChooserPageText`, not the rendered `text`.
