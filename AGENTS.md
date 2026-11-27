# ZotLit

## Repo shape

ZotLit integrates Obsidian and Zotero. Start in the workspace that owns the behavior.

- **Plugin features.** `apps/obsidian` composes features from `packages/annotations`, `citations`, `notes`, `template-workbench`, `query-views`, and `library-view`. The package guides describe their host-free, Obsidian, and desktop layers.
- **Shared plugin code.** `plugin-shell` owns composition and lifecycle. `plugin-services` owns shared platform services. Put lower-level code in `plugin-kernel`, `obsidian-kit`, or `obsidian-desktop` according to the host capabilities it needs.
- **Reader and resources.** `apps/reader` opens vault PDFs independently. ZotLit integrates through `packages/reader-api`. `apps/resources` builds the Resource Pack that hosts read through `packages/resource-pack`.
- **Data.** `packages/db` owns SQL, including Item Query statements. `item-query` and `item-lookup` consume it. `zotero-reads` connects the renderer and the database worker. `web-library` syncs the Web Library Replica from the Zotero Web API. `zotero-compat` reproduces the values that the Zotero client computes from a record. Engine code must also run in a mobile Web Worker. See the [database guide](packages/db/AGENTS.md) for the Node adapter.
- **Companion and docs.** `apps/zotero` owns the Zotero plugin, `packages/protocol` the wire format, and `apps/docs` the public site. For domain terms and their owners, use the [glossary map](GLOSSARY-MAP.md).
- **Tooling.** `packages/scripts` owns the Fixture, verification, landing, and release tools. `packages/e2e` owns the desktop and paired journeys.
- **Video.** `mise run video:clone` installs the optional private workbench. Follow `video/AGENTS.md` and commit inside its nested clone before removing the worktree.

## Bootstrap & toolchain

Run `mise run init` after cloning to install dependencies and generate editor types. Use Mise’s Node and pnpm, and `pnpm exec` for workspace binaries. Shared dependency versions and install settings belong in `pnpm-workspace.yaml`. Keep the minimum release age when updating dependencies.

Workspace packages export TypeScript source. Use relative imports with file extensions, erasable TypeScript syntax, and the owning package’s `#` subpath imports. Keep workspace dependencies out of the root manifest because Turbo includes their source in every task hash.

To refresh a vendored Zotero schema or pdf.js type definition, use `node packages/scripts/scripts/vendor-upstream.ts <source> [ref]` so its provenance changes with the files. For CDP browser automation, read the [agent-browser guide](docs/agents/agent-browser.md) and run `agent-browser skills get core` for the installed version.

## Commands

Run commands from the repository root.

- **Iterate.** Run a package’s single test file with its own Vitest config. Check types and lint with `pnpm exec turbo run //#lint:repo -- <paths>`: Turbo runs the generators the files read, then type-aware oxlint checks the paths. Use `pnpm exec turbo run <task> --filter=<package>` for package builds and tests so prerequisite generators run. `pnpm lint` covers the whole repository.
- **Verify.** `pnpm verify` checks the changed packages and dependents, generated artifacts, formatting, types, tests, and bundle budgets. `pnpm quality:fix` applies lint and formatting fixes.
- **Release.** `pnpm verify --release` adds the release checks, full local End-to-end Run, and host start-up measurement. For publishing or a stable hotfix, follow [CONTRIBUTING.md](CONTRIBUTING.md). The release ESLint config and root TypeScript alias belong to the Obsidian scanner. See [ADR 0020](docs/adr/0020-obsidian-guideline-review-runs-on-eslint-at-release.md).

### Testing

Prove behavior below the UI in the package that owns it. Run its suite and its consumers after a production change. Run a test that touches the file system, a child process, Electron or a display on Linux with `pnpm test:linux` before the land. Give each spec one journey for its user workflow, extending an existing one when it covers that workflow.

Iterate with a focused Run Container journey. Run the affected cases in the final round of the spec. Run the full suite for shared start-up or lifecycle changes, releases, or an explicit full-run request. See [Edit a journey](packages/e2e/AGENTS.md#edit-a-journey) for commands and evidence.

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

## User-facing content

Write UI messages in `messages/{locale}.json`. Use `/i18n-ui-text` for wording and `/inlang-i18n` for the message format and generated language facades. Companion messages compile to Fluent. Public docs live in `apps/docs/content/` and the Workbench CLI guide in `packages/template-workbench/src/desktop/cli/guide.ts`. For brand assets, follow [the brand specification](docs/brand.md).

## Working files

Keep probes, logs, drafts, and intermediate output in the relevant workspace’s ignored `.scratch/` directory. Record accepted specs, progress, and handoffs on the owning [GitHub issue](docs/agents/issue-tracker.md). Create a maintained file under `docs/` only with explicit user permission.

## Worktrees

Use Worktrunk so the repository hooks bootstrap dependencies. Create with `wt switch --create <branch> --base origin/main`. Use `--no-cd` for an agent worktree and give the agent the printed path. Name branches by change type. Remove your own finished worktree with `wt remove <branch>`.

## Landing a change

Commit the task changes, then use `pnpm land` to land one verified squash commit. Follow the [land procedure](.agents/skills/land/SKILL.md) to write its record, preserve separate commits when required, or recover a failed land.

## Agent skills

Keep instructions in `AGENTS.md` and preserve the matching `CLAUDE.md` import for Claude sessions.

For issue triage, use the [repository labels](docs/agents/triage-labels.md). For changes to domain terminology or glossary ownership, use the [domain guide](docs/agents/domain.md).

## Effect

Use `/obsidian-services` when creating or wiring a service. Build it as a `Context.Service` with a scoped `Layer` in the plugin’s Layer graph. Resolve the installed Effect v4 package from the workspace being changed. Read its `AGENTS.md` and relevant `ai-docs/src/` topic, then check signatures in `dist/**/*.d.ts`.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
