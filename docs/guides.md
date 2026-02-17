# Usage Guides

Practical recipes for configuring Vitest with `@savvy-web/vitest`
in pnpm monorepo workspaces.

## Basic Auto-Discovery Setup

The simplest configuration scans your entire workspace and
generates projects, coverage, and reporters automatically.

Create a `vitest.config.ts` at the workspace root:

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

This single file replaces per-package Vitest configurations.
Every package with a `src/` directory is automatically discovered
and classified.

Run all tests:

```bash
pnpm vitest run
```

Run tests for a specific project:

```bash
pnpm vitest run --project=@savvy-web/my-lib
```

## Custom Thresholds

Override the default coverage thresholds (80 for all metrics) by
passing a `thresholds` object as the second argument:

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
  {
    thresholds: {
      lines: 90,
      functions: 90,
      branches: 85,
      statements: 90,
    },
  },
);
```

You can also supply a subset. Any metric you omit defaults to 80:

```typescript
VitestConfig.create(callback, {
  thresholds: { lines: 95 },
  // functions: 80, branches: 80, statements: 80
});
```

## Manual Project Configuration

When you need full control over a project's settings, create
`VitestProject` instances directly. This is useful for packages
that do not follow the standard `src/` convention or need custom
Vite configuration.

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

The `overrides` field accepts any Vitest-native configuration.
Top-level keys (like `resolve`) are merged alongside factory
defaults, while `overrides.test` fields are merged into the
`test` block. The `name` and `include` options always take
precedence over anything in `overrides`.

## Mixed Auto-Discovery and Manual Projects

Combine discovered projects with manually configured ones by
appending to the projects array inside the callback:

```typescript
import { VitestConfig, VitestProject } from "@savvy-web/vitest";

const rslibProject = VitestProject.unit({
  name: "@savvy-web/rslib-builder:unit",
  include: ["lib/configs/rslib-builder/src/**/*.test.ts"],
  overrides: {
    resolve: {
      alias: {
        "@rslib/builder": "/path/to/rslib-builder/src",
      },
    },
  },
});

export default VitestConfig.create(
  ({ projects, coverage, reporters }) => ({
    test: {
      reporters,
      projects: [
        ...projects.map((p) => p.toConfig()),
        rslibProject.toConfig(),
      ],
      coverage: { provider: "v8", ...coverage },
    },
  }),
);
```

The auto-discovered projects and the manual project coexist in
the same configuration. Coverage thresholds apply to all of them.

## E2E Project with Custom Resolve Aliases

End-to-end projects often need Vite resolve aliases or longer
timeouts. The `e2e()` factory sets generous defaults, and you can
layer additional configuration through `overrides`:

```typescript
import { VitestProject } from "@savvy-web/vitest";

const e2eProject = VitestProject.e2e({
  name: "@savvy-web/api-client:e2e",
  include: ["src/**/*.e2e.test.ts"],
  overrides: {
    resolve: {
      alias: {
        "@fixtures": "/path/to/test-fixtures",
      },
    },
    test: {
      testTimeout: 180_000,  // override the 120s default
      env: {
        API_URL: "http://localhost:3000",
      },
    },
  },
});
```

The `e2e()` factory provides these defaults:

- `testTimeout`: 120,000 ms (2 minutes)
- `hookTimeout`: 60,000 ms (1 minute)
- `maxConcurrency`: half the available CPU cores, clamped to 1-8
- `environment`: `"node"`

Any of these can be overridden individually. Defaults you do not
override remain in effect.

## CI-Aware Configuration

`VitestConfig.create()` detects GitHub Actions CI automatically
by reading the `GITHUB_ACTIONS` environment variable. The
callback receives both `reporters` and `isCI` so you can adjust
behavior per environment.

### Reporters

- **Local:** `["default"]`
- **CI:** `["default", "github-actions"]`

The `github-actions` reporter annotates test failures directly in
pull request diffs.

### Using the `isCI` Flag

```typescript
import { VitestConfig } from "@savvy-web/vitest";

export default VitestConfig.create(
  ({ projects, coverage, reporters, isCI }) => ({
    test: {
      reporters,
      projects: projects.map((p) => p.toConfig()),
      coverage: {
        provider: "v8",
        ...coverage,
        // Only write coverage reports to disk in CI
        reporter: isCI
          ? ["text", "lcov", "json-summary"]
          : ["text"],
      },
      // Disable watch mode in CI
      watch: isCI ? false : undefined,
    },
  }),
);
```

### Custom Test Kind with `custom()`

When your test suite does not fit the `unit` or `e2e` categories,
use the `custom()` factory. It applies no preset defaults beyond
`extends: true`, giving you a blank slate:

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

The `kind` value (`"smoke"` in this example) is stored on the
instance and accessible via `project.kind`, but it does not
influence any configuration defaults.
