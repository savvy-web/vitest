---
"@savvy-web/vitest": minor
---

## Features

- `VitestProject` class with `unit()`, `e2e()`, and `custom()` factory methods for generating Vitest project configs with sensible defaults per test kind
- `VitestConfig.create()` for automatic workspace discovery with filename-based test classification, configurable coverage thresholds, and CI-aware reporters
- Auto-detection of `GITHUB_ACTIONS` environment for reporter selection
- Support for `--project` filtering with `:unit`/`:e2e` suffix stripping
- Re-export of `TestProjectInlineConfiguration` from `vitest/config`
