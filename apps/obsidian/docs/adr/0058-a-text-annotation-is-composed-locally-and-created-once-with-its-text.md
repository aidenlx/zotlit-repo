# A text Annotation is composed locally and created once with its text

The text tool in Obsidian's PDF reader opens a Text Draft at a click: a textarea over the page, held in the Reader Surface State and in no store of Zotero's. Its box is refitted in Obsidian on each input by a port of Zotero's own box fit. When the draft is finished (Escape, a press elsewhere, blur, a tool change, or the view's disposal), text beyond whitespace is created through the Zotero Local API as one text Annotation, with the typed text as its comment, its fitted box, and the Page Label and Sort Index computed from that box. A draft with no text creates nothing. The draft stays drawn while the create is in flight, and the read that holds the record removes it in the same update.

Zotero's reader works the other way: it creates an empty text Annotation at the press, saves each keystroke as an update, and deletes the Annotation if it is still empty at the next deselect. Over the Local API that would be one create and a stream of patches per text box, a visible empty Annotation in Zotero while the user types, and a cleanup delete that ZotLit would have to own through every failure, including a view that closes before the delete runs.

## Considered Options

- **Create empty at the press and patch each keystroke, as Zotero does** (rejected): many writes per box, each through the capability gate and the version check, and an empty Annotation that exists in Zotero until ZotLit deletes it.
- **Create empty at the press, patch once at the finish** (rejected): still two writes and a delete path for an empty box, and Zotero shows an empty Annotation while the user types.
- **Compose locally, create once at the finish** (chosen): one write per text Annotation, through the one create path every tool uses; ZotLit never writes an empty text Annotation that it must delete.

## Consequences

- A text Annotation appears in Zotero only when the user finishes typing, not at the click. This is the one visible difference from Zotero.
- The Text Draft, the saved mark, and the box fit use one font and a common fitting measure to keep lines stable. The fitted box is widened to Zotero's stored thousandths of a point, so rounding cannot wrap a line that fitted. Zotero refits the box in its own font at its own next edit.
- The Sort Index comes from the fitted box, as a Geometry Edit's does; Zotero's comes from the square at the press. The two can differ by the characters between them.
- A create that fails, or a capability that lapsed before the finish, takes the draft off the page and reports through the create failure notice; the typed text is lost.

## Textarea behavior

