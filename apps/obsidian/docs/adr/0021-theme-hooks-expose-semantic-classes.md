# Theme hooks expose semantic classes

ZotLit exposes plugin-owned `zt-` classes whose semantic meaning and activation rules stay consistent across Source mode, Live Preview, and Reading view, because Obsidian and CodeMirror DOM classes are not a stable plugin contract. Theme hooks use low-specificity defaults backed by Obsidian variables; element type, nesting, wrapper count, editor segmentation, and native classes remain implementation details. Public hook names live in one registry and each change updates literal-name contract tests, the public reference, and the Obsidian package policy.

## State and rendering contracts

The reference documents the stable hook names and their activation. Literal-name tests protect these names while allowing the keys in the TypeScript registry to change. Put template color variables on the editor; a regular expression also carries the value hook. The Filter Expression call hint marks the active parameter and shares its class name with the Workbench. Theme variables can inherit from the surrounding element or `body`. State attributes on a host are empty while present and absent otherwise.

An annotation selection uses the merged mark silhouette. The note glyph inherits its stroke width from the group. Its crease is open geometry so it only paints a stroke. Temporary selection rectangles, ink strokes, and text drafts sit on the page until capture ends, the user discards the draft, or the saved mark replaces it. Paint pending ink below saved annotation marks. Arm the ink tool by setting the inking attribute on the container so the stylesheet can disable page touch panning. The reader's toolbar owns the busy editing indicator and the split creation tools. The tools share their armed appearance and each half keeps its own hover behavior. For the current marks, controls, and selectors, see the public reference in `apps/docs/content/docs/reference/theme-hooks.mdx`.

The editor sheet tests check the literal `zt-pdf-comment-sheet` on a Mark Popup sheet. The card editor has its own surface and does not carry that PDF hook. [Editor sheet test](../../../../packages/annotations/src/obsidian/annot-view/editor-sheet.test.ts)

### Template Workbench native theme

Match statements can override the shared native control styling. Render
Properties with native classes. Give the key span the native input box,
use the placeholder color for empty values, and map tag colors from the
tree's state. Native editor classes supply typography, line height,
selection, and caret. The code pane selector takes precedence over
Obsidian's scroller font selector. Managed lines supply their own padding.

Expose Template token colors and Expression Colors on the editor hook.
Expression tokens use Obsidian's code palette so themes for Bases also
apply to expressions. Keep the rule at the hook's specificity to permit
later theme overrides. Put the regular expression rule after the value
rule because both classes apply. Align completion labels, signatures, and
descriptions at the leading edge.

The Signature Hint is DOM with a public theme class. Its text sets its
width so the popover edge does not wrap it. Its chrome outranks the
CodeMirror base tooltip selector, and themes can override it through the
combined tooltip and signature classes. Size hover cards to their text
instead of using the native note page dimensions.

[Workbench view styles](../../../../packages/template-workbench/src/desktop/view/style.css)
