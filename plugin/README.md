# @savvy-web/vitest — Claude Code Plugin

Companion plugin for [@savvy-web/vitest](https://github.com/savvy-web/vitest)
that gives AI coding agents the context they need to work correctly with the
package's non-standard `vitest.config.ts` and test directory conventions.

Without this plugin, agents lack awareness of auto-discovery rules, the
prescribed `__test__/` directory layout, and test classification by filename
— and tend to produce manual project configurations or misplaced test files
that conflict with how `VitestConfig.create()` works.

## Installation

```bash
claude plugins add savvy-web/vitest
```

## What It Provides

### Session Start Hook

On every session start, the plugin injects context into the conversation
automatically. The hook:

- Describes the `VitestConfig.create()` auto-discovery model and what
  agents must not do (manually define projects, create per-package configs)
- Documents the prescribed `__test__/` directory layout with correct
  subdirectory structure for `e2e/`, `integration/`, `utils/`, and `fixtures/`
- Explains the filename-based test classification rules (`*.e2e.test.ts`,
  `*.int.test.ts`, `*.test.ts`) and how project names are suffixed when a
  package has multiple test kinds
- Scans the workspace to detect the repo's actual test pattern and flags
  any packages with co-located tests in `src/` that should be migrated

### `/vitest:config` Skill

Full API reference for `@savvy-web/vitest` configuration. Invoke it when
reading or modifying a `vitest.config.ts` that uses this package. It covers:

- `VitestConfigOptions` — `coverage`, `coverageTargets`, `coverageExclude`,
  `agentReporter`, `pool`, and per-kind overrides (`unit`, `e2e`, `int`)
- `COVERAGE_LEVELS` presets — named thresholds from `none` through `full`
- `postProcess` escape hatch — for adding Vite plugins after auto-discovery
- `VitestProject` factory methods — `unit()`, `e2e()`, `int()`, `custom()`
  with their kind-specific defaults
- Mutation methods — `override()`, `addInclude()`, `addExclude()`,
  `addCoverageExclude()`
- Common recipes and anti-patterns

## Relationship to @savvy-web/vitest

This plugin is a documentation companion — it contains no source code
shipped to npm. Install `@savvy-web/vitest` in your project's
`devDependencies` as normal; install this plugin into Claude Code so agents
understand the conventions the package imposes.

## License

MIT