`text-draft.ts` uses a plain textarea at one CSS pixel per PDF point and
scales the whole box to the page. This avoids per-glyph rounding at small
zoom. The same box, font, rotation, and darkened color guide the saved
mark. The textarea uses the exact width of the fitted box. When the fit
sets the width from the widest line of multiline text, it adds one point.
This allowance absorbs small differences between DOM and canvas measurement.
[Zotero textarea](https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/page.js#L860-L947)

While focused, the textarea holds its own Scope above the PDF view. Escape
finishes the draft and leaves the find bar alone. During IME composition
the key stays with the input method. Pointer events stop at the textarea.
A page re-render can detach it briefly, so blur finishes only if it is
still on the page when the microtask runs. Removal releases the Scope even
if no blur fires. If the textarea held focus, focus moves to the page text
layer so the next key reaches the reader. If focus already moved elsewhere,
it stays there.

## Geometry and fitting

`free-text-layout.ts` uses an injected text measure so layout and fitting
can run without DOM. The page viewport maps the baseline and reading
direction. The stored annotation rotation turns the text and its rectangle
about the rectangle's own centre. Its sign changes between PDF user space
and page coordinates. The ring receives only the stored turn because the
viewport has already transformed its rectangle. The hit area is the
axis-aligned extent of the turned stored box, before ring padding. SVG
applies transforms from the
last entry back to the first. Geometry tests calculate the four viewport
rotations and expected corners independently from the layout code.

The line height is 1.2 times the font size. Layout first preserves explicit
newlines. It measures candidate lines without their trailing space to match
the textarea. A word too wide for a line of its own breaks into characters,
also when it follows another word, as the textarea's `break-word` does.

With the normal comment-edit mode, a box at least two font sizes high
keeps its width. A shorter box fits to its widest line. The fit adds five
points for a single line and one point for multiple lines. The normal
single-line width caps at 300 points. The calculation measures an empty
text as one letter. It keeps the turned top-left corner fixed as the box
grows. The page inset is five points. A width-preserving fit can move the
box to stay inside it, while the other fit changes width to address
horizontal overflow.
A resize across an edge preserves width during the edit. The finished
edge drag can fit one line without the 300-point cap. Fits use exact
measurements, and the stored fit widens to the next thousandth of a point
so serialization cannot narrow the box below the measured line.

Corner anchoring keeps the chosen corner in place after both the old and
new boxes rotate about their own centres. PDF coordinates count up from
the bottom, so a top corner uses the larger y coordinate.

[PDF.js viewport](https://github.com/mozilla/pdf.js/blob/v5.3.31/src/display/display_utils.js)
[Zotero text fitting](https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/lib/text-annotation.js)
[Zotero rotation and resizing](https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/lib/utilities.js)
[Zotero line breaking and height](https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/lib/render.js#L10-L45)

## Host font and text draft styles

`render.ts` measures the Obsidian document's interface font for the saved
mark, the Text Draft, and the fit calculation, so all three wrap the text
using the same widths. Zotero's reader uses its interface font the same
way. The saved SVG sets the same text spacing as the measure and places
each line in the unrotated text frame before the group applies the turn.
The draft textarea uses its fitted box and font through CSS properties.
Its selectors cover the interactive states where Obsidian applies
unlayered textarea styles, so the draft looks like page text throughout
editing. Its line height matches the saved mark.

[Zotero reader font](https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/common/reader.js#L54)

Compare text creations by their serialized position, color, and text. The comparison uses the same outward rounding as storage.

Fit free-text heights from the text and its display font. Refit the box on release of an edge resize.

Open a Text Draft at the press point with the saved tool color and font size, then disarm. A new tool, an outside press of any button, blur, Escape, or disposal can finish the draft. The disarm that opens the draft leaves it active. Whitespace-only text creates nothing. Persist a committed draft's text in the Annotation comment and fit it with the display font. Keep the draft visible while the created record is pending and remove it on refusal.

Retain the Text Draft's document structure and start its page and Page Label reads when the draft opens, since the Reader can release the document before disposing its surfaces. Run placement and submission to completion during disposal because the typed text has no other copy. If capability expires, report that this specific creation failed. The test harness models the destroyed document and uses deterministic half-em character widths because Happy DOM has no canvas measurement. [Text Draft creation](../../../../packages/annotations/src/obsidian/pdf-annotation-editor/creation.ts)

Start the unrotated Text Draft as a square one font size wide centered on the click. Refit it on each edit and freeze further input when saving. A record with the returned key can take its place. A read may arrive first, so a match on the serialized box, color, and text also swaps the draft for the saved mark in one update. Tests exercise the normalized color and rounded box. [Zotero text tool placement](https://github.com/zotero/reader/blob/df215c60334d2d0c7b1fbc9f3959b66afc1ced83/src/pdf/pdf-view.js#L3123-L3151)

Keep the Text Draft textarea through page repaints and reattach it with focus when its page rebuilds. Skip the binding's focus-triggered refresh for this textarea, since opening the draft would race its eventual create. The Keymap lets a text field retain its native keys.

### Paired text draft proof

Use a laid-out page and a point clear of seeded marks.
A press opens and focuses the draft and disarms the tool.
The stored square anchors the text box half a font size up
and left of the click, with client coordinate rounding.
Verify the Reader and overlay use the same stored box, including
wrapped text. A press outside the draft saves. For a
background window, send the blur event directly because
calling blur alone may not deliver it. A saved mark can stay
selected under its popup while focus remains in the Reader.
Escape on an empty draft clears it.

Close the font-size menu through Escape outside the Reader
Scope so the text tool stays armed. Wait for the menu before
sending keys. Verify the selected size after reopening the
Reader. For color, apply Zotero's channel rounding when
checking the darkened swatch. Create a text Annotation through
the Local API to check an independently stored box. Let the
page finish layout before measuring text and verify that
Obsidian's font stays within the box Zotero sized.

[Paired text cases](../../../../packages/e2e/src/paired-annotation-tools.e2e.ts)

For free-text geometry, measure the actual font on a canvas
independently of the product's layout. Resizing width wraps
the comment at the chosen width and keeps the top-left
anchor. A corner can scale from width alone and rounds the
font size to a half point. A consumed geometry key prevents
the page default during handling. A note nudge must keep
its size, including after the time a late resize would
have landed.

[Text and note geometry cases](../../../../packages/e2e/src/paired-mark-handles.e2e.ts)

## Amendment: the draft and the saved mark wrap at one width

Accepted 2026-11-23 with [#58](https://github.com/aidenlx/zotlit-repo/issues/58) and [PR 241](https://github.com/aidenlx/zotlit-repo/pull/241) (`c3f3a9744`). The textarea of the Text Draft uses the exact width of the fitted box, and the saved mark wraps at that same width. The fit adds one point only when it sizes a multiline box to its widest line. When a page edge, a kept user width or the 300-point cap sets the width, the fit adds no point. The draft has no minimum width, so a narrow fitted box shows at its own width. Saved lines stay inside the stored box, as the paired run checks.

Accepted limits:

- A box that the fit sizes to its widest line is one point wider than Zotero's fit of the same text.
- The DOM measures the textarea and the canvas measures the saved mark. A line whose two measures fall on different sides of the box width can wrap differently after save. The difference is below one pixel.

Rejected:

- **One wrap budget of the box width plus one point for the textarea, the fit and the saved mark:** saved text can then pass the stored box by one point, which breaks the paired run's check that each saved line fits in the box.
- **The saved-mark renderer draws the draft's text, and the textarea only takes input:** one wrap decision, but the caret and the selection can sit on another line than the drawn text near the box edge.
- **No change:** a line that measures within one point above the box width wraps at save, which a long word broken into characters makes common.

The maintainer chose "fit adds 1 pt, textarea at the exact width" on 2026-11-23.
