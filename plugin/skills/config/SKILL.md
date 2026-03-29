---
name: config
description: >
  Full API reference for @savvy-web/vitest configuration. Use when modifying
  vitest.config.ts — covers VitestConfigOptions, VitestProject factories,
  mutation methods, coverage level presets, and common recipes.
---

# @savvy-web/vitest Configuration Reference

## VitestConfig.create()

```typescript
import { VitestConfig } from "@savvy-web/vitest";

export default VitestConfig.create(options?, postProcess?);
```

`VitestConfig.create()` auto-discovers workspace packages with `src/`
directories, classifies test files by filename convention, and generates
multi-project Vitest configs. Do not manually define test projects.

## VitestConfigOptions

### coverage

**Type:** `CoverageLevelName | CoverageThresholds`
**Default:** `"none"`

Coverage thresholds that **fail tests** when not met. Use a named level
or an explicit object.

**Named levels** (lines / branches / functions / statements):

| Level | lines | branches | functions | statements |
| --- | --- | --- | --- | --- |
| `none` | 0 | 0 | 0 | 0 |
| `basic` | 50 | 50 | 50 | 50 |
| `standard` | 70 | 65 | 70 | 70 |
| `strict` | 80 | 75 | 80 | 80 |
| `full` | 90 | 85 | 90 | 90 |

Access programmatically via `VitestConfig.COVERAGE_LEVELS.standard`.

### coverageTargets

**Type:** `CoverageLevelName | CoverageThresholds`
**Default:** `"basic"`

Thresholds forwarded to `vitest-agent-reporter`. These are
**informational only** — they do not cause test failures. The reporter
uses them to identify coverage gaps.

### coverageExclude

**Type:** `string[]`

Additional glob patterns excluded from coverage reporting, appended to
the built-in exclusions.

### agentReporter

**Type:** `boolean | AgentReporterConfig`
**Default:** `true`

Controls injection of the `vitest-agent-reporter` plugin. When `true`,
injects with default options. When an `AgentReporterConfig` object,
passes the options through. When `false`, disables injection.

### pool

**Type:** `"threads" | "forks" | "vmThreads" | "vmForks"`
**Default:** Vitest default (threads)

Vitest pool mode. Use `"forks"` for Effect-TS compatibility.

### unit / e2e / int

**Type:** `KindOverride`

Per-kind overrides applied to all projects of that test kind.

**Object form** — merged into every project's `test` config:

```typescript
VitestConfig.create({
  e2e: { testTimeout: 300_000 },
});
```

**Callback form** — receives a `Map<string, VitestProject>` for
fine-grained per-project mutation:

```typescript
VitestConfig.create({
  unit: (projects) => {
    const pkg = projects.get("@savvy-web/my-lib:unit");
    pkg?.addCoverageExclude("**/generated/**");
  },
});
```

### postProcess (second argument)

**Type:** `(config: ViteUserConfig) => ViteUserConfig | undefined`

Escape hatch for modifying the assembled config after all discovery
and overrides have been applied. Return a replacement config or
`undefined` to use the mutated original.

```typescript
VitestConfig.create({}, (config) => {
  config.plugins ??= [];
  config.plugins.push(myPlugin());
  return config;
});
```

## VitestProject

Projects are created via static factory methods. Each factory applies
kind-specific defaults.

### Factory Defaults

| Factory | environment | testTimeout | hookTimeout | maxConcurrency |
| --- | --- | --- | --- | --- |
| `unit()` | node | vitest default | vitest default | vitest default |
| `int()` | node | 60,000 | 30,000 | floor(cpus/2) clamped 1..8 |
| `e2e()` | node | 120,000 | 60,000 | floor(cpus/2) clamped 1..8 |
| `custom(kind)` | — | — | — | — |

### Mutation Methods

All methods are chainable (return `this`):

- **`override(config)`** — merge additional
  `TestProjectInlineConfiguration`; `name` and `include` are always
  preserved
- **`addInclude(...patterns)`** — append glob patterns to the test
  include list
- **`addExclude(...patterns)`** — append glob patterns to the test
  exclude list
- **`addCoverageExclude(...patterns)`** — append glob patterns to
  per-project coverage exclusions

### Properties

- **`name`** — project name (read-only)
- **`kind`** — test kind: `"unit"`, `"e2e"`, `"int"`, or custom
  (read-only)
- **`coverageExcludes`** — accumulated coverage exclusion patterns
  (read-only)
- **`toConfig()`** — returns the Vitest-native
  `TestProjectInlineConfiguration`

## Common Recipes

### Set coverage with agent-reporter targets

```typescript
VitestConfig.create({
  coverage: "standard",
  coverageTargets: "strict",
});
```

### Use forks pool for Effect-TS

```typescript
VitestConfig.create({
  pool: "forks",
});
```

### Exclude generated code from coverage

```typescript
VitestConfig.create({
  unit: (projects) => {
    for (const [, project] of projects) {
      project.addCoverageExclude("**/generated/**");
    }
  },
});
```

### Increase e2e timeout for slow tests

```typescript
VitestConfig.create({
  e2e: { testTimeout: 300_000, hookTimeout: 120_000 },
});
```

### Add a Vite plugin via postProcess

```typescript
VitestConfig.create({}, (config) => {
  config.plugins ??= [];
  config.plugins.push(myVitePlugin());
  return config;
});
```

## Anti-Patterns

- **Don't manually define test projects** — `VitestConfig.create()`
  handles discovery. Adding manual `projects` entries bypasses
  conventions.
- **Don't create per-package vitest configs** — one workspace-root
  config discovers all packages.
- **Don't bypass `VitestConfig.create()`** — raw Vitest config loses
  auto-discovery, coverage presets, and agent-reporter integration.
- **Don't hardcode include patterns** — use `addInclude()` via
  per-kind overrides if you need extras.
