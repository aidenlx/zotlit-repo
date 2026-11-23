# The surfaces inside the PDF reader are vanilla DOM on Obsidian's popover

The Mark Popup parts below, including the amendment "the Mark Popup's tag section is a Preact island", are superseded by [ADR 0065](0065-the-mark-popup-is-one-preact-root-on-obsidians-popover.md): the Mark Popup is one Preact root on Obsidian's popover. The Annotation Marks and the Creation Toolbar stay vanilla DOM.

The capability indicator described below is amended by [ADR 0047](0047-annotation-reading-is-continuous-and-editing-is-an-added-capability.md): a labeled enable-editing action guides setup, and ordinary read-only use carries no permission warning.

Every other ZotLit surface is a Preact root. The three surfaces ZotLit puts inside Obsidian's native PDF reader are not: the Annotation Marks on each page, the Creation Toolbar in the reader's own toolbar slot, and the Mark Popup are vanilla DOM, and the Mark Popup is Obsidian's `HoverPopover` on the plugin's popout-aware base. No Preact root lives in the reader.

## Considered Options

- **Preact for the Annotation Marks** (rejected): PDF.js `reset()` removes every child of a page that is not on its keep-list on zoom, rotation, and page recycle, so each render is a full rebuild from data. A diff has nothing to reconcile, and a Preact root would need a re-append trick to survive the wipe.
- **A Preact root in the reader's toolbar slot** (rejected): six flat controls (tool, colour, visibility, Editing Capability) need one render function that sets classes, `aria-pressed`, `aria-disabled`, and tooltips. A component tree is more machinery than the surface needs.
- **A headless popover library for the Mark Popup** (rejected): a second positioning engine beside Obsidian's, its own dismissal rules to override, and a portal to manage. The selection prototype had to fix two dismissal defects in it. [ADR 0044](0044-menus-and-popovers-are-obsidians-own-primitives.md) rejects the same library for the same reasons on every other surface.
- **Vanilla DOM on Obsidian's own primitives** (chosen): the Annotation Mark renderer is already a tested pure function, the toolbar reuses `clickable-icon`, `setTooltip`, and `Menu`, and Obsidian owns the popup's placement, viewport clamping, theme, and chrome.

## Consequences

