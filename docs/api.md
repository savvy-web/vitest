# API Reference

Complete reference for every public export of `@savvy-web/vitest`.

## VitestProject

Represents a single Vitest project with sensible defaults per test
kind. Instances are created exclusively through static factory
methods; the constructor is private.

### Override Merge Precedence

When factory defaults and caller-supplied overrides overlap, the
following precedence applies (highest wins):

1. `name` and `include` from `VitestProjectOptions` (always win)
2. Fields in `overrides.test`
3. Factory defaults for the `test` key
4. Top-level keys: `overrides` rest spreads over factory defaults

Every configuration object produced by `toConfig()` includes
`extends: true` so that the project inherits the root Vitest
config.

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

Returns the test kind (`"unit"`, `"e2e"`, or a custom string).

### `toConfig()`

```typescript
toConfig(): TestProjectInlineConfiguration
```

Returns the fully merged Vitest-native inline configuration
object. The returned shape contains `extends: true`, a `test`
block with `name`, `include`, and any merged defaults or
overrides, plus any top-level keys provided through `overrides`.

### Factory Methods

#### `VitestProject.unit()`

```typescript
static unit(options: VitestProjectOptions): VitestProject
```

Creates a unit test project. The `kind` field is forced to
`"unit"` regardless of what `options.kind` contains.

**Defaults applied:**

| Key | Value |
| --- | --- |
| `extends` | `true` |
| `environment` | `"node"` |

```typescript
import { VitestProject } from "@savvy-web/vitest";

const project = VitestProject.unit({
  name: "@savvy-web/my-lib",
  include: ["src/**/*.test.ts"],
});

console.log(project.toConfig());
// {
//   extends: true,
//   test: {
//     name: "@savvy-web/my-lib",
//     include: ["src/**/*.test.ts"],
//     environment: "node",
//   },
// }
```

#### `VitestProject.e2e()`

```typescript
static e2e(options: VitestProjectOptions): VitestProject
```

Creates an end-to-end test project. The `kind` field is forced
to `"e2e"`.

**Defaults applied:**

| Key | Value |
| --- | --- |
| `extends` | `true` |
| `environment` | `"node"` |
| `testTimeout` | `120_000` (2 minutes) |
| `hookTimeout` | `60_000` (1 minute) |
| `maxConcurrency` | `clamp(floor(cpus / 2), 1, 8)` |

The `maxConcurrency` value is computed at call time from
`os.cpus().length`.

```typescript
import { VitestProject } from "@savvy-web/vitest";

const project = VitestProject.e2e({
  name: "@savvy-web/my-lib:e2e",
  include: ["test/e2e/**/*.test.ts"],
});

console.log(project.kind); // "e2e"
console.log(project.toConfig().test?.testTimeout); // 120000
```

#### `VitestProject.custom()`

```typescript
static custom(
  kind: VitestProjectKind,
  options: VitestProjectOptions,
): VitestProject
```

Creates a project with no preset defaults beyond `extends: true`.
The `kind` parameter is an arbitrary string stored on the
instance; it does not influence any default configuration. Use
this factory when the built-in `unit()` and `e2e()` presets do
not match your needs.

```typescript
import { VitestProject } from "@savvy-web/vitest";

const project = VitestProject.custom("integration", {
  name: "@savvy-web/my-lib:integration",
  include: ["test/integration/**/*.test.ts"],
  overrides: {
    test: { testTimeout: 30_000 },
  },
});

console.log(project.kind); // "integration"
console.log(project.toConfig().test?.environment);
// undefined (no preset)
```

## VitestConfig

Static utility class that orchestrates workspace discovery,
coverage configuration, reporter selection, and callback
invocation. Results are cached in static properties so that
repeated config evaluations during watch mode or HMR do not
re-scan the filesystem.

### Constants

#### `DEFAULT_THRESHOLD`

```typescript
static readonly DEFAULT_THRESHOLD = 80
```

Default coverage threshold percentage applied to any metric
not explicitly overridden in `VitestConfigCreateOptions`.

