# ZotLit

## Repo shape

Turborepo + pnpm monorepo for **ZotLit**, an Obsidian plugin that integrates Zotero. Workspaces are `apps/*` and `packages/*` (declared in `pnpm-workspace.yaml`).

- `apps/obsidian` — the Obsidian plugin (`@zotlit/obsidian`).
- `apps/zotero` — Zotero-side companion.
- `apps/docs` — documentation and landing sites.
- `packages/config` — consumed via `@zotlit/config` exports map.
- `packages/db` — Drizzle ORM client for Zotero database.
- `packages/db-testing` — Node-only test fixtures for `@zotlit/db` and its consumers: the fixture schema, statement counters, and the scenario database. Tests depend on it as a dev dependency.
- `packages/item-lookup` — fuzzy item-search over `@zotlit/db`.
- `packages/pdfjs-dist` — type definitions of Zotero's pdf.js fork, an upstream copy that `zotero-types` reads through an override (see its `README.md`).
- `packages/protocol` — wire format (valibot schemas) for ZotLit ↔ Zotero.
- `packages/templates` — Eta-based template rendering.
- `packages/zotero-types` — generated item-field shapes from Zotero's upstream schema, plus the Zotero key grammar (`./keys`) and key-only `zotero://` links (`./uri`).
- `video/` — **private, opt-in nested clone** of `aidenlx/zotlit-video`: the workbench for product videos. Git ignores the folder. Clone it with `mise run video:clone`, then follow `video/AGENTS.md`. Commit and push video work inside `video/`; removing the worktree deletes the clone.

## Bootstrap & toolchain

- `mise` pins to Node 26 version (see `mise.toml`). Its `idiomatic_version_file_enable_tools = ["pnpm"]` setting also activates pnpm at the version declared in root `package.json`'s `packageManager` field.
- A plain `git clone` plus `mise run init` gives a complete workspace: `init` installs dependencies and generates the message types that the editor reads. Upstream copies (`packages/zotero-types/zotero-schema`, `packages/pdfjs-dist`) are committed files; `node packages/scripts/scripts/vendor-upstream.ts <source> [ref]` refreshes one and records the upstream commit in its `provenance.json`.
- Resolve tool availability from the current workspace environment. Use `pnpm exec` for workspace binaries; use the Mise-managed toolchain defined by `mise.toml`.
- `agent-browser` (>= 0.31.1) — browser automation via CDP. Run `agent-browser skills get core` once per session for the version-matched usage guide. Session conventions and gotchas: [`docs/agents/agent-browser.md`](docs/agents/agent-browser.md).

## Commands

Run these from the repo root. Each workspace package exports its TypeScript source, so `typecheck`, `test` and `lint` read the source of every dependency and no package builds first; only the apps (`apps/obsidian`, `apps/zotero`, `apps/docs`) build, and their bundlers compile that source. `build` / `test` / `lint` go through turbo, which caches each task on its inputs and the source of the packages it depends on. Scope `build` or `test` to one package with `turbo run <task> --filter=@zotlit/obsidian`; lint is the root task `//#lint:repo` and always covers the whole tree through `pnpm lint`. For an inner loop (single-file Vitest, `db:pull`), call the package tool directly — see each package's `AGENTS.md`. Run `typecheck` through turbo (`turbo run typecheck --filter=<package>`): turbo first runs the `generate:*` tasks whose files it reads, such as the message types and language packs.