- Annotation Marks are rebuilt per `pagerendered`. They are paint: `pointer-events: none`, hit-tested by geometry, with `is-selected` as the only mutable state. The overlay SVG is the one node ZotLit mounts under a PDF.js-owned element, and it is disposable by design.
- The Creation Toolbar's nodes go into `.pdf-toolbar-right` as bare `clickable-icon` elements with layout utilities and no `.zt-root`, so no preflight reaches Obsidian's toolbar. The binding's disposer removes them; Obsidian's `empty()` on unload also clears them, so removal is idempotent.
- The Mark Popup extends the plugin's `HoverPopover` (`@/lib/hover-popover`) directly. It is constructed with `targetEl: null`, `waitTime: 0`, and a `staticPos`, then pinned with `setIsFocused(true)`, because a fresh `HoverPopover` always waits its delay before the first `show()` and only `isFocused` keeps it open with no target. Mouse-out never closes it; the binding calls `hide()` from the selection state and the hit test's outside-press rule. Retargeting is a new `staticPos` plus `position()`. Its content row carries `.zt-root`.
- The popup's anchor is a virtual point, the bottom-centre of the selected Annotation Mark's union rect (or the fresh text selection's), recomputed on `pagerendered` and on container scroll, because `reset()` can wipe the mark while the popup is open. Obsidian prefers placement below and falls back above.
- The per-view binding is the popup's `HoverParent`, so Obsidian's Page Preview on the PDF view keeps its own `hoverPopover`.
- The Editing Capability affordance is "one copy table and icon map, two renderers": a pure module the reader renders with its vanilla function and the Annotation View renders in its Preact toolbar. The cooldown countdown is a `setInterval` under the binding's disposer in the reader and an effect in the view.
- Reader surfaces publish through the Reader Session; no reader code imports Preact. A Preact root inside `hoverEl`, the citation popover's pattern, stays available if the popup row grows, at no lifecycle risk.

## Amendment: Mark Handles and the selected mark's body take the pointer

While editing is live, the Mark Handles of the selected Annotation Mark and the body of a selected image or ink mark take pointer events. A Geometry Edit captures the pointer from the press, and each grip shows the cursor of what a press there does, so these nodes carry `pointer-events: all`. Which grip a press takes is still decided from geometry, as a mark click is. This is the one exception to "Annotation Marks are paint": every other mark, and every mark while editing is not live, stays `pointer-events: none`, so text selection and PDF links under an unselected mark keep their path, and the body of a selected highlight or underline stays the text selection's.

## Amendment: several Annotation Marks can be selected

With the Card Selection owned by the Annotation View ([ADR 0061](0061-the-annotation-view-owns-its-card-selection.md)), the reader paints `is-selected` on every mark in a Card Selection of several. The Mark Popup and the Mark Handles stay for a single selected mark, so the popup's anchor is still one mark's union rect. The PDF gains no multi-select gesture: a mark click selects that mark alone. The reader's colour keys and Delete act on every selected mark, and ↑/↓ reduce a selection of several to one mark.

## Amendment: the Mark Popup's tag section is a Preact island

Accepted 2026-09-25. Annotation Tags are shown and edited inline in the Annotation Card and in the Mark Popup through one composition, `TagsInput` from `@zotlit/ui` ([root ADR 0061](../../../../docs/adr/0061-shared-ui-parts-are-unstyled-compositions-in-zotlit-ui.md)). The Mark Popup renders its tag section, the chips and the inline editor, as a Preact root in its own element under the popup column: the pattern held available above. The row, the comment view, and the comment sheet stay vanilla DOM, and the Annotation Marks and the Creation Toolbar have no Preact. The island mounts when the tag section appears and unmounts when the popup rebuilds its content or hides, under the binding's disposer.

A vanilla builder shared the way the comment sheet is shared was rejected. The same parts also serve the Workbench's Match conditions, which is a React tree on the web and a Preact tree in Obsidian, so only a JSX composition has one copy of the key, focus, and duplicate rules for all three consumers. The reader rule narrows from "no reader code imports Preact" to "only the Mark Popup's tag section imports Preact".

## Pointer geometry and reading order

`hit-test.ts` identifies the mark from geometry. A click travels less than
four CSS pixels and leaves the browser text selection collapsed. A native
PDF link owns a plain click. Alt lets the mark receive it. A click away
clears the selection. A repeated click at the same point steps through the
marks under it and wraps. The first click takes the smallest summed
rectangle area, which gives a contained word priority over its paragraph.

The overlay scales each axis independently. Hit testing inverts those
scales, using a two-pixel pad for page and rectangle hits. Ink uses the
stroke reach after a bounding-box check. The Mark Popup anchors at the
bottom centre of the union of the mark rectangles, with the host popover
handling placement above or below.

`reading-order.ts` sorts by page, descending top edge in PDF user space,
then left edge. The Zotero list order and text Sort Index serve different
purposes. A mark that draws nowhere is outside the keyboard sequence. A
mark that crosses a page break uses its first page, where its text starts.
Arrow keys wrap and enter the sequence at the relevant end if no mark is
selected.

## Geometry edits

`geometry-edit.ts` follows Zotero's handle layout and resize rules. In PDF
space, the top edge has the larger y coordinate. Image marks show corners
and edge midpoints. Ink shows the corners of the stroke box with five points
of padding on each side. Ink needs both span dimensions to scale, although
a dot or line can still move. Free text shows corners and side midpoints on
a padded, rotated rectangle. Notes only move. A square handle has a
five-CSS-pixel radius at any zoom. Corners win their overlap with midpoints.

Highlights and underlines use strips across the reading direction at the
start and end of the text range. Their half-width is three CSS pixels.
The strips follow the rotation of the characters under their own
rectangles. Each strip belongs to its own page, including the end of a
range that crosses a page break. Start wins when the strips overlap. The
range's body stays available for text selection. Handle cursors follow page
rotation.

The drag proposal uses confirmed geometry and displacement since the press.
An image's edges stop at the page box and preserve a ten-point minimum.
Creating an image sticks to the page that took the press. An image of
exactly ten points on both sides is large enough. Body moves clamp to the
page box. For text, the clamp uses the rotated extent. Ink body moves
translate every stored point. Ink corner drags use horizontal movement to
set proportional scale while keeping the opposite corner fixed. The short
side cannot shrink below one PDF point. Pen width changes by the square
root of the area scale. Text edge drags refit height while keeping the font.
Release refits a single-line box without the comment editor's 300-point
cap. Text corner drags preserve proportions and scale the font while
keeping the turned opposite corner fixed. Drag font sizes round down to
half points. Keyboard resize rounds to the nearest half point. A zero
rounding result keeps the old font.

Plain arrows walk reading order. Shift moves a text range's end, Mod+Shift
moves its start, and Shift resizes images, ink, or free text. Alt nudges
movable marks. Image keys move the right or bottom edge. Ink keys scale
about the top-left corner, with horizontal arrows stepping width and
vertical arrows stepping height. Free-text keys resize the right side or
scale about the top-left. The step is five PDF points. Nudging checks
for a step plus five points on the destination side, relative to the page
box's origin. The stored rectangle and visible rectangle can differ on
rotated text. [Rotated nudge follow-up](https://github.com/aidenlx/zotlit-repo/issues/60)

Geometry equality uses the serialized position, including Zotero's
three-decimal rounding. The tests use a nonzero page origin and calculate
rotated corners independently. Their resize cases distinguish untouched
axes, the opposite-corner invariant, and font or pen scaling from mere
translation.

Creation and selection share `surface.ts` for geometry and input. They
read selection from the reader window and count only a selection anchored
in the reader. The page box excludes the uniform border. A drag prefers
the drawn overlay box because client border measurements are rounded.
When the overlay is absent it uses the page box. The client-to-PDF map
supports positions beyond the page during a drag, and the operation then
applies its own clamp. Cleanup releases pointer capture only if the
container still holds it.

[Zotero gesture and keyboard behavior](https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/pdf-view.js)
[Zotero geometry utilities](https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/lib/utilities.js)
[Zotero annotation size limits](https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/common/defines.js)
[Zotero ink transforms](https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/lib/path.js)

## Annotation overlay rendering

`render.ts` groups parsed PDF positions once when the repository answers.
Each page receives only the rectangles it draws, including its own half
of a range that crosses a page break. Non-PDF positions have no mark.
Ink and free text need their matching position variants. A page jump
centres the first rendered mark for the requested key on that page, so a
jump to either half of a range lands on that half.

The SVG uses a PDF.js viewport rebuilt at scale one. Its view box maps
independently onto the laid-out page on each axis. The browser scales the
overlay with the page, and the renderer can reuse the same coordinates at
every zoom. The renderer maps the two diagonal PDF corners and normalizes
the result for all four page rotations. It prefers `clone` to avoid
division roundoff. A viewport without `clone` requires a fallback that
undoes zoom. Lengths in PDF points scale by the page's UserUnit, as the
amendment "PDF-point lengths scale by UserUnit" states. [UserUnit sizes](https://github.com/aidenlx/zotlit-repo/issues/61)

The renderer paints pending strokes below marks. Selection leaves the
mark's own colour intact. A rectangle-based mark gets a separate
one-pixel ring around the union of its rectangles, with a 1.5-unit gap.
Non-scaling strokes keep the ring legible across zoom levels. The
free-text ring follows the stored box's own rotation. The accent colour
comes from the stylesheet so it follows the theme. Rings paint over
adjacent marks. Selected ink instead gets a wider copy of the same path
beneath the other marks. The pen covers the middle, and the accent band
inherits the shape of the line, its round caps, and its joints. The casing
uses the pen width plus 1.5 page units per side, set inline to override
the stylesheet's hairline width.

Handles paint above the ring. They and movable mark bodies accept pointer
events for cursor feedback, with hit testing still based on geometry.
Turned free-text handles show Zotero's move cursor. A live image capture
draws a three-pixel frame in the tool colour and fades it until both
dimensions meet the ten-point minimum. Live ink, pending ink, and saved
ink use the same path builder. The first point adds both a move and a line
command so that a round cap draws a single-point dot. Live ink updates
the existing stroke node. Image and ink previews can create an overlay
on an empty page and remove it when it becomes empty again. A geometry
drag patches the selected mark, ring, and handles in place, with a full
rebuild if the expected nodes are absent or differ in number.

On-screen ink and free text use Zotero's colour darkening. Excerpt images
use the stored colour. Highlights use theme-specific blending so that
the text remains readable in both themes. The note glyph follows
Lucide's 24-unit grid with a lower-right fold. The crease is an open line
that inherits the body's stroke width, and the theme can tune the body's
fill opacity.

The tests use the annotation colours from the `rougier-2014.pdf` fixture
and a fixed-width text measure for a reproducible one-line sample.
Viewport expectations come from the PDF.js matrix, independently of the
renderer. They cover a shifted origin, a nonstandard page unit, and four
right-angle rotations. At zero rotation, the test rectangle from
`(100, 700)` to `(200, 720)` lands at `(100, 72)` with size
`100 × 20`. The tests compare geometry to three decimal places to absorb
floating-point noise. Ink boundary tests require a strict distance below
the reach, matching Zotero. A loop and a long sparse segment distinguish
distance to the pen from distance to the bounds or the stored vertices.

[PDF.js viewport](https://github.com/mozilla/pdf.js/blob/v5.3.31/src/display/display_utils.js)
[Zotero mark and draft drawing](https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/page.js)
[Zotero colour adjustment](https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/lib/utilities.js#L514-L520)
[Lucide sticky note](https://lucide.dev/icons/sticky-note)

## Reader style and pointer state

`style.css` uses zero-specificity defaults where a theme is expected to
override the styles. Tool cursors use stronger selectors to override
PDF.js text-layer cursors, including spans with an image role. Handles
keep their cursors with other tools armed. Ink takes precedence because
it takes every press. During a captured gesture, the reader supplies
the cursor after the pointer leaves its original element. Arming ink
sets `touch-action` on the PDF scroller before the press because the
browser resolves that property when the finger lands. The toolbar and
sidebar keep their own touch scrolling.

The Creation Toolbar follows Obsidian's toolbar spacing and active
treatment. In a split button, the seat owns the shape and the active
fill. Each half has its own hover target. Hover on an active half shows
the seat's fill through it. The two inner corners meet square, with
reduced padding at the seam. The seat leaves the external focus outline
visible. The chevron is smaller so the tool stays prominent. The CSS
sets host icon longhands at sufficient specificity to answer unlayered
Obsidian rules. The armed icon keeps its tool colour.

## Reader controls and their scope

Read a mark dropped onto a note through the same Annotation Note Actions that the Annotation View uses. The toolbar's availability status uses layout utilities without `.zt-root`. The binding can remove it after Obsidian has already cleared the slot. Use Obsidian's window-aware `instanceOf` for text entry checks so the same keymap works in pop-out windows.

Put the Reader Keymap Scope in front of the PDF view's Scope. Register Escape through the catch-all so Obsidian can still close its find bar when ZotLit has nothing to dismiss. A keyed registration handles a specific application chord while that view is active. Only consume the native copy action when selected marks supplied something to copy. [Reader Keymap](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/reader-keymap.ts)

Use the six Zotero tools in Zotero's toolbar order. The tool's gesture table selects the creation path, with highlight as the default text selection action. Store explicit colors sparsely so an unset tool still follows its Zotero default. Keep the recent colors shared across tools and skip writing settings when the most recent color stays the same. Settings carry these choices, pen width, and font size across PDFs. Validate size and width against the choices and use the default for an invalid saved value. Match Zotero's initial values, including the fourth swatch for ink. [Tool settings](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/tools.ts) · [Zotero defaults](https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/common/reader.js#L171-L206) · [Zotero width and size steps](https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/common/defines.js#L48-L55)

Run tests of the PDF surface fixture under Vitest's Happy DOM environment. Use Annotations from the Rougier Fixture and wire the surface fixture with one registry, one popup host and the view's held Attachment list. Deliver keys through the view Scope before the page, matching the host. Dispose the fixture's scope and ignore page paints and refreshes after closure. [Reader surface fixture](../../../../packages/annotations/src/__fixtures__/pdf-annotation-editor.ts)

Selection and creation share pointer and keyboard listeners. Give the selected mark the first chance to handle a key. Read the browser's selection on pointer release and hear non-bubbling page scrolls in capture. Recompute pointer placement after a scroll even if the pointer stayed still. Hear document presses in capture for both inside and outside gestures. A lost capture ends the associated creation gesture unless release already cleared it. Leave PDF links in control of an ordinary click. Alt-click and the stack stepper can select the covered mark.

A main-button press on a selected mark can make its page draggable for that press. Geometry edits, armed capture and selected text take precedence. Use an Obsidian drag ghost with the Annotation type and text so the browser does not show a picture of the entire page. Remove the ghost after the browser takes its snapshot. The Happy DOM test supplies `dataTransfer` and spies on `setDragImage` because the harness has no native drag image. Map numeric color keys to the palette order and apply them to the selected group. Delete and Backspace use the same command, including the Mac key marked Delete. [Mark Selection](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/selection.ts) · [Selection tests](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/selection.test.ts)

### Highlight outline tracing

Draw the outline of the padded text rectangles along the union boundary. A bounding box hides the steps of uneven text lines, and shadowing separate rectangles can smear a continuous row edge. Band near-identical viewport coordinates within 0.01 page units of the band's first coordinate. This removes conversion slivers such as the 0.004-unit edge difference in the Rougier Fixture's three-line Annotation `K3JRFLFQ`. Keep three decimals in SVG output to preserve separate bands without printing floating-point tails.

Sweep rows of constant coverage. The difference between adjacent rows gives the horizontal edges. Each row's merged interval ends give the vertical edges. Walk unused edges into closed subpaths. At a vertex where two rectangles touch at the corner, either continuation preserves every stroked segment because the vertex has even degree. Remove redundant collinear points, including at the loop's closing joint. Tests compare drawn segments or normalize loops by start and winding, since neither affects the visible stroke. [Outline tracing](../../../../packages/annotations/src/core/pdf-annotation-editor/rect-union-outline.ts) · [Outline tests](../../../../packages/annotations/src/core/pdf-annotation-editor/rect-union-outline.test.ts)

### Creation gesture routing

A selection commits at once when a text selection tool is armed. Otherwise it opens the create popup after placement. Keep a foreground selection, note, text, or image create exclusive until its reply. Reveal its created mark. A successful note or image create disarms its tool. Place a note as Zotero's fixed square centered on the press without clamping it, then open its comment editor. The note and text tools require a release within click slop. A mark under the press keeps that gesture from the note, text, or image tool. An image drag clears the browser selection, captures the pointer, and updates its box against the current page position. Its preview stays through the reply, including a refusal. A second pointer cancels the capture or held click. A later press outside the popup dismisses the settled selection. Reject a delayed placement if a new gesture began or the view closed, and verify the browser selection still exists before publishing.

A toolbar pointer press focuses the pages so the next shortcut acts in the Reader. The toolbar's color menu aligns to the chevron's far edge. A color chosen in the create popup becomes that tool's saved color. Use the actual event target to distinguish a toolbar press from the page scrolled underneath it. Escape cancels active ink or image capture, finishes a Text Draft, closes the comment sheet, dismisses a waiting selection, or disarms the active tool, in that order. [Creation gestures](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/creation.ts) · [Zotero note dimensions](https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/common/defines.js#L27) · [Zotero note placement](https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/pdf-view.js#L3104-L3122)

The fixture supplies the page and selection boxes that Happy DOM does not lay out. The rest of the placement runs through production code. Advance the popup timer after release because Obsidian opens it asynchronously even with no delay. [Creation tests](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/creation.test.ts)

Lay out each tool's toggle and color chevron in one seat. Its armed fill covers both halves, while the toggle alone carries `aria-pressed` and the chosen swatch. An enabled chevron opens its own tool's menu. Name the group with a hidden element to give assistive technology a name without a tooltip over the group. Mark visibility remains available because it changes no Zotero data. The toolbar offers creation and visibility controls and omits a bulk erase command.

Build one capability slot and let its own renderer update it. Build each toolbar control with listeners and check the latest drawn model at activation. This keeps blocked controls visible with their reason and lets them respond again when editing returns. Each div button declares its role, keyboard activation, and disabled state. Keep the button and its icon node through equivalent redraws so the pointer can complete the click. Apply color to the element style so theme variables resolve. Use the activated node as the menu anchor for both pointer and keyboard input. [Toolbar](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/creation-toolbar.ts) · [Icon button](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/icon-button.ts)

Every numeric color shortcut from 1 through 8 has a corresponding swatch in the create row.

Keep the live Geometry Edit proposal across overlay rebuilds. Patch the selected mark in place where possible and repaint pages that cannot be patched, including a page the range no longer spans. Repaint image capture and Live Stroke previews after an overlay rebuild removes their nodes. Keep the capture crosshair and range drag text cursor on the captured pointer. [Reader binding](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/binding.ts)

Use one palette across the Card, Mark Popup, and Creation Toolbar. A public Obsidian menu title fragment shows the swatch and name together. A group marks a color checked only if all selected marks have it, ignoring case. Run the menu test with a DOM for the title fragment. The toolbar tests assert that each chevron names its own tool, and the tool tests pin the first default swatch for every tool except ink, which takes the fourth. [Color menu](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/color-menu.ts)

Check that a Mark Popup stays in the reader's popout when focus moves to
the main window. An untargeted native popover uses the focused window
on each placement. Open the popup with a click, move focus, and scroll
the popout so its popup is placed again without a click.

[Popout placement proof](../../../../packages/e2e/src/mark-popup-window.ts)

## Amendment: PDF-point lengths scale by UserUnit

Accepted 2026-11-23 with [#61](https://github.com/aidenlx/zotlit-repo/issues/61) and [PR 241](https://github.com/aidenlx/zotlit-repo/pull/241) (`e300e898d`). On the `clone` path a page unit is a PDF user-space unit times the page's UserUnit, so a length stored in PDF points needs the same factor. `toPageUnits` returns `unitsPerPdfPoint`: the UserUnit on the `clone` path and 1 on the fallback, whose units are already PDF points. The saved text's font size and line advance, the ink stroke width (saved, pending and live), the ink casing, the ink hit reach and the Text Draft's display scale use it. On a UserUnit 2 page, text, ink and the Text Draft keep the size relative to the page that they have on a UserUnit 1 page. Every Reader viewport has `clone`, so only test fixtures reach the fallback.

Accepted limits:

- The interaction tolerances (handle radius, ring padding, click slop and the minimum ink reach) keep their current sizes and do not scale with UserUnit.
- The range-strip padding is in page units inside a rectangle in PDF space, so it grows with UserUnit. This was so before the change.

UserUnit pages are rare in research PDFs; they occur in large-format drawings. The maintainer retitled the issue to this defect on 2026-11-23.
