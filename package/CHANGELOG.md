# @savvy-web/pnpm-module-template

## 1.2.1

### Bug Fixes

* [`476cc9f`](https://github.com/savvy-web/vitest/commit/476cc9f879302f2aadf63879845899f17d5e046d) Fixed session-start hook silently swallowing errors by converting from plain text stdout output to structured JSON `hookSpecificOutput.additionalContext` response with error trap and environment variable validation

## 1.2.0

### Features

* [`dd6d5af`](https://github.com/savvy-web/vitest/commit/dd6d5afc0732bb1d09e1f6c6ff2a7c684634cbae) Added a companion Claude Code plugin (`plugin/`) that provides AI coding agents with automatic test convention context and a full configuration API reference.

  The plugin ships two components:

  * **Session-start hook** — on every Claude Code session start, the hook injects workspace discovery context (auto-discovery behavior, `__test__/` directory layout, test classification rules by filename convention) and dynamically scans the current workspace to report which packages use `__test__/` directories, co-located tests, or both.
  * **`/vitest:config` skill** — a slash-command reference covering all `VitestConfigOptions` fields (`coverage`, `coverageTargets`, `coverageExclude`, `agentReporter`, `pool`, `unit`/`e2e`/`int` overrides, `postProcess`), `VitestProject` factory defaults and mutation methods, and common configuration recipes.

### Dependencies

* | [`35db183`](https://github.com/savvy-web/vitest/commit/35db18309e6433968a8288b38e0227de2613aef2) | Dependency    | Type    | Action | From   | To |
  | :----------------------------------------------------------------------------------------------- | :------------ | :------ | :----- | :----- | -- |
  | @savvy-web/lint-staged                                                                           | devDependency | updated | ^0.6.5 | ^0.6.6 |    |

### Maintenance

* [`dd6d5af`](https://github.com/savvy-web/vitest/commit/dd6d5afc0732bb1d09e1f6c6ff2a7c684634cbae) Restructured the repository into a sidecar pattern. The publishable package source moved from the repo root to `package/` (`src/`, `rslib.config.ts`, `tsconfig.json`, `turbo.json`). No changes were made to the package's exported API — the `@savvy-web/vitest` module surface is identical.

## 1.1.0

### Features

* [`217f10c`](https://github.com/savvy-web/vitest/commit/217f10cd76dcd3ae6a3d37b7cbbe04c51bbf8a47) ### Coverage Targets

Added a top-level `coverageTargets` option to `VitestConfig.create()` that proxies soft coverage thresholds to `vitest-agent-reporter`. Targets inform the reporter where coverage gaps exist without failing the test run.

```typescript
export default VitestConfig.create({
  coverage: "none",
  coverageTargets: "standard",
});
```

Accepts the same `CoverageLevelName` or `CoverageThresholds` values as the `coverage` option. Defaults to `"basic"` when omitted.

When both `coverageTargets` and `agentReporter.reporter.coverageTargets` are set, the explicit plugin option takes precedence and a warning is logged.

### Default Coverage Level Change

The default `coverage` level is now `"none"` (previously `"strict"`). Tests no longer fail due to coverage thresholds out of the box. Set `coverage` explicitly to restore enforcement:

```typescript
export default VitestConfig.create({ coverage: "strict" });
```

## 1.0.1

### Dependencies

* | [`d3fbe8b`](https://github.com/savvy-web/vitest/commit/d3fbe8bfa776f964bc3e09d7c3ba5d93836e0cf4) | Dependency     | Type    | Action | From   | To |
  | :----------------------------------------------------------------------------------------------- | :------------- | :------ | :----- | :----- | -- |
  | @savvy-web/changesets                                                                            | devDependency  | updated | ^0.6.0 | ^0.7.0 |    |
  | @savvy-web/lint-staged                                                                           | devDependency  | updated | ^0.6.2 | ^0.6.3 |    |
  | vitest-agent-reporter                                                                            | devDependency  | updated | ^1.0.0 | ^1.1.0 |    |
  | vitest-agent-reporter                                                                            | peerDependency | updated | ^1.0.0 | ^1.1.0 |    |

## 1.0.0

### Breaking Changes

* [`aafb73e`](https://github.com/savvy-web/vitest/commit/aafb73efb4b26e4c4d50b13a253b31184faa2efb) Replace callback-based `VitestConfig.create(callback, options?)` with
  declarative `VitestConfig.create(options?, postProcess?)`. Coverage is
  always enabled. `AgentPlugin` from `vitest-agent-reporter` is injected
  by default with `strategy: "own"`.

**Removed:** `VitestConfigCallback`, `VitestConfigCreateOptions`,
`CoverageConfig` (public export), `DEFAULT_THRESHOLD`

**Migration:** Replace callback usage with zero-config `VitestConfig.create()`
or pass `VitestConfigOptions` for customization.

`AgentReporterConfig` is now a type alias for the upstream
`AgentPluginOptions` from `vitest-agent-reporter`. All plugin options
are passed through directly. Coverage thresholds from the resolved
coverage level are injected as the per-metric `coverageThresholds`
object automatically.

### Features

* [`aafb73e`](https://github.com/savvy-web/vitest/commit/aafb73efb4b26e4c4d50b13a253b31184faa2efb) Add `VitestProject.int()` factory for integration tests (60s/30s timeouts)
* Add chainable mutation methods: `override()`, `addInclude()`,
  `addExclude()`, `addCoverageExclude()`
* Add `COVERAGE_LEVELS` named presets (none/basic/standard/strict/full)
* Add per-kind overrides via object or Map callback (`unit`, `e2e`, `int`)
* Add `postProcess` escape hatch for full Vite config control
* Support `.ts`, `.tsx`, `.js`, `.jsx` file extensions in test discovery
* Auto-detect `vitest.setup.{ts,tsx,js,jsx}` per workspace package
* Exclude `fixtures/` and `utils/` dirs at conventional `__test__/` locations
* Support multiple `--project` flags for scoped coverage
* Always-on v8 coverage with configurable thresholds

### Dependencies

* | [`aafb73e`](https://github.com/savvy-web/vitest/commit/aafb73efb4b26e4c4d50b13a253b31184faa2efb) | Dependency     | Type    | Action | From   | To |
  | :----------------------------------------------------------------------------------------------- | :------------- | :------ | :----- | :----- | -- |
  | vitest-agent-reporter                                                                            | peerDependency | updated | ^0.2.0 | ^1.0.0 |    |

- | [`51b498c`](https://github.com/savvy-web/vitest/commit/51b498c2f18d5fcd8cf85c025da8ce4619cf6a19) | Dependency | Type    | Action | From   | To |
  | :----------------------------------------------------------------------------------------------- | :--------- | :------ | :----- | :----- | -- |
  | @savvy-web/changesets                                                                            | dependency | updated | ^0.5.3 | ^0.5.4 |    |
  | @savvy-web/commitlint                                                                            | dependency | updated | ^0.4.2 | ^0.4.3 |    |
  | @savvy-web/lint-staged                                                                           | dependency | updated | ^0.6.1 | ^0.6.2 |    |

## 0.3.0

### Features

* [`293756e`](https://github.com/savvy-web/vitest/commit/293756edf18cd9c02429c96729addf242809294e) Upgades consumers to Vitest 4.1.0+ to support agent mode

### Dependencies

* | [`3b8601a`](https://github.com/savvy-web/vitest/commit/3b8601aaaad4234c3bdde433fe93813a4b4660ec) | Dependency | Type    | Action  | From    | To |
  | :----------------------------------------------------------------------------------------------- | :--------- | :------ | :------ | :------ | -- |
  | @savvy-web/rslib-builder                                                                         | dependency | updated | ^0.18.2 | ^0.19.0 |    |

## 0.2.2

### Dependencies

* | [`0a1eb83`](https://github.com/savvy-web/vitest/commit/0a1eb833d45c9f8b58b7ea2042e38aa07318e38b) | Dependency | Type    | Action  | From    | To |
  | :----------------------------------------------------------------------------------------------- | :--------- | :------ | :------ | :------ | -- |
  | @savvy-web/changesets                                                                            | dependency | updated | ^0.4.2  | ^0.5.3  |    |
  | @savvy-web/commitlint                                                                            | dependency | updated | ^0.4.0  | ^0.4.2  |    |
  | @savvy-web/lint-staged                                                                           | dependency | updated | ^0.5.1  | ^0.6.1  |    |
  | @savvy-web/rslib-builder                                                                         | dependency | updated | ^0.17.0 | ^0.18.2 |    |

## 0.2.1

### Dependencies

* [`0c7c4d8`](https://github.com/savvy-web/vitest/commit/0c7c4d879e8184d6633c0a723d18f8867f355f7e) @savvy-web/changesets: ^0.4.1 → ^0.4.2
* @savvy-web/lint-staged: ^0.5.0 → ^0.5.1
* @savvy-web/rslib-builder: ^0.16.0 → ^0.17.0

- [`efd3080`](https://github.com/savvy-web/vitest/commit/efd3080af7fbd6beaba6546d7d9bff5ed77bdb7c) @savvy-web/rslib-builder: ^0.15.0 → ^0.16.0

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
