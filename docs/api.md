# API Reference

Complete reference for every public export of `@savvy-web/vitest`.

## VitestConfig

Static utility class that orchestrates workspace discovery, coverage
configuration, reporter selection, and agent reporter injection.
Results are cached in static properties so that repeated config
evaluations during watch mode or HMR do not re-scan the filesystem.

### `VitestConfig.create()`

```typescript
static async create(
  options?: VitestConfigOptions,
  postProcess?: PostProcessCallback,
): Promise<ViteUserConfig>
```

Entry point for automatic workspace discovery and configuration
assembly. Returns a complete `ViteUserConfig` ready to export from
`vitest.config.ts`.

**Parameters:**

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `options` | `VitestConfigOptions` | no | Declarative configuration options |
| `postProcess` | `PostProcessCallback` | no | Escape-hatch callback for full config control |

**Behavior:**

1. Parses all `--project` flags from `process.argv` (supports both
   `--project=value` and `--project value`).
2. Discovers workspace packages via `workspace-tools`.
3. Scans each package's `src/` and `__test__/` directories for test
   files and classifies them as unit, e2e, or integration.
4. Builds `VitestProject` instances with appropriate names and include
   globs.
5. Applies kind-specific overrides from `options.unit`, `options.e2e`,
   and `options.int`.
6. Generates coverage configuration with thresholds, include/exclude
   patterns, and optional per-project coverage excludes.
7. Detects CI by reading `process.env.GITHUB_ACTIONS` and sets
   reporters accordingly.
8. Injects `vitest-agent-reporter` plugin (unless
   `agentReporter: false`).
9. Invokes `postProcess` callback if provided.
10. Returns the assembled config.

```typescript
import { VitestConfig } from "@savvy-web/vitest";

// Zero config
export default VitestConfig.create();

// With options
export default VitestConfig.create({ coverage: "standard" });

// With options and post-processing
export default VitestConfig.create(
  { coverage: "standard" },
  (config) => {
    config.resolve = { alias: { "@": "/src" } };
  },
);
```

### `VitestConfig.COVERAGE_LEVELS`

```typescript
static readonly COVERAGE_LEVELS: Readonly<Record<CoverageLevelName, CoverageThresholds>>
```

Named coverage level presets. The object is frozen and cannot be
mutated.

| Level | lines | branches | functions | statements |
| --- | --- | --- | --- | --- |
| `none` | 0 | 0 | 0 | 0 |
| `basic` | 50 | 50 | 50 | 50 |
| `standard` | 70 | 65 | 70 | 70 |
| `strict` | 80 | 75 | 80 | 80 |
| `full` | 90 | 85 | 90 | 90 |

---

## VitestProject

Represents a single Vitest project with sensible defaults per test
kind. Instances are created through static factory methods; the
constructor is private.

### Override Merge Precedence

When factory defaults and caller-supplied overrides overlap, the
following precedence applies (highest wins):

1. `name` and `include` from `VitestProjectOptions` (always win)
2. Fields in `overrides.test`
3. Factory defaults for the `test` key
4. Top-level keys: `overrides` rest spreads over factory defaults

Every configuration object produced by `toConfig()` includes
`extends: true` so that the project inherits the root Vitest config.

### Accessors

#### `name`

```typescript
get name(): string
```

Returns the project name supplied at construction time.

#### `kind`

```typescript
get kind(): VitestProjectKind
```

Returns the test kind (`"unit"`, `"e2e"`, `"int"`, or a custom
string).

#### `coverageExcludes`

```typescript
get coverageExcludes(): readonly string[]
```

Returns coverage exclusion patterns accumulated via
`addCoverageExclude()`. These patterns are not embedded in the inline
project config but are available for the workspace-level coverage
configuration to consume.

### `toConfig()`

```typescript
toConfig(): TestProjectInlineConfiguration
```

