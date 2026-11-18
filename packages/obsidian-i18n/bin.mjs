#!/usr/bin/env node

// Checked-in `obsidian-i18n` bin entry, so pnpm can link it at install time.
// Node runs the TypeScript CLI source directly by stripping its types.

import "./src/cli-main.ts";
