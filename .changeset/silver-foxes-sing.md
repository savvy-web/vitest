---
"@savvy-web/vitest": minor
---

## Features

- Added a companion Claude Code plugin (`plugin/`) that provides AI coding agents with automatic test convention context and a full configuration API reference.

  The plugin ships two components:

  - **Session-start hook** — on every Claude Code session start, the hook injects workspace discovery context (auto-discovery behavior, `__test__/` directory layout, test classification rules by filename convention) and dynamically scans the current workspace to report which packages use `__test__/` directories, co-located tests, or both.
  - **`/vitest:config` skill** — a slash-command reference covering all `VitestConfigOptions` fields (`coverage`, `coverageTargets`, `coverageExclude`, `agentReporter`, `pool`, `unit`/`e2e`/`int` overrides, `postProcess`), `VitestProject` factory defaults and mutation methods, and common configuration recipes.

## Maintenance

- Restructured the repository into a sidecar pattern. The publishable package source moved from the repo root to `package/` (`src/`, `rslib.config.ts`, `tsconfig.json`, `turbo.json`). No changes were made to the package's exported API — the `@savvy-web/vitest` module surface is identical.
