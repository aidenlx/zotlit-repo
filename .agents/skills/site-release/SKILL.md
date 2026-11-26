---
name: site-release
description: "Use when a change should reach the production docs site (zotlit.aidenlx.site), when checking which site release is live, when a site deploy is refused, or when an SEO change needs its live baseline and its release."
---

## Site release

The production docs site serves one **site release**: the annotated tag `site-<N>`. Pre-release Docs follows `main` by itself; nothing here touches it. Read `pnpm site:release --help` first: it holds the modes and the guarantee that each release descends from the live one.

Every change on production lands on `main` first (the `land` skill). A site release only chooses which landed changes production serves.

1. Read the live release: `curl -s https://zotlit.aidenlx.site/version.json` names it as `tag`.
2. Pick the mode:
   - **`--pick <record PR>…`**: a fix, a changelog entry, or an SEO change goes live while `main` holds unfinished work. Put several record PRs in one pick, so the maintainer approves once.
   - **`--to`**: `main` as a whole is ready, as after a stable release. This syncs production back to `main`.
   - **`--revert-to site-<K>`**: a live release broke the site. Then land the fix and pick it.
3. Run the command with `--dry-run`, read the compare link it prints, then run it without `--dry-run`. It pushes the tag.
4. The Site Release workflow builds and uploads the tag. Its summary names the version URL, the live release, and the changes. Report that link to the maintainer: they review the record PRs and the version URL, and approve its `approve` job. Approval belongs to the maintainer alone, on GitHub. A run that waits for approval after a newer release went live stays harmless: its deploy refuses the tag.
5. The release is done when `/version.json` names the new tag.

## Refusals

- **A pick conflicts.** The fix depends on a change that production lacks. Report both record PRs to the maintainer; pick the earlier change only when they ask.
- **The deploy job says the tag does not descend from the live release.** A newer release went live first. Run the same `pnpm site:release` again; the new tag builds on the live one.
- **`--to` names live changes that the commit lacks.** Choose a later commit of `main` that holds them.

## Plugin releases

- **Stable release.** The plugin opens `/changelog/<version>`. Until production has that page, the page redirects to Pre-release Docs. After the release lands, run `--to` the version commit or a later one.
- **Stable hotfix.** Land its changelog entry on `main` as a record PR of its own, then pick it. The production site builds from site tags alone, never from a plugin tag.
- **Revised release notes.** Land the edit, then pick it.

## SEO changes

The live site is the baseline of an SEO change.

1. Record the live tag and the measurements in the change's issue.
2. Make the change on a branch from `origin/main`: content, metadata, or site code. Prove it by its kind:
   - **Site code**, such as how `pageHead`, the sitemap, the redirects or the headers build a page's output: a test in `apps/docs` beside `src/lib/seo.test.ts` that holds the rule, seen red on the old code.
   - **Copy or metadata**, such as a title, a description or a link in a page: a browser check. The title and description limits in `src/lib/source.test.ts` hold its shape. Record the check as the command and the served text in the record PR.
3. Land it, then pick your record PRs. The maintainer reviews them when they approve the deploy.
4. When `/version.json` names your tag, run the browser check on production. Then measure against the baseline and record the result in the issue. When the change hurts, land a revert commit and pick it.