### `VitestConfig.create()`

```typescript
static create(
  callback: VitestConfigCallback,
  options?: VitestConfigCreateOptions,
): Promise<ViteUserConfig> | ViteUserConfig
```

**Parameters:**

- **callback** -- A function that receives discovered projects,
  coverage settings, reporters, and a CI detection flag. It
  returns a `ViteUserConfig` (or a `Promise` of one).
- **options** -- Optional object with coverage threshold
  overrides.

**Behavior:**

1. Parses `--project` from `process.argv` (supports both
   `--project=value` and `--project value`).
2. Discovers workspace packages via `workspace-tools`.
3. Scans each package's `src/` and `__test__/` directories for
   test files and classifies them as unit or e2e.
4. Builds `VitestProject` instances with appropriate names and
   include globs.
5. Generates a `CoverageConfig` with thresholds (defaults to 80
   for any omitted metric).
6. Detects CI by reading `process.env.GITHUB_ACTIONS`.
7. Invokes `callback` and returns its result.

```typescript
import { VitestConfig } from "@savvy-web/vitest";

export default VitestConfig.create(
  ({ projects, coverage, reporters }) => ({
    test: {
      reporters,
      projects: projects.map((p) => p.toConfig()),
      coverage: { provider: "v8", ...coverage },
    },
  }),
);
```

## Interfaces

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
| `name` | `string` | yes | Project name, optionally suffixed with `:unit` or `:e2e` |
| `include` | `string[]` | yes | Glob patterns for test file inclusion |
| `kind` | `VitestProjectKind` | no | Test kind (default `"unit"`). Overridden by factory methods. |
| `overrides` | `Partial<TestProjectInlineConfiguration>` | no | Vitest-native config fields merged over factory defaults |

### VitestConfigCreateOptions

Options for `VitestConfig.create()`.

```typescript
interface VitestConfigCreateOptions {
  thresholds?: {
    lines?: number;
    functions?: number;
    branches?: number;
    statements?: number;
  };
}
```

Each omitted metric defaults to
`VitestConfig.DEFAULT_THRESHOLD` (80).

### CoverageConfig

Coverage configuration passed to the `VitestConfigCallback`.

```typescript
interface CoverageConfig {
  include: string[];
  exclude: string[];
  thresholds: {
    lines: number;
    functions: number;
    branches: number;
    statements: number;
  };
}
```

| Field | Type | Description |
| --- | --- | --- |
| `include` | `string[]` | Glob patterns for files to include in coverage (e.g., `["pkgs/my-lib/src/**/*.ts"]`) |
| `exclude` | `string[]` | Glob patterns to exclude (always `["**/*.{test,spec}.ts"]`) |
| `thresholds` | `object` | Resolved thresholds with all four metrics populated |

### VitestConfigCallback

Callback signature for `VitestConfig.create()`.

```typescript
type VitestConfigCallback = (config: {
  projects: VitestProject[];
  coverage: CoverageConfig;
  reporters: string[];
  isCI: boolean;
}) => ViteUserConfig | Promise<ViteUserConfig>;
```

| Parameter | Type | Description |
| --- | --- | --- |
| `projects` | `VitestProject[]` | Discovered project instances |
| `coverage` | `CoverageConfig` | Generated coverage config with thresholds |
| `reporters` | `string[]` | Reporter names; adds `"github-actions"` in CI |
| `isCI` | `boolean` | `true` when `GITHUB_ACTIONS` env var is set |

## Types

### VitestProjectKind

```typescript
type VitestProjectKind = "unit" | "e2e" | (string & {});
```

A branded union that accepts the built-in `"unit"` and `"e2e"`
literals while also permitting any arbitrary string for custom
test kinds.

### TestProjectInlineConfiguration (re-export)

```typescript
export type { TestProjectInlineConfiguration } from "vitest/config";
```

Re-exported from `vitest/config` for consumer convenience.
Downstream packages can import this type from
`@savvy-web/vitest` without adding a direct `vitest` dependency
to their type imports.
