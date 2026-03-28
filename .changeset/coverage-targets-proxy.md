---
"@savvy-web/vitest": minor
---

## Features

### Coverage Targets

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
