---
"@savvy-web/vitest": major
---

## Breaking Changes

Replace callback-based `VitestConfig.create(callback, options?)` with
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

## Features

- Add `VitestProject.int()` factory for integration tests (60s/30s timeouts)
- Add chainable mutation methods: `override()`, `addInclude()`,
  `addExclude()`, `addCoverageExclude()`
- Add `COVERAGE_LEVELS` named presets (none/basic/standard/strict/full)
- Add per-kind overrides via object or Map callback (`unit`, `e2e`, `int`)
- Add `postProcess` escape hatch for full Vite config control
- Support `.ts`, `.tsx`, `.js`, `.jsx` file extensions in test discovery
- Auto-detect `vitest.setup.{ts,tsx,js,jsx}` per workspace package
- Exclude `fixtures/` and `utils/` dirs at conventional `__test__/` locations
- Support multiple `--project` flags for scoped coverage
- Always-on v8 coverage with configurable thresholds

## Dependencies

| Dependency | Type | Action | From | To |
| :--- | :--- | :--- | :--- | :--- |
| vitest-agent-reporter | peerDependency | updated | ^0.2.0 | ^1.0.0 |
