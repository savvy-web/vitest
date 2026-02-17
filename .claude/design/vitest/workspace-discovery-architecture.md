---
status: current
module: vitest
category: architecture
created: 2026-02-16
updated: 2026-02-17
last-synced: 2026-02-17
completeness: 75
related: []
dependencies: []
implementation-plans: ["mossy-baking-matsumoto"]
---

# Workspace Discovery Architecture

Utility classes for automatic Vitest project configuration discovery
in pnpm monorepo workspaces, with test-type classification, coverage
thresholds, and CI-aware reporter selection.

## Table of Contents

1. [Overview](#overview)
2. [Current State](#current-state)
3. [Rationale](#rationale)
4. [System Architecture](#system-architecture)
5. [Data Flow](#data-flow)
6. [Integration Points](#integration-points)
7. [Testing Strategy](#testing-strategy)
8. [Future Enhancements](#future-enhancements)
9. [Related Documentation](#related-documentation)

---

## Overview

The workspace discovery system eliminates per-package Vitest
configuration in monorepos. A single call to `VitestConfig.create()`
scans every workspace package that contains a `src/` directory,
classifies test files as unit or e2e by filename convention, and
produces `VitestProject` instances with sensible defaults for each
kind. Coverage include/exclude patterns, threshold enforcement, and
CI-specific reporters are generated automatically.

Results are cached in static properties (`cachedProjects` and
`cachedVitestProjects`) so that repeated config evaluations during
watch mode or HMR do not re-scan the filesystem.

**Key Design Principles:**

* Zero-configuration for workspace consumers: adding a package with
  `src/` is enough for it to be discovered
* Caching for performance across config reloads within a single
  process
* Support for both full-workspace and single-project test runs via
  `--project` flag
* Convention-over-configuration test classification by filename
  pattern

**When to reference this document:**

* When modifying the workspace discovery logic
* When adding support for new workspace layouts or test directory
  conventions
* When changing coverage configuration generation
* When debugging project filtering via `--project` flag

---

## Current State

### System Components

#### Component 1: VitestProject (Class)

**Location:** `src/index.ts`

**Purpose:** Encapsulates a single Vitest project with preset
defaults per test kind. Uses a private constructor; instances are
created through static factory methods.

**Responsibilities:**

* Store project name, kind, and merged configuration
* Provide `toConfig()` for Vitest-native
  `TestProjectInlineConfiguration`
* Apply kind-specific defaults (timeouts, concurrency, environment)
* Merge overrides with a defined precedence order

**Key interfaces/APIs:**

```typescript
export type VitestProjectKind = "unit" | "e2e" | (string & {});

export interface VitestProjectOptions {
  name: string;
  include: string[];
  kind?: VitestProjectKind;
  overrides?: Partial<TestProjectInlineConfiguration>;
}

export class VitestProject {
  static unit(options: VitestProjectOptions): VitestProject;
  static e2e(options: VitestProjectOptions): VitestProject;
  static custom(
    kind: VitestProjectKind,
    options: VitestProjectOptions,
  ): VitestProject;

  get name(): string;
  get kind(): VitestProjectKind;
  toConfig(): TestProjectInlineConfiguration;
}
```

**Factory defaults:**

| Factory | `extends` | `environment` | `testTimeout` | `hookTimeout` | `maxConcurrency` |
| --- | --- | --- | --- | --- | --- |
| `unit()` | `true` | `"node"` | (vitest dflt) | (vitest dflt) | (vitest dflt) |
| `e2e()` | `true` | `"node"` | `120_000` | `60_000` | `floor(cpus / 2)` 1..8 |
| `custom()` | `true` | (none) | (none) | (none) | (none) |

**Override merge precedence (highest wins):**

1. `name` and `include` from options (always win)
2. `overrides.test` fields
3. Factory defaults for `test`
4. Top-level: `overrides` rest spreads over factory defaults rest

#### Component 2: VitestConfig (Static Class)

**Location:** `src/index.ts`

**Purpose:** Entry point that orchestrates workspace discovery,
coverage configuration, reporter selection, and callback invocation.

**Responsibilities:**

* Parse `--project` from `process.argv` with null-safe guards
* Discover workspace packages via `workspace-tools`
* Check for `src/` and `__test__/` directories via the
  `isDirectory()` helper
* Scan directories for test files and classify as unit or e2e
* Build include glob arrays via the `buildIncludes()` helper
* Generate `VitestProject` instances with appropriate names and
  include globs
* Build `CoverageConfig` with configurable thresholds
  (`DEFAULT_THRESHOLD = 80`)
* Detect `GITHUB_ACTIONS` env for CI reporters
* Cache results across repeated calls

**Key interfaces/APIs:**

```typescript
export interface VitestConfigCreateOptions {
  thresholds?: {
    lines?: number;
    functions?: number;
    branches?: number;
    statements?: number;
  };
}

export interface CoverageConfig {
  include: string[];
  exclude: string[];
  thresholds: {
    lines: number;
    functions: number;
    branches: number;
    statements: number;
  };
}

export type VitestConfigCallback = (config: {
  projects: VitestProject[];
  coverage: CoverageConfig;
  reporters: string[];
  isCI: boolean;
}) => ViteUserConfig | Promise<ViteUserConfig>;
```

**Static constant:**

* `static readonly DEFAULT_THRESHOLD = 80` -- default coverage
  percentage applied to any threshold metric not explicitly
  overridden in `VitestConfigCreateOptions`

**Private methods:**

* `getSpecificProject()` -- parses `--project=value` or
  `--project value` from `process.argv`; returns `null` with
  null-coalescing guards when the value segment is missing
* `getPackageNameFromPath(path)` -- reads `package.json` name
  field; returns `null` via `?? null` when the name property is
  absent or the file is unreadable
* `isDirectory(dirPath)` -- checks whether a path is an existing
  directory using `statSync`; consolidates the repeated
  try/catch + `isDirectory()` pattern
* `buildIncludes(srcGlob, testGlob, pattern)` -- builds an array
  of include glob patterns from a `src/` glob and an optional
  `__test__/` glob, reducing duplication across project creation
  branches
* `scanForTestFiles(dirPath)` -- recursive scan returning
  `{ hasUnit, hasE2e }` based on `*.e2e.{test,spec}.ts` vs
  `*.{test,spec}.ts`; short-circuits when both kinds are found
* `discoverWorkspaceProjects()` -- iterates workspace packages,
  normalizes empty relative paths to `"."` for root-package
  workspaces, computes a `prefix` that avoids leading-slash
  globs, uses `isDirectory()` to check for `src/` and
  `__test__/`, uses `buildIncludes()` to generate globs,
  creates projects
* `getCoverageConfig(specificProject, projects, options)` -- strips
  `:unit`/`:e2e` suffix for `--project` lookup, uses an internal
  `toSrcGlob()` helper that handles the root-package `"."` case,
  applies thresholds from `DEFAULT_THRESHOLD`

**Re-exports:**

* `TestProjectInlineConfiguration` from `vitest/config` is
  re-exported (`export type`) for consumer portability, so
  downstream packages do not need a direct `vitest` dependency
  to type their overrides

**Dependencies:**

* `workspace-tools` -- `getWorkspaceManagerRoot`,
  `getWorkspacePackagePaths`
* `node:fs` -- `readFileSync`, `readdirSync`, `statSync`
* `node:os` -- `cpus`
* `node:path` -- `join`, `relative`
* `vitest/config` -- `TestProjectInlineConfiguration`,
  `ViteUserConfig`

### Architecture Diagram

```text
+-------------------+
|  vitest.config.ts |  (consumer's config file)
+--------+----------+
         |
         v
+--------+-----------------------+
| VitestConfig.create(cb, opts?) |
+--------+-----------------------+
         |
    +----+----+----------+
    |         |          |
    v         v          v
+---+---+ +---+--------+ +-------+
| parse | | discover   | | build |
| --project  workspace | | reporters
| argv  |  projects   | | (CI?) |
+---+---+ +---+--------+ +---+---+
    |         |               |
    |    +----+----+          |
    |    |         |          |
    |    v         v          |
    | +--+------+ +---+-----+ |
    | | isDir() | | classify | |
    | | scan    | | unit vs  | |
    | | src/ &  | | e2e by   | |
    | |__test__ | | filename | |
    | +--+------+ +---+-----+ |
    |    |            |        |
    |    v            v        |
    | +--+-----+ +---+------+ |
    | |buildIn-| |VitestProj| |
    | |cludes()| |.unit()   | |
    | |  globs | |.e2e()    | |
    | +--+-----+ |.custom() | |
    |    |       +---+------+  |
    |    +----+------+         |
    |         |                |
    v         v                |
+---+---------+---+            |
| getCoverageConfig|           |
| DEFAULT_THRESHOLD|           |
+--------+--------+            |
         |                     |
         v                     v
+--------+--------+------------+--+
| callback({ projects, coverage, |
|   reporters, isCI })            |
+--------+------------------------+
         |
         v
    ViteUserConfig
```

### Current Limitations

* Requires a `src/` directory in each package; packages without
  `src/` are silently skipped
* Only scans `src/` and `__test__/` for test files; other
  directories (e.g., `tests/`, `test/`) are ignored
* Hardcodes `"node"` as the default environment for `unit()` and
  `e2e()` factories
* Test file classification relies solely on filename patterns
  (`*.e2e.test.ts` vs `*.test.ts`); directory-based classification
  is not supported
* Packages with no existing test files still get a unit project
  entry (forward-looking, but adds noise)

---

## Rationale

### Architectural Decisions

#### Decision 1: Static Class Pattern

**Context:** The API needs a namespace for related methods with
shared cached state, without requiring consumers to manage
instances.

**Options considered:**

1. **Static class (Chosen):**
   * Pros: groups related methods; static properties provide
     natural caching; clear API surface (`VitestConfig.create()`)
   * Cons: not instantiable; harder to test in isolation; biome
     lint requires `noStaticOnlyClass` suppression
   * Why chosen: matches the "call once, get config" usage pattern;
     caching across calls is trivial with static properties

2. **Module-level functions:**
   * Pros: simpler; no class needed
   * Cons: module-level mutable state for caching is less explicit;
     harder to group related functions for discoverability
   * Why rejected: static class provides better namespace grouping
     and makes the caching mechanism explicit

#### Decision 2: Callback-Based API

**Context:** `VitestConfig.create()` accepts a callback rather than
returning a config directly.

**Options considered:**

1. **Callback pattern (Chosen):**
   * Pros: consumer controls final config shape; can spread
     coverage into any structure; supports both sync and async
     returns
   * Cons: slightly more complex call site
   * Why chosen: Vitest config structure varies by consumer (some
     add plugins, custom reporters, etc.); callback lets consumers
     compose freely

2. **Direct return:**
   * Pros: simpler call site
   * Cons: rigid output structure; consumers would need to
     destructure and reassemble anyway
   * Why rejected: too opinionated about the final config shape

#### Decision 3: In-Memory Caching

**Context:** Static properties store discovered projects so
repeated `create()` calls (watch mode, HMR) skip filesystem
scanning.

**Options considered:**

1. **Static property cache (Chosen):**
   * Pros: zero overhead; survives across multiple config
     evaluations in the same process
   * Cons: stale if packages are added/removed mid-session
   * Why chosen: config files are re-evaluated infrequently;
     restarting the dev server is expected when adding packages

#### Decision 4: VitestProject Class with Factories

**Context:** A class that encapsulates merge logic and exposes
kind-specific factories rather than exposing raw configuration
objects to consumers.

**Options considered:**

1. **Factory class (Chosen):**
   * Pros: encapsulates merge precedence; enforces `name`/`include`
     immutability; kind-specific defaults in one place; extensible
     via `custom()` for arbitrary test kinds
   * Cons: more complex than a plain interface
   * Why chosen: merge logic was error-prone when scattered;
     factories (`unit`, `e2e`, `custom`) make intent explicit

### Design Patterns Used

#### Pattern 1: Lazy Initialization with Caching

* **Where used:** `discoverWorkspaceProjects()`
* **Why used:** filesystem scanning is expensive; the result is
  stable within a single process
* **Implementation:** checks `cachedProjects` and
  `cachedVitestProjects` at the top of the method; returns
  immediately if non-null; otherwise scans and stores

#### Pattern 2: Factory Method

* **Where used:** `VitestProject.unit()`, `.e2e()`, `.custom()`
* **Why used:** each test kind requires different defaults; private
  constructor prevents invalid construction
* **Implementation:** each factory passes kind-specific defaults to
  the private constructor which handles the merge

### Constraints and Trade-offs

#### Constraint 1: pnpm Workspace Layout

* **Description:** relies on `workspace-tools` to discover package
  paths, which requires a valid pnpm workspace configuration
* **Impact:** only works in pnpm workspaces (not npm or yarn)
* **Mitigation:** `workspace-tools` is a peer dependency; the root
  `pnpm-workspace.yaml` is the single source of truth

#### Constraint 2: Filename-Based Classification

* **Description:** test kind is determined by filename pattern, not
  by directory or configuration
* **Impact:** consumers must follow the `*.e2e.test.ts` convention
  for e2e tests
* **Mitigation:** convention is documented; the `custom()` factory
  allows escape-hatch for non-standard setups

---

## System Architecture

### Component Interactions

#### Interaction 1: Full Workspace Test Run

**Participants:** VitestConfig, workspace-tools, filesystem

**Flow:**

1. Consumer calls `VitestConfig.create(callback, options?)`
2. `getSpecificProject()` parses argv, returns `null`
3. `discoverWorkspaceProjects()` scans workspace:
   * Gets workspace root and package paths
   * For each package with `src/`, reads `package.json` name
   * Scans `src/` and `__test__/` (if exists) recursively
   * Classifies files: `*.e2e.{test,spec}.ts` as e2e, others as
     unit
   * Creates `VitestProject.unit()` and/or `.e2e()` instances
   * Adds `:unit`/`:e2e` name suffixes when both kinds exist
4. `getCoverageConfig()` generates include patterns for all
   projects with thresholds (`DEFAULT_THRESHOLD = 80`)
5. Reporters are set: `["default"]` normally,
   `["default", "github-actions"]` when `GITHUB_ACTIONS` is set
6. `callback` receives `{ projects, coverage, reporters, isCI }`
7. Returned `ViteUserConfig` is used by Vitest

#### Interaction 2: Single Project Test Run

**Participants:** VitestConfig, process.argv

**Flow:**

1. Consumer calls `VitestConfig.create(callback)`
2. `getSpecificProject()` finds `--project=@scope/pkg` or
   `--project=@scope/pkg:unit`
3. `discoverWorkspaceProjects()` scans workspace (or uses cache)
4. `getCoverageConfig()` strips `:unit`/`:e2e` suffix from the
   project name, looks up the base package in the project mapping,
   and generates include for that single package folder
5. `callback` receives all projects but scoped coverage

**Consumer example:**

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
  { thresholds: { lines: 90, branches: 85 } },
);
```

---

## Data Flow

### Data Model

```typescript
// Internal mapping: package name -> relative path from workspace
// root
type ProjectMapping = Record<string, string>;
// e.g., { "@savvy-web/vitest": "pkgs/vitest" }

// Scan result per directory
interface ScanResult {
  hasUnit: boolean;
  hasE2e: boolean;
}

// Coverage config passed to callback
interface CoverageConfig {
  include: string[];   // e.g., ["pkgs/vitest/src/**/*.ts"]
  exclude: string[];   // ["**/*.{test,spec}.ts"]
  thresholds: {
    lines: number;     // default 80
    functions: number;
    branches: number;
    statements: number;
  };
}
```

### Data Flow Diagram

```text
[pnpm workspace root]
      |
      v
[workspace-tools.getWorkspacePackagePaths()]
      |
      v
[For each package path]
      |
      +---> [getPackageNameFromPath() ?? null -> skip]
      |
      +---> [isDirectory(src/) ?]
      |          |
      |         no ---> skip
      |          |
      |         yes
      |          |
      |          v
      |     [scanForTestFiles(src/)]
      |          |
      |          v
      |     [isDirectory(__test__/) ?]
      |          |
      |     yes: scanForTestFiles(__test__/)
      |          |
      |          v
      |     [classify: hasUnit / hasE2e]
      |          |
      |     +----+----+----+
      |     |         |    |
      |     v         v    v
      |   both?    unit?  e2e?
      |     |         |    |
      |     v         v    v
      | :unit/:e2e  bare  bare
      | suffixed    name  name
      |     |         |    |
      |     v         v    v
      | buildIncludes() -> glob patterns
      |     |
      |     v
      | VitestProject.unit() + .e2e()
      |   or .unit() only
      |   or .e2e() only
      |   or .unit() (fallback, no tests found)
      |
      v
[Cache: cachedProjects + cachedVitestProjects]
      |
      v
[getCoverageConfig: apply --project filter +
 DEFAULT_THRESHOLD]
      |
      v
[callback receives { projects, coverage, reporters, isCI }]
```

### Filename Classification Rules

| Pattern | Kind | Example |
| --- | --- | --- |
| `*.e2e.test.ts` | e2e | `auth.e2e.test.ts` |
| `*.e2e.spec.ts` | e2e | `auth.e2e.spec.ts` |
| `*.test.ts` (not `.e2e.`) | unit | `parser.test.ts` |
| `*.spec.ts` (not `.e2e.`) | unit | `parser.spec.ts` |

---

## Integration Points

### Internal Integrations

#### Integration 1: workspace-tools

**How it integrates:** Uses `getWorkspaceManagerRoot(cwd)` to find
the workspace root, then `getWorkspacePackagePaths(root)` to get
absolute paths to all workspace packages.

**Data exchange:** Returns array of absolute paths. Falls back to
`cwd` if no root found, and empty array if no paths found.

#### Integration 2: Vitest Configuration

**How it integrates:** The callback returns a `ViteUserConfig`
compatible with Vitest's `defineConfig()`. Projects are passed as
`VitestProject` instances; consumers call `.toConfig()` to get
`TestProjectInlineConfiguration` objects.

#### Integration 3: CI Environment Detection

**How it integrates:** Reads `process.env.GITHUB_ACTIONS` to
determine if running in CI. When truthy, adds `"github-actions"` to
the reporters array and sets `isCI: true`.

### External Integrations

#### Integration 1: Consumer vitest.config.ts

**Purpose:** Consumed by monorepo projects to auto-generate
multi-project Vitest configuration with coverage and reporters.

**Protocol:** TypeScript import + callback invocation. The consumer
decides the final config shape.

---

## Testing Strategy

### Unit Tests

**Location:** `src/index.test.ts`

**Coverage target:** 80% (all metrics, configurable via
`VitestConfigCreateOptions`)

**What is tested:**

* `VitestProject.unit()` -- default environment, override merging,
  top-level overrides, `name`/`include` always win over overrides
* `VitestProject.e2e()` -- timeout defaults (`testTimeout: 120_000`,
  `hookTimeout: 60_000`), CPU-based `maxConcurrency`, override of
  individual timeout fields
* `VitestProject.custom()` -- no preset defaults, custom kind
  stored, no default environment
* `VitestConfig.create()` -- callback receives correct shape
  (`projects`, `coverage`, `reporters`, `isCI`), default thresholds
  (80 for all metrics), custom thresholds, partial thresholds fill
  missing with 80
* Reporter defaults -- `["default"]` normally,
  `["default", "github-actions"]` when `GITHUB_ACTIONS` env is set

**Test infrastructure:**

* `workspace-tools` is mocked (`vi.mock`) to avoid filesystem
  dependency in unit tests
* Static cache is reset via `afterEach` by casting to
  `Record<string, unknown>` and nulling cache properties

---

## Future Enhancements

### Phase 1: Short-term

* Support configurable test directory names beyond `__test__/`
* Support configurable source directory name beyond `src/`
* Add validation/warning when `--project` name does not match any
  discovered project

### Phase 2: Medium-term

* Support for multiple test environments per package (e.g., `jsdom`
  for browser-targeted packages)
* Watch mode optimization: invalidate cache when
  `pnpm-workspace.yaml` or `package.json` files change
* Allow consumers to provide custom filename classification rules

### Phase 3: Long-term

* Plugin system for custom discovery strategies (e.g.,
  directory-based classification, config-file-based)
* Support for non-pnpm workspace managers (npm, yarn, bun)

---

## Related Documentation

**Package Documentation:**

* `README.md` -- Package overview
* `CLAUDE.md` -- Development guide

---

**Document Status:** Current. Reflects the implementation as of
2026-02-17 at 75% completeness. The remaining 25% covers areas not
yet fully documented: edge-case behavior for malformed
`package.json` files, detailed interaction with Vitest's internal
project resolution, and workspace-tools fallback paths.
