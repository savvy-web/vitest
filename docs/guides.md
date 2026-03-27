# Usage Guides

Practical recipes for configuring Vitest with `@savvy-web/vitest` in
pnpm monorepo workspaces.

## Zero-Config Setup

The simplest configuration discovers your entire workspace
automatically. Create a `vitest.config.ts` at the workspace root:

```typescript
import { VitestConfig } from "@savvy-web/vitest";

export default VitestConfig.create();
```

This single file replaces per-package Vitest configurations. Every
package with a `src/` directory is automatically discovered and
classified.

Run all tests:

```bash
pnpm vitest run
```

Run tests for a specific project:

```bash
pnpm vitest run --project=@savvy-web/my-lib
```

## Coverage Levels

Select a named coverage level or provide explicit thresholds. The
default is `"none"` -- tests never fail due to coverage out of the box.

```typescript
// Named level
export default VitestConfig.create({ coverage: "standard" });

// Explicit thresholds
export default VitestConfig.create({
  coverage: { lines: 95, branches: 90, functions: 95, statements: 95 },
});
```

| Level | lines | branches | functions | statements |
| --- | --- | --- | --- | --- |
| `none` | 0 | 0 | 0 | 0 |
| `basic` | 50 | 50 | 50 | 50 |
| `standard` | 70 | 65 | 70 | 70 |
| `strict` | 80 | 75 | 80 | 80 |
| `full` | 90 | 85 | 90 | 90 |

## Coverage Targets

Coverage targets are soft thresholds forwarded to `vitest-agent-reporter`.
They inform the reporter where coverage gaps exist without failing the
test run. The default is `"basic"`.

```typescript
// Set targets higher than thresholds to guide development
export default VitestConfig.create({
  coverage: "none",
  coverageTargets: "standard",
});

// Explicit target thresholds
export default VitestConfig.create({
  coverageTargets: { lines: 80, branches: 70, functions: 80, statements: 80 },
});
```

When `coverageTargets` is set at the top level and
`agentReporter.reporter.coverageTargets` is also set, the explicit
plugin option takes precedence and a warning is logged:

```typescript
// The agentReporter.reporter.coverageTargets wins here
export default VitestConfig.create({
  coverageTargets: "basic",
  agentReporter: {
    reporter: {
      coverageTargets: { lines: 90, branches: 85, functions: 90, statements: 90 },
    },
  },
});
```

## Additional Coverage Excludes

The `coverageExclude` option is additive to the built-in defaults
(`**/*.{test,spec}.*`, `**/__test__/**`, `**/generated/**`):

```typescript
export default VitestConfig.create({
  coverageExclude: ["src/legacy/**", "src/vendor/**"],
});
```

## Per-Kind Overrides (Object Form)

When you pass an object to `unit`, `e2e`, or `int`, it is merged into
every project of that kind:

```typescript
export default VitestConfig.create({
  coverage: "strict",
  unit: { environment: "jsdom" },
});
```

This sets `environment: "jsdom"` on all discovered unit test projects.
E2E and integration projects are not affected.

## Per-Project Overrides (Callback Form)

When you pass a callback, you receive a `Map<string, VitestProject>`
for fine-grained per-project mutation:

```typescript
export default VitestConfig.create({
  coverage: "strict",
  e2e: (projects) => {
    projects.get("@savvy-web/auth:e2e")
      ?.override({ test: { testTimeout: 300_000 } })
      .addCoverageExclude("src/generated/**");
  },
});
```

The `VitestProject` mutation methods (`override`, `addInclude`,
`addExclude`, `addCoverageExclude`) are all chainable.

## Agent Reporter Configuration

By default, `vitest-agent-reporter` is injected automatically. The
reporter provides AI-friendly test output with coverage summaries.

### Disable the Agent Reporter

```typescript
export default VitestConfig.create({ agentReporter: false });
```

### Custom Agent Reporter Options

```typescript
export default VitestConfig.create({
  agentReporter: {
    consoleStrategy: "complement",
    coverageConsoleLimit: 5,
    omitPassingTests: true,
    includeBareZero: false,
  },
});
```

| Option | Default | Description |
| --- | --- | --- |
| `consoleStrategy` | `"own"` | How the reporter handles console output |
| `coverageConsoleLimit` | `10` | Maximum coverage entries shown in console |
| `omitPassingTests` | `true` | Whether to omit passing tests from output |
| `includeBareZero` | `false` | Whether to include files with zero coverage |

