# Worktree hooks bootstrap before use and clean up host state

Worktrunk creates a worktree and carries over git-ignored environment
files matched by `.worktreeinclude` from the primary worktree. The
project's blocking `pre-start` hook trusts Mise and runs the same
bootstrap as a fresh clone. This installs dependencies and generates
message types before the agent's first command. A background hook
could let the first command run before those files exist.

Before removal, the project's `pre-remove` hook first stops the Paired
Zotero for that worktree's Fixture. This releases the files the worktree
is about to lose. A failure prints a recovery command. The hook then
unregisters and removes the debug vault so the host's vault list has no
entry for a deleted path. The vault script uses the running Obsidian
instance when available and otherwise edits the offline registry. It
leaves a closed instance closed. Both cleanup commands allow removal
to proceed if cleanup fails.

The ignore rules keep session probes and generated fixtures in
`.scratch/` and keep per-worktree development vaults out of Git. The
optional video workbench is a separate private clone under `video/`.

Worktrunk supplies copied ignored files through `.worktreeinclude`.
Initialization generates the Message facade for editors. Turbo generates
the inputs again for tasks that read them, while the docs Vite lifecycle
owns its collections and messages. The Fixture expects the dev bundles
already built by its pnpm command. Throw after yargs validation so it
cannot dispatch a rejected command. Once its failure handler reports
the error and sets the exit code, consume the throw.
