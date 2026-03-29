# @savvy-web/vitest

[![npm version](https://img.shields.io/npm/v/@savvy-web/vitest)](https://www.npmjs.com/package/@savvy-web/vitest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Automatic Vitest project configuration discovery for pnpm monorepo
workspaces. Scans workspace packages, classifies test files as unit,
e2e, or integration by filename convention, and generates multi-project
Vitest configs with coverage thresholds, `vitest-agent-reporter`
integration, and CI-aware reporters.

## Features

- Zero-config workspace discovery with automatic test classification
- Named coverage levels (`none`, `basic`, `standard`, `strict`, `full`)
- Per-kind and per-project override support with chainable mutation API
- Built-in `vitest-agent-reporter` integration for AI-assisted workflows
- CI-aware reporters with automatic `github-actions` reporter in CI

## Installation

```bash
pnpm add @savvy-web/vitest
```

Peer dependencies: `vitest` >=4.1.0, `@vitest/coverage-v8` >=4.1.0, `vitest-agent-reporter` >=0.2.0

## Quick Start

```typescript
import { VitestConfig } from "@savvy-web/vitest";

// Zero config -- everything automatic
export default VitestConfig.create();

// Set coverage thresholds and targets
export default VitestConfig.create({
  coverage: "standard",
  coverageTargets: "strict",
});
```

Out of the box, `coverage` defaults to `"none"` (tests never fail due to
coverage) and `coverageTargets` defaults to `"basic"` (the agent reporter
highlights coverage gaps without blocking CI).

## Directory Structure

```text
project-root/                   # or monorepo leaf workspace
  lib/                          # Configs, scripts -- linted, typechecked, no tests
  src/                          # Module source -- may contain co-located tests
  __test__/                     # Dedicated test directory
    utils/                      # Shared test helpers (excluded from discovery)
    fixtures/                   # Test fixtures (excluded from lint/typecheck/discovery)
    *.test.ts                   # Unit tests (no signifier)
    *.unit.test.ts              # Unit tests (explicit signifier)
    unit/                       # Optional unit subdirectory
      utils/                    # Excluded
      fixtures/                 # Excluded
    e2e/
      utils/                    # Excluded
      fixtures/                 # Excluded
      *.e2e.test.ts
    integration/
      utils/                    # Excluded
      fixtures/                 # Excluded
      *.int.test.ts
  vitest.setup.ts               # Optional -- auto-detected, added to all projects
```

## Examples

```typescript
// Named coverage level
export default VitestConfig.create({ coverage: "standard" });

// Per-kind overrides (object form)
export default VitestConfig.create({
  unit: { environment: "jsdom" },
});

// Per-project overrides (callback form)
export default VitestConfig.create({
  e2e: (projects) => {
    projects.get("@savvy-web/auth:e2e")
      ?.override({ test: { testTimeout: 300_000 } })
      .addCoverageExclude("src/generated/**");
  },
});

// Escape hatch for Vite-level config
export default VitestConfig.create(
  { coverage: "standard" },
  (config) => {
    config.resolve = { alias: { "@": "/src" } };
  },
);
```

## Documentation

For configuration, API reference, and advanced usage, see [docs/](./docs/).

- [API Reference](./docs/api.md) -- Complete reference for all exports
- [Test Discovery](./docs/discovery.md) -- Workspace scanning, test classification, and coverage scoping
- [Usage Guides](./docs/guides.md) -- Recipes for kind overrides, per-project mutation, coverage, agent reporter, and escape hatches

## License

[MIT](./LICENSE)
