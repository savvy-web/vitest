# @savvy-web/pnpm-module-template

## 0.2.0

### Features

* [`58323a1`](https://github.com/savvy-web/vitest/commit/58323a190c015d688062dd0d6bd31e693a707932) Reverts control of peerDependencies to package

## 0.1.0

### Features

* [`6c82696`](https://github.com/savvy-web/vitest/commit/6c82696499d8a4f0230d7ad0c29c30124da4d027) `VitestProject` class with `unit()`, `e2e()`, and `custom()` factory methods for generating Vitest project configs with sensible defaults per test kind
* `VitestConfig.create()` for automatic workspace discovery with filename-based test classification, configurable coverage thresholds, and CI-aware reporters
* Auto-detection of `GITHUB_ACTIONS` environment for reporter selection
* Support for `--project` filtering with `:unit`/`:e2e` suffix stripping
* Re-export of `TestProjectInlineConfiguration` from `vitest/config`

## 0.0.1

### Patch Changes

* ae454d3: Update dependencies:

  **Dependencies:**

  * @savvy-web/commitlint: ^0.2.0 → ^0.2.1
  * @savvy-web/lint-staged: ^0.1.3 → ^0.2.1
  * @savvy-web/rslib-builder: ^0.11.0 → ^0.12.0