Returns the fully merged Vitest-native inline configuration object.
The returned shape contains `extends: true`, a `test` block with
`name`, `include`, and any merged defaults or overrides, plus any
top-level keys provided through `overrides`.

### Mutation Methods (Chainable)

All mutation methods return `this` for chaining.

#### `override(config)`

```typescript
override(config: Partial<TestProjectInlineConfiguration>): this
```

Merges additional configuration over the current config. The `name`
and `include` fields are preserved and cannot be overridden.

```typescript
project
  .override({ test: { testTimeout: 300_000 } })
  .addCoverageExclude("src/generated/**");
```

#### `addInclude(...patterns)`

```typescript
addInclude(...patterns: string[]): this
```

Appends glob patterns to the test include list.

#### `addExclude(...patterns)`

```typescript
addExclude(...patterns: string[]): this
```

Appends glob patterns to the test exclude list.

#### `addCoverageExclude(...patterns)`

```typescript
addCoverageExclude(...patterns: string[]): this
```

Appends glob patterns to the coverage exclusion list. These are
exposed via the `coverageExcludes` getter for the workspace-level
coverage configuration to consume.

### Factory Methods

#### `VitestProject.unit()`

```typescript
static unit(options: VitestProjectOptions): VitestProject
```

Creates a unit test project. The `kind` field is forced to `"unit"`.

| Default | Value |
| --- | --- |
| `extends` | `true` |
| `environment` | `"node"` |

```typescript
const project = VitestProject.unit({
  name: "@savvy-web/my-lib",
  include: ["src/**/*.test.ts"],
});
```

#### `VitestProject.e2e()`

```typescript
static e2e(options: VitestProjectOptions): VitestProject
```

Creates an end-to-end test project. The `kind` field is forced to
`"e2e"`.

| Default | Value |
| --- | --- |
| `extends` | `true` |
| `environment` | `"node"` |
| `testTimeout` | `120_000` (2 minutes) |
| `hookTimeout` | `60_000` (1 minute) |
| `maxConcurrency` | `clamp(floor(cpus / 2), 1, 8)` |

```typescript
const project = VitestProject.e2e({
  name: "@savvy-web/my-lib:e2e",
  include: ["__test__/e2e/**/*.e2e.test.ts"],
});
```

#### `VitestProject.int()`

```typescript
static int(options: VitestProjectOptions): VitestProject
```

Creates an integration test project. The `kind` field is forced to
`"int"`.

| Default | Value |
| --- | --- |
| `extends` | `true` |
| `environment` | `"node"` |
| `testTimeout` | `60_000` (1 minute) |
| `hookTimeout` | `30_000` (30 seconds) |
| `maxConcurrency` | `clamp(floor(cpus / 2), 1, 8)` |

```typescript
const project = VitestProject.int({
  name: "@savvy-web/my-lib:int",
  include: ["__test__/integration/**/*.int.test.ts"],
});
```

#### `VitestProject.custom()`

```typescript
static custom(
  kind: VitestProjectKind,
  options: VitestProjectOptions,
): VitestProject
```

Creates a project with no preset defaults beyond `extends: true`. The
`kind` parameter is an arbitrary string stored on the instance; it
does not influence any default configuration.

```typescript
const project = VitestProject.custom("smoke", {
  name: "@savvy-web/api:smoke",
  include: ["test/smoke/**/*.test.ts"],
  overrides: {
    test: { testTimeout: 10_000, retry: 2 },
  },
});
```

---

## Interfaces

### VitestConfigOptions

Options for `VitestConfig.create()`.

