---
name: design-review
description: Reviews a docs-site UI change against apps/docs/DESIGN.md — renders the touched surfaces and routes judgement calls to the better-* skills with DESIGN.md's values as the reference. Use before landing any change under apps/docs/src that touches markup or classes.
---

# Design review

The docs site has one design spec, `apps/docs/DESIGN.md`. This skill checks a change against it in two tiers, each catching what the tier above cannot:

1. **The kit** (`apps/docs/src/components/ui/*`) carries every size, so a call site names a variant and nothing else.
2. **The spec's prose** carries judgement calls: grouping, hierarchy, which surface speaks which voice. Those go to the `better-*` skills with DESIGN.md's values in hand.

A correction lands in the narrowest tier that can hold it for good. A size that repeats at two call sites becomes a kit variant and a line in DESIGN.md. A one-off class is the outcome to avoid.

## Steps

1. **Resolve the scope** the way `interface-review` does: the branch ahead of the merge base plus the working tree, or the target the user names. Keep files under `apps/docs/src`.

2. **Read the spec for the surface.** DESIGN.md is organised per surface (`### Landing`, `### Learn`, docs chrome). Read the section for every surface the change renders in, and "The label voice" whenever the change adds a label.

3. **Run the lint** on the changed files, with paths relative to `apps/docs`. The lint config is type-aware, so in a new worktree run `pnpm exec turbo run @zotlit/docs#generate:messages` once first: it generates the `@/paraglide` modules the files import.

   ```bash
   pnpm --filter @zotlit/docs exec oxlint <changed files under src/>
   ```

   Diagnostics are this review's only when the change introduced them (`git blame` the line).

4. **Render the touched surfaces.** Start the dev server and capture each touched surface at 1440 px and 640 px with agent-browser (conventions: `docs/agents/agent-browser.md`; export `NO_PROXY='localhost,127.0.0.1'`). Measure rather than eyeball: read control heights and font sizes from the DOM and compare them with the spec's numbers.

   ```bash
   agent-browser eval "JSON.stringify([...document.querySelectorAll('button')].map(b=>[b.textContent.trim().slice(0,24), Math.round(b.getBoundingClientRect().height), getComputedStyle(b).fontSize]))"
   ```

   A native `<select>` with focus stalls screenshot capture; blur it, or capture before opening it.

5. **Route the judgement calls.** Hand the rendered surfaces to `better-layout`, `better-typography`, and `better-ui` with the spec's values as the density system, so the reviewer applies the spec's sizes rather than its generic defaults. `better-interface` consolidates the verdict.

6. **Report** in the `better-*` table format, one row per root cause with every location. Add a `Tier` column: `kit` or `spec`, naming where the fix belongs. End with `Block` while any `HIGH` remains, `Approve` otherwise. State every viewport and state you did not render as `Not verified`.

## Extending the system

When a review finds a rule worth keeping:

- Put the value in the kit variant first (`button.tsx`, `input.tsx`, `native-select.tsx`).
- Write the decision into the matching DESIGN.md section as the target state, in one or two sentences.
- Leave call sites naming only variants, layout classes (`flex-1`, `ms-auto`, `mt-2`), and state classes (`aria-pressed:*`, `data-pressed:*`).