The reporter's `coverageThresholds` and `coverageTargets` are
automatically populated from the top-level `coverage` and
`coverageTargets` options respectively. See
[Coverage Targets](#coverage-targets) for details on soft thresholds.

## Pool Configuration

Set the Vitest pool mode:

```typescript
export default VitestConfig.create({ pool: "forks" });
```

Valid values: `"threads"`, `"forks"`, `"vmThreads"`, `"vmForks"`.

## Post-Process Escape Hatch

For Vite-level configuration that falls outside the options API, use
the `postProcess` callback:

```typescript
export default VitestConfig.create(
  { coverage: "standard" },
  (config) => {
    config.resolve = { alias: { "@": "/src" } };
  },
);
```

The callback receives the fully assembled `ViteUserConfig`. Mutate it
in place (return `undefined`) or return a replacement object:

```typescript
export default VitestConfig.create(
  {},
  (config) => {
    // Return a replacement config
    return {
      ...config,
      resolve: { alias: { "@": "/src" } },
    };
  },
);
```

## Manual Project Configuration

When you need explicit control over a project, use the factory methods
directly. This is useful for packages that do not follow the standard
`src/` convention or need custom configuration.

```typescript
import { VitestProject } from "@savvy-web/vitest";

const project = VitestProject.unit({
  name: "@savvy-web/my-lib",
  include: ["src/**/*.test.ts"],
  overrides: {
    resolve: {
      alias: { "@": "/absolute/path/to/src" },
    },
  },
});

export default {
  test: {
    projects: [project.toConfig()],
  },
};
```

### Factory Defaults Summary

| Factory | environment | testTimeout | hookTimeout | maxConcurrency |
| --- | --- | --- | --- | --- |
| `unit()` | `"node"` | vitest default | vitest default | vitest default |
| `int()` | `"node"` | 60,000 | 30,000 | `floor(cpus/2)` clamped 1..8 |
| `e2e()` | `"node"` | 120,000 | 60,000 | `floor(cpus/2)` clamped 1..8 |
| `custom(kind)` | none | none | none | none |

## Custom Test Kinds

When your test suite does not fit the `unit`, `e2e`, or `int`
categories, use the `custom()` factory. It applies no preset defaults
beyond `extends: true`:

```typescript
import { VitestProject } from "@savvy-web/vitest";

const smoke = VitestProject.custom("smoke", {
  name: "@savvy-web/api:smoke",
  include: ["test/smoke/**/*.test.ts"],
  overrides: {
    test: {
      testTimeout: 10_000,
      retry: 2,
    },
  },
});
```

## CI-Aware Reporters

`VitestConfig.create()` detects GitHub Actions CI automatically by
reading the `GITHUB_ACTIONS` environment variable:

- **Local:** `["default"]`
- **CI:** `["default", "github-actions"]`

The `github-actions` reporter annotates test failures directly in pull
request diffs. No additional configuration is required.

## Running Specific Projects

Use the `--project` flag to target specific projects. Coverage is
automatically scoped to the targeted packages:

```bash
# Run unit tests for one package
pnpm vitest run --project=@savvy-web/my-lib:unit

# Run multiple projects -- coverage includes both packages
pnpm vitest run --project=@savvy-web/my-lib:unit --project=@savvy-web/auth:e2e
```

The `:unit`, `:e2e`, and `:int` suffixes are stripped when resolving
coverage includes, so coverage is scoped to the entire package
regardless of which test kind is targeted.

## Complete Configuration Example

A configuration combining multiple features:

```typescript
import { VitestConfig } from "@savvy-web/vitest";

export default VitestConfig.create(
  {
    coverage: "standard",
    coverageTargets: "strict",
    pool: "forks",
    coverageExclude: ["src/legacy/**"],
    agentReporter: {
      consoleStrategy: "complement",
      coverageConsoleLimit: 5,
    },
    unit: { environment: "jsdom" },
    e2e: (projects) => {
      projects.get("@savvy-web/auth:e2e")
        ?.override({ test: { testTimeout: 300_000 } });
    },
  },
  (config) => {
    config.resolve = { alias: { "@": "/src" } };
  },
);
```
