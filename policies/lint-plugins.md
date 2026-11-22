# Lint plugins

A custom oxlint plugin (`packages/config/oxlint-plugin-*.ts`, `apps/*/scripts/oxlint-plugin-*.ts`) describes its behavior through its rule names, `meta.docs.description`, diagnostics, and tests. The description states what a rule rejects and the diagnostic names the fix.

Put non-obvious design decisions in an ADR. Keep judgement calls the rule cannot see in the relevant policy. Apply the [comment ratchet](comments.md) to the plugin and its configuration.
