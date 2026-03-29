# CLAUDE.md

## Project Overview

`@savvy-web/vitest` provides automatic Vitest project configuration
discovery for pnpm monorepo workspaces. It scans workspace packages,
classifies test files as unit, e2e, or integration by filename convention,
and generates multi-project Vitest configs with coverage thresholds,
`vitest-agent-reporter` integration, and CI-aware reporters.

**For workspace discovery architecture details:**
-> `@./.claude/design/vitest/workspace-discovery-architecture.md`

Load when modifying workspace discovery logic, test classification,
coverage configuration, or the VitestProject/VitestConfig class APIs.

## Commands

### Development

```bash
pnpm run lint              # Check code with Biome
pnpm run lint:fix          # Auto-fix lint issues
pnpm run typecheck         # Type-check via tsgo
pnpm run test              # Run all tests (coverage always on)
pnpm run test:watch        # Run tests in watch mode
```

### Building

```bash
pnpm run build             # Build all packages (dev + prod)
pnpm run build:dev         # Build development output only
pnpm run build:prod        # Build production/npm output only
```

### Running a Single Test

```bash
pnpm vitest run package/src/index.test.ts
```

## Architecture

### Package Structure

- **Package Manager**: pnpm with workspaces
- **Build Orchestration**: Turbo for caching and task dependencies
- **`package/`**: Publishable npm package (`@savvy-web/vitest`); contains `src/`, build config, etc.
- **`plugin/`**: Claude Code companion plugin for test convention context
- **Workspace root**: Shared configs in `lib/`

### Core System

- **`VitestConfig`**: Static class with declarative `create(options?)` API
  that discovers workspace packages, classifies test files (unit/e2e/int),
  generates coverage config with named presets (`COVERAGE_LEVELS`),
  injects `AgentPlugin` from `vitest-agent-reporter`, and always enables
  v8 coverage. Defaults: `coverage: "none"`, `coverageTargets: "basic"`.
  Supports per-kind overrides and a `postProcess` escape hatch.
- **`VitestProject`**: Class with `unit()`, `e2e()`, `int()`, and `custom()`
  factory methods that produce `TestProjectInlineConfiguration` objects
  with sensible defaults per test kind. Mutation methods: `override()`,
  `addInclude()`, `addExclude()`, `addCoverageExclude()`.

### Build Pipeline

Rslib with dual output under `package/dist/`:

1. `package/dist/dev/` - Development build with source maps
2. `package/dist/npm/` - Production build for npm publishing

Turbo config is split: root `turbo.json` defines workspace tasks; `package/turbo.json` defines package-specific tasks. `typecheck` depends on `build`.

### Code Quality

- **Biome**: Unified linting and formatting
- **Commitlint**: Enforces conventional commits with DCO signoff
- **Husky Hooks**:
  - `pre-commit`: Runs lint-staged
  - `commit-msg`: Validates commit message format
  - `pre-push`: Runs tests for affected packages

### TypeScript Configuration

- Composite builds with project references
- Strict mode enabled
- ES2022/ES2023 targets
- Import extensions required (`.js` for ESM)

### Testing

- **Framework**: Vitest with v8 coverage
- **Pool**: Uses forks (not threads) for Effect-TS compatibility
- **Config**: `vitest.config.ts` uses `VitestConfig.create()` for
  auto-discovery with project-based filtering via `--project` flag

## Conventions

### Imports

- Use `.js` extensions for relative imports (ESM requirement)
- Use `node:` protocol for Node.js built-ins
- Separate type imports: `import type { Foo } from './bar.js'`

### Commits

All commits require:

1. Conventional commit format (feat, fix, chore, etc.)
2. DCO signoff: `Signed-off-by: Name <email>`

### Publishing

Packages publish to both GitHub Packages and npm with provenance.