| Command                           | What it does                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm dev`                        | `turbo run dev` (persistent, no cache).                                                                                                                                                                                                                                                                                                                                                                                        |
| `pnpm test`                       | `turbo run test` behind the Memory Gate: Vitest in each package that defines a `test` script.                                                                                                                                                                                                                                                                                                                                  |
| `pnpm lint` / `pnpm lint:fix`     | Type-aware `oxlint` over the whole tree after dependencies build. **A clean run is the typecheck.**                                                                                                                                                                                                                                                                                                                            |
| `pnpm lint:unused`                | Part of `pnpm lint`: knip fails on an export, type or enum member with no reader. Older findings sit in `packages/scripts/unused-code.json` until their code goes; a reader knip cannot see gets an entry in `knip.config.ts`.                                                                                                                                                                                                 |
| `pnpm format` / `pnpm format:fix` | Root-level `oxfmt` over the whole tree, run directly. A full pass takes under a second.                                                                                                                                                                                                                                                                                                                                        |
| `pnpm review` / `pnpm review:fix` | The community directory scanner's ESLint run over `apps/obsidian`, release-time only, reporting error-level findings (see below). It also checks the manifest built from `apps/obsidian/package.json` against `obsidianmd/validate-manifest`.                                                                                                                                                                                  |
| `pnpm quality:fix`                | Fixes lint, then format. `pnpm verify` is the check.                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm verify`                     | The quality gate: format, generated artifacts, lint, and typecheck and tests for the packages the branch changed and their dependents. `pnpm land` runs it on the rebased result before it pushes; run it yourself while you work. `--release` checks every package and adds `pnpm review`; on the desktop it also runs the full End-to-end Run and `pnpm e2e:worker`. A branch that changes only agent docs runs format only. |
| `pnpm land`                       | Lands the task branch on `next`, the only way a change reaches it: waits in the machine-wide Land Queue, rebases onto `origin/next`, runs `pnpm verify`, and pushes. The gate cannot be skipped. `pnpm land --to main` fast-forwards `main` to the checked-out commit of `next` after `pnpm verify --release`. See [Landing a change](#landing-a-change).                                                                      |
| `pnpm fixture`                    | Builds the Fixture — the disposable multi-Library test environment — under `.scratch/acceptance-fixture/`. See the [Fixture guide](docs/fixture.md); run `pnpm fixture --help` for live Fixture Spec details.                                                                                                                                                                                                                  |
| `pnpm e2e`                        | Runs the End-to-end Run suite (`packages/e2e`) against a running desktop Obsidian; skips cleanly when none is reachable. The release gate runs it and fails instead of skipping.                                                                                                                                                                                                                                               |

oxlint and oxfmt own linting and formatting; `oxlint.config.ts` / `oxfmt.config.ts` at root and per package extend `@zotlit/config/oxlint` / `@zotlit/config/oxfmt`. ESLint serves `pnpm review` alone: `eslint.config.js` mirrors the scanner in `obsidianmd/obsidian-workflows`, and `--quiet` reports its errors. `pnpm verify --release` runs it, in `release.ts` before the version commit and in `release.yml` before publishing. oxlint runs the type-free `obsidianmd/*` rules on every lint through `packages/config/oxlint-plugin-obsidian.ts`. The scanner rejects `eslint-disable` of those rules, so suppress them with `oxlint-disable-next-line <rule> -- <reason>`. typescript-eslint needs TypeScript 6, so root `typescript` is aliased to `@typescript/typescript6` while workspace packages keep TypeScript 7 through the catalog. Keep `eslint.config.js` and that alias ([ADR 0020](docs/adr/0020-obsidian-guideline-review-runs-on-eslint-at-release.md)).

### Testing

- **E2E-first:** A test in `packages/e2e` is the primary proof that a feature works. During development, iterate on typecheck and single test files, and walk the change through the running app (`/obsidian-debug`). When the walkthrough passes, encode it as an e2e test — the repeatable artifact of that proof.
- **Final gate:** Run the affected End-to-end Run cases when the work is complete. `pnpm verify --release` runs the full suite for releases; run it yourself for changes to shared startup or lifecycle behavior across features, or an explicit full-run request. ZotLit Query CLI changes use `pnpm e2e:query`; other focused selections are described in `packages/e2e/AGENTS.md`. Prevent system sleep during desktop tests. The End-to-end Run tools take a Desktop Slot themselves; for a manual app session, run it under `pnpm desktop-slot run -- <command>`, which yields with a notice when another run waits (exit 76). Exit 75 means blocked at admission, not a test failure (see `packages/e2e/AGENTS.md`).
- **Consumer suites:** A production change runs its package's full suite and the suites of the packages that consume it, not only the tests named for the change. A test elsewhere can read what the change touched, such as statement parameters.
- **Writing a test:** Read [Testing strategy](policies/testing-strategy.md) before adding or changing a test: which tier, which mocks, and what earns a regression test.

## Truth-first

Correctness before agreement. Treat every user claim as unverified until checked. Reserve "you're right" for verified claims; lead with the correction, not fake agreement. Hold a verified conclusion when pushed back — revise only on new evidence, and say what changed your mind.

## First principles

Start with the user's goal and necessary constraints. Separate these from assumptions in the current design, test assumptions that affect the solution, and derive the simplest approach that meets the requirements. Evaluate existing patterns by the problem they solve.

## Target users

ZotLit's primary users are non-technical academics: assume research expertise and little programming knowledge. Design around their research tasks, with familiar academic terms, useful defaults, and complete UI workflows for routine work. Explain choices in terms of research outcomes; introduce technical details when they help the user make a decision.

## Affirmative specs

Describe the target state — what exists and what to do. Negation activates the concept it tries to suppress, so state the replacement, not the rejection. If a contrast is needed, the positive target comes first ("Use X" / "Prefer X over Y"); keep "why not X" rationale out of the spec body.

## Report language

Write reports to the user in ASD-STE100 Simplified Technical English.

## Surgical changes

Every changed line traces to the user's request. Leave adjacent code, comments, and formatting as found. Remove only the orphans your own changes created; mention pre-existing dead code, don't delete it.

## Speculative robustness

Spend complexity on failures that happen. Before you add a guard, retry, lock or check for a race or security edge case that is speculative or very unlikely, tell the user the concrete failure, how likely it is and what the guard costs in complexity, and build it once they agree. A guard of this kind that is already in code you touch stays in place: report where it is, its failure, likelihood and cost, and the user decides. Keep the task's scope to what was asked.

## i18n

User-facing strings are sourced from `messages/{locale}.json` and consumed through the generated Language Pack facade; ZotLit Companion copy lives in the same catalogs under the `zotero` object and compiles to Fluent at Companion build time. Run `/inlang-i18n` for message-format and runtime mechanics. Wording follows Obsidian's developer-guideline style (sentence case, terminology, phrasing) — run `/i18n-ui-text` before authoring or editing a string.

User- and agent-facing copy has three sources: MDX under `apps/docs/content/`, i18n messages under `messages/` (Obsidian, Companion, and docs alike), and the Template Workbench CLI guide at `apps/obsidian/src/services/template-workbench/guide.ts`.

## Conventions worth knowing

- Dependency versions shared by multiple packages go in the **catalog** in `pnpm-workspace.yaml`; package-local dependencies stay in that package's `package.json`. Catalog users reference shared entries as `"oxlint": "catalog:"`.
- pnpm settings (`allowBuilds`, `minimumReleaseAge`, `catalog`) belong in `pnpm-workspace.yaml`, not under a `"pnpm"` key in `package.json`.
- `minimumReleaseAge` in `pnpm-workspace.yaml` is intentional, a supply-chain hardening measure.
- `__DEV__` is replaced at build time (`true` in dev mode, `false` in production).
- Node runs workspace TypeScript directly by stripping its types. Write each relative import with its file extension (`./client.ts`, `./view.tsx`), and write erasable syntax only: a const object in place of an `enum`, a field plus an assignment in place of a constructor parameter property. Inside a package, reach `src/` through the package's `#` subpath imports (`#lib/zt-key.ts`) in place of TypeScript `paths`, because each consumer type-checks the package source under its own tsconfig. The `import/extensions` lint rule and `erasableSyntaxOnly` in the base tsconfig enforce this.
- Use `pnpm exec` instead of `npx`.
- Brand identity — logo geometry, palette, and wordmark (Archivo SemiBold) — is specified in [`docs/brand.md`](docs/brand.md); canonical SVGs live in `assets/logo/`. Consume those assets and follow that spec rather than redrawing the mark.

## Working files

Choose the destination by purpose:

- **Session material** — `.scratch/`, under the workspace root or the package you are working in: probe scripts, experiment output, research notes at `.scratch/notes/`, draft specs and tickets, intermediate output. Git-ignored and inside the tree, so a script there resolves `node_modules` like any other file, and the artifacts stay visible and cleanable — `/tmp` and a session scratchpad give neither. Remove them when the work is done.
- **Planned work** — the issue tracker: agreed specs and tickets, with progress, findings, and handoffs as comments on the owning ticket. See `docs/agents/issue-tracker.md`.
- **Maintained reference** — `docs/`: architecture, runbooks, ADRs, research reports, process config. Create a new file there only with explicit user permission, skill output included; keep the draft in `.scratch/` until then.

## Worktrees

Worktrunk (`wt`) creates and removes every worktree. Its hooks place the worktree at the user's path template and bootstrap it through the `pre-start` hook in `.config/wt.toml`.

- **Create:** `wt switch --create <branch> --base <base>`; add `--no-cd` when the worktree is for another agent, and name the printed path in that agent's prompt. Name the branch by its change type, such as `feat/<topic>` or `fix/<topic>`.
- **Remove:** `wt remove <branch>`.

A plain `git worktree add` runs none of these hooks: the worktree has no dependencies and sits outside the path template.

## Landing a change

A change reaches `next` only through `pnpm land`. Run `/land` for the full procedure.

- **Run:** commit every change, then run `pnpm land` from the task worktree, on its branch. The gate takes minutes, so run it in the background and wait for it to exit.
- **Queue:** lands on this machine run one at a time, in the order they started. A land waits up to 1 h for its turn and exits 75 when the turn does not come: blocked, not a failure. `pnpm land status` shows the holder and the waiters.
- **Failure:** a non-zero exit names the failed step and prints the path of the full log. The worktree stays on its branch with a clean tree. After a rebase conflict the branch is as it was: rebase onto `origin/next`, resolve, and land again. After a failed gate the branch is rebased onto `origin/next`: fix it there, commit, and land again.
- **Pushes:** the pre-push hook lets only `pnpm land` push `next` and `main`, and in an agent session it refuses every other push. A person can push a task branch to share it; that push runs no gate.
- **After the land:** the End-to-end Run of the new `next` tip runs in the background under a Desktop Slot. A failure opens one `needs-triage` issue in `aidenlx/zotlit-repo` with the commit range and a log excerpt.

## Agent skills

### Issue tracker

Issues, specs, and tickets are tracked in GitHub Issues at `aidenlx/zotlit-repo`; external pull requests are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context layout — `GLOSSARY-MAP.md` at the repo root points to per-workspace `GLOSSARY.md` files under `apps/*` and `packages/*`. See `docs/agents/domain.md`. Context names there (e.g. "Zotero Data Model") are heading labels for that map; code, comments, and user-facing copy keep the casing their own convention calls for (see i18n above for UI text).

## Effect

Build a new Obsidian service as an Effect service: a `Context.Service` tag and a scoped `Layer` that joins the plugin's Layer graph. Run `/obsidian-services` before creating or wiring a service.

### This is NOT the Effect you know

This repo runs Effect v4. Its modules, names, and signatures differ from the Effect v2/v3 that most training data covers. Take every Effect API from the installed package, not from memory.

Resolve the `effect` package from the workspace you change; for example, run `node -p "require.resolve('effect/package.json')"` from `apps/obsidian`. Read `AGENTS.md` inside that package first, then the topic folder of its `ai-docs/src/` for the area being changed, and confirm each signature in its `dist/**/*.d.ts`. Search the installed source before adding helpers. These docs match the installed version and are available without network access.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
