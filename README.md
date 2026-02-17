# @savvy-web/vitest

Automatic Vitest project discovery and configuration for pnpm monorepo
workspaces. Define your test config once at the root and let every workspace
package with a `src/` directory be discovered, classified, and configured
automatically.

## Installation

```bash
pnpm add @savvy-web/vitest
```

Peer dependencies: `vitest`, `@vitest/coverage-v8`

## Quick Start

Create a single `vitest.config.ts` at your workspace root:

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

Every workspace package containing a `src/` directory is discovered and
configured. No per-package Vitest config files needed.

## Manual Projects

When you need explicit control, use the factory methods directly:

```typescript
import { VitestProject } from "@savvy-web/vitest";

const unit = VitestProject.unit({
  name: "@savvy-web/my-lib",
  include: ["src/**/*.test.ts"],
});

const e2e = VitestProject.e2e({
  name: "@savvy-web/my-lib:e2e",
  include: ["test/e2e/**/*.test.ts"],
  overrides: {
    test: { testTimeout: 60_000 },
  },
});
```

## API Reference

### `VitestConfig.create(callback, options?)`

Entry point for automatic workspace discovery. The callback receives:

- **`projects`** -- discovered `VitestProject[]` instances
- **`coverage`** -- `CoverageConfig` with include/exclude globs and thresholds
- **`reporters`** -- reporter names (adds `"github-actions"` in CI)
- **`isCI`** -- `true` when running in GitHub Actions

Returns whatever `ViteUserConfig` the callback produces (sync or async).

### `VitestProject.unit(options)` / `.e2e(options)` / `.custom(kind, options)`

Factory methods that create projects with preset defaults:

| Factory | Environment | Test Timeout | Hook Timeout | Max Concurrency |
| --- | --- | --- | --- | --- |
| `unit()` | `"node"` | vitest default | vitest default | vitest default |
| `e2e()` | `"node"` | 120 s | 60 s | `floor(cpus / 2)` clamped 1--8 |
| `custom(kind)` | none | none | none | none |

### `VitestProjectOptions`

```typescript
interface VitestProjectOptions {
  name: string;
  include: string[];
  kind?: VitestProjectKind;
  overrides?: Partial<TestProjectInlineConfiguration>;
}
```

`name` and `include` always take precedence over values in `overrides`.

### `VitestConfigCreateOptions`

```typescript
interface VitestConfigCreateOptions {
  thresholds?: {
    lines?: number;      // default 80
    functions?: number;   // default 80
    branches?: number;    // default 80
    statements?: number;  // default 80
  };
}
```

### `CoverageConfig`

```typescript
interface CoverageConfig {
  include: string[];   // source globs (e.g., "pkgs/my-lib/src/**/*.ts")
  exclude: string[];   // test file globs
  thresholds: {
    lines: number;
    functions: number;
    branches: number;
    statements: number;
  };
}
```

## Test Discovery Conventions

### Filename Patterns

| Pattern | Kind |
| --- | --- |
| `*.test.ts` / `*.spec.ts` | unit |
| `*.e2e.test.ts` / `*.e2e.spec.ts` | e2e |

### Directory Scanning

Each workspace package is scanned if it contains a `src/` directory. An
optional `__test__/` directory at the package root is also included when
present.

### Naming Suffixes

When a package has both unit and e2e test files, projects are automatically
suffixed with `:unit` and `:e2e` (e.g., `@savvy-web/my-lib:unit`). Packages
with only one kind use the bare package name.

## CI Integration

When the `GITHUB_ACTIONS` environment variable is set, `VitestConfig.create`
automatically adds the `"github-actions"` reporter and sets `isCI: true` in the
callback. No additional configuration required.

## License

[MIT](./LICENSE)