```typescript
interface VitestConfigOptions {
  coverage?: CoverageLevelName | CoverageThresholds;
  coverageExclude?: string[];
  agentReporter?: boolean | AgentReporterConfig;
  pool?: "threads" | "forks" | "vmThreads" | "vmForks";
  unit?: KindOverride;
  e2e?: KindOverride;
  int?: KindOverride;
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `coverage` | `CoverageLevelName \| CoverageThresholds` | `"strict"` | Coverage level name or explicit thresholds |
| `coverageExclude` | `string[]` | `[]` | Additional glob patterns excluded from coverage (additive to built-in defaults) |
| `agentReporter` | `boolean \| AgentReporterConfig` | `true` | Whether to inject the `vitest-agent-reporter` plugin |
| `pool` | `"threads" \| "forks" \| "vmThreads" \| "vmForks"` | Vitest default | Vitest pool mode |
| `unit` | `KindOverride` | -- | Override for all unit test projects |
| `e2e` | `KindOverride` | -- | Override for all e2e test projects |
| `int` | `KindOverride` | -- | Override for all integration test projects |

### AgentReporterConfig

Configuration options for the `vitest-agent-reporter` plugin.

```typescript
interface AgentReporterConfig {
  consoleStrategy?: "own" | "complement";
  coverageConsoleLimit?: number;
  omitPassingTests?: boolean;
  includeBareZero?: boolean;
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `consoleStrategy` | `"own" \| "complement"` | `"own"` | How the reporter handles console output |
| `coverageConsoleLimit` | `number` | `10` | Maximum coverage entries to show in console |
| `omitPassingTests` | `boolean` | `true` | Whether to omit passing tests from output |
| `includeBareZero` | `boolean` | `false` | Whether to include files with zero coverage |

### VitestProjectOptions

Options accepted by every `VitestProject` factory method.

```typescript
interface VitestProjectOptions {
  name: string;
  include: string[];
  kind?: VitestProjectKind;
  overrides?: Partial<TestProjectInlineConfiguration>;
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | `string` | yes | Project name, optionally suffixed with `:unit`, `:e2e`, or `:int` |
| `include` | `string[]` | yes | Glob patterns for test file inclusion |
| `kind` | `VitestProjectKind` | no | Test kind (default `"unit"`). Overridden by factory methods. |
| `overrides` | `Partial<TestProjectInlineConfiguration>` | no | Vitest-native config fields merged over factory defaults |

### CoverageThresholds

Coverage thresholds with all four metrics required.

```typescript
interface CoverageThresholds {
  lines: number;
  functions: number;
  branches: number;
  statements: number;
}
```

---

## Types

### VitestProjectKind

```typescript
type VitestProjectKind = "unit" | "e2e" | "int" | (string & {});
```

A branded union that accepts the built-in `"unit"`, `"e2e"`, and
`"int"` literals while also permitting any arbitrary string for custom
test kinds.

### CoverageLevelName

```typescript
type CoverageLevelName = "none" | "basic" | "standard" | "strict" | "full";
```

Named coverage level presets available on
`VitestConfig.COVERAGE_LEVELS`.

### KindOverride

```typescript
type KindOverride =
  | Partial<TestProjectInlineConfiguration["test"]>
  | ((projects: Map<string, VitestProject>) => void);
```

When an object is provided, it is merged into every project of that
kind. When a callback is provided, it receives a `Map` of project name
to `VitestProject` for fine-grained per-project mutation.

### PostProcessCallback

```typescript
type PostProcessCallback = (config: ViteUserConfig) => ViteUserConfig | undefined;
```

Escape-hatch callback for full control over the assembled config. If a
replacement config is returned, it replaces the original. If `void` or
`undefined` is returned, the (possibly mutated) original is used.

### TestProjectInlineConfiguration (re-export)

```typescript
export type { TestProjectInlineConfiguration } from "vitest/config";
```

Re-exported from `vitest/config` for consumer convenience. Downstream
packages can import this type from `@savvy-web/vitest` without adding
a direct `vitest` dependency to their type imports.

---

## Default Coverage Excludes

The following patterns are always excluded from coverage reporting,
before any user-supplied `coverageExclude` patterns are appended:

- `**/*.{test,spec}.{ts,tsx,js,jsx}`
- `**/__test__/**`
- `**/generated/**`
