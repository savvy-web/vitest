---
status: current
module: vitest
category: architecture
created: 2026-02-16
updated: 2026-03-29
last-synced: 2026-03-29
completeness: 90
related: []
dependencies: []
implementation-plans: ["mossy-baking-matsumoto"]
---

# Workspace Discovery Architecture

Utility classes for automatic Vitest project configuration discovery
in pnpm monorepo workspaces, with three-kind test classification
(unit, e2e, integration), named coverage level presets, declarative
options API, and agent reporter integration.

## Table of Contents

1. [Overview](#overview)
2. [Current State](#current-state)
3. [Rationale](#rationale)
4. [System Architecture](#system-architecture)
5. [Data Flow](#data-flow)
6. [Integration Points](#integration-points)
7. [Companion Plugin](#companion-plugin)
8. [Testing Strategy](#testing-strategy)
9. [Future Enhancements](#future-enhancements)
10. [Related Documentation](#related-documentation)

---

## Overview

The workspace discovery system eliminates per-package Vitest
configuration in monorepos. A single call to `VitestConfig.create()`
scans every workspace package that contains a `src/` directory,
classifies test files into three kinds (unit, e2e, integration) by
filename convention, and produces `VitestProject` instances with
sensible defaults for each kind. Coverage is configured declaratively
via named level presets or explicit thresholds, and the
`vitest-agent-reporter` plugin is injected by default.

Results are cached in static properties (`cachedProjects` and
`cachedVitestProjects`) so that repeated config evaluations during
watch mode or HMR do not re-scan the filesystem.

**Key Design Principles:**

* Zero-configuration for workspace consumers: adding a package with
  `src/` is enough for it to be discovered
* Declarative options-first API with escape hatches for advanced use
* Caching for performance across config reloads within a single
  process
* Support for both full-workspace and multi-project test runs via
  `--project` flag (multiple flags supported)
* Convention-over-configuration test classification by filename
  pattern across three kinds
* Agent reporter integration enabled by default for CI-aware output

**When to reference this document:**

* When modifying the workspace discovery logic
* When adding support for new workspace layouts or test directory
  conventions
* When changing coverage configuration generation or level presets
* When debugging project filtering via `--project` flag
* When modifying the agent reporter integration
* When adding new test kinds or mutation methods to VitestProject

---

## Current State

### System Components

#### Component 1: VitestProject (Class)

**Location:** `package/src/index.ts`

**Purpose:** Encapsulates a single Vitest project with preset
defaults per test kind. Uses a private constructor; instances are
created through static factory methods. Supports post-creation
mutation via chainable methods.

**Responsibilities:**

* Store project name, kind, and merged configuration
* Provide `toConfig()` for Vitest-native
  `TestProjectInlineConfiguration`
* Apply kind-specific defaults (timeouts, concurrency, environment)
* Merge overrides with a defined precedence order
* Support post-creation mutation via `override()`, `addInclude()`,
  `addExclude()`, and `addCoverageExclude()`
* Track per-project coverage exclusion patterns via
  `coverageExcludes` getter

**Key interfaces/APIs:**

```typescript
export type VitestProjectKind = "unit" | "e2e" | "int" | (string & {});

export interface VitestProjectOptions {
  name: string;
  include: string[];
  kind?: VitestProjectKind;
  overrides?: Partial<TestProjectInlineConfiguration>;
}

export class VitestProject {
  static unit(options: VitestProjectOptions): VitestProject;
  static e2e(options: VitestProjectOptions): VitestProject;
  static int(options: VitestProjectOptions): VitestProject;
  static custom(
    kind: VitestProjectKind,
    options: VitestProjectOptions,
  ): VitestProject;

  get name(): string;
  get kind(): VitestProjectKind;
  get coverageExcludes(): readonly string[];
  toConfig(): TestProjectInlineConfiguration;

  // Chainable mutation methods (return `this`)
  override(config: Partial<TestProjectInlineConfiguration>): this;
  addInclude(...patterns: string[]): this;
  addExclude(...patterns: string[]): this;
  addCoverageExclude(...patterns: string[]): this;
}
```

**Factory defaults:**

| Factory | `extends` | `environment` | `testTimeout` | `hookTimeout` | `maxConcurrency` |
| --- | --- | --- | --- | --- | --- |
| `unit()` | `true` | `"node"` | (vitest dflt) | (vitest dflt) | (vitest dflt) |
| `e2e()` | `true` | `"node"` | `120_000` | `60_000` | `clamp(floor(cpus/2), 1, 8)` |
| `int()` | `true` | `"node"` | `60_000` | `30_000` | `clamp(floor(cpus/2), 1, 8)` |
| `custom()` | `true` | (none) | (none) | (none) | (none) |

**Override merge precedence (highest wins):**

1. `name` and `include` from options (always win)
2. `overrides.test` fields
3. Factory defaults for `test`
4. Top-level: `overrides` rest spreads over factory defaults rest

**Mutation methods:**

* `override(config)` -- merges additional config over current;
  preserves `name` and `include`
* `addInclude(...patterns)` -- appends patterns to the test include
  list
* `addExclude(...patterns)` -- appends patterns to the test exclude
  list
* `addCoverageExclude(...patterns)` -- appends patterns to the
  per-project coverage exclusion list (exposed via `coverageExcludes`
  getter for workspace-level coverage config to consume)

#### Component 2: VitestConfig (Static Class)

**Location:** `package/src/index.ts`

**Purpose:** Entry point that orchestrates workspace discovery,
coverage configuration, reporter selection, agent plugin injection,
and per-kind override application.

**Responsibilities:**

* Parse `--project` flags from `process.argv` (multiple supported)
* Discover workspace packages via `workspace-tools`
* Check for `src/` and `__test__/` directories via the
  `isDirectory()` helper
* Scan directories for test files and classify as unit, e2e, or int
* Detect setup files (`vitest.setup.{ts,tsx,js,jsx}`) at package
  roots
* Exclude fixture/utils directories under `__test__/` from discovery
* Build include glob arrays via the `buildIncludes()` helper
* Generate `VitestProject` instances with appropriate names and
  include globs
* Resolve coverage thresholds from named levels or explicit objects
* Apply per-kind overrides (object or callback form)
* Detect `GITHUB_ACTIONS` env for CI reporters
* Inject `AgentPlugin` from `vitest-agent-reporter` by default
* Assemble final `ViteUserConfig` with optional post-process callback
* Cache results across repeated calls

**Key interfaces/APIs:**

```typescript
export interface VitestConfigOptions {
  coverage?: CoverageLevelName | CoverageThresholds;
  coverageExclude?: string[];
  agentReporter?: boolean | AgentReporterConfig;
  pool?: "threads" | "forks" | "vmThreads" | "vmForks";
  unit?: KindOverride;
  e2e?: KindOverride;
  int?: KindOverride;
}

export type PostProcessCallback = (
  config: ViteUserConfig,
) => ViteUserConfig | undefined;

export interface AgentReporterConfig {
  consoleStrategy?: "own" | "complement";
  coverageConsoleLimit?: number;
  omitPassingTests?: boolean;
  includeBareZero?: boolean;
}

export type KindOverride =
  | Partial<TestProjectInlineConfiguration["test"]>
  | ((projects: Map<string, VitestProject>) => void);

export interface CoverageThresholds {
  lines: number;
  functions: number;
  branches: number;
  statements: number;
}

export type CoverageLevelName =
  "none" | "basic" | "standard" | "strict" | "full";
```

**Static public constants:**

* `static readonly COVERAGE_LEVELS` -- frozen record mapping
  `CoverageLevelName` to `CoverageThresholds`:

| Level | lines | branches | functions | statements |
| --- | --- | --- | --- | --- |
| none | 0 | 0 | 0 | 0 |
| basic | 50 | 50 | 50 | 50 |
| standard | 70 | 65 | 70 | 70 |
| strict | 80 | 75 | 80 | 80 |
| full | 90 | 85 | 90 | 90 |

**Static private constants:**

* `DEFAULT_COVERAGE_EXCLUDE` -- default glob patterns excluded from
  coverage:
  * `**/*.{test,spec}.{ts,tsx,js,jsx}`
  * `**/__test__/**`
  * `**/generated/**`
* `SETUP_FILE_EXTENSIONS` -- `["ts", "tsx", "js", "jsx"]` for setup
  file detection
* `TEST_DIR_EXCLUSIONS` -- conventional subdirectories under
  `__test__/` that hold helpers (fixtures, utils) at top level and
  under `unit/`, `e2e/`, `integration/` subdirectories

**Private methods:**

* `getSpecificProjects()` -- parses all `--project=value` or
  `--project value` flags from `process.argv`; returns `string[]`
* `getPackageNameFromPath(path)` -- reads `package.json` name
  field; returns `null` via `?? null` when the name property is
  absent or the file is unreadable
* `isDirectory(dirPath)` -- checks whether a path is an existing
  directory using `statSync`; consolidates the repeated
  try/catch + `isDirectory()` pattern
* `detectSetupFile(packagePath)` -- probes for
  `vitest.setup.{ts,tsx,js,jsx}` at the package root; first match
  wins; returns the filename or `null`
* `buildIncludes(srcGlob, testGlob, pattern)` -- builds an array
  of include glob patterns from a `src/` glob and an optional
  `__test__/` glob
* `buildTestDirExclusions(prefix)` -- returns exclusion patterns for
  fixture/utils directories under `__test__/`, scoped to the given
  package prefix
* `scanForTestFiles(dirPath)` -- recursive scan returning
  `{ hasUnit, hasE2e, hasInt }` based on filename patterns;
  short-circuits when all three kinds are found
* `discoverWorkspaceProjects()` -- iterates workspace packages,
  normalizes empty relative paths to `"."` for root-package
  workspaces, computes a `prefix` that avoids leading-slash
  globs, uses `isDirectory()` to check for `src/` and
  `__test__/`, detects setup files, builds exclusions, creates
  projects with appropriate suffixes
* `resolveThresholds(options)` -- resolves coverage thresholds from
  `options.coverage` (level name or explicit object); defaults to
  `COVERAGE_LEVELS.strict`
* `getCoverageConfig(specificProjects, projects, options)` -- strips
  `:unit`/`:e2e`/`:int` suffix for `--project` lookup, unions
  include patterns for all matched packages, applies thresholds and
  coverage excludes
* `applyKindOverrides(vitestProjects, options)` -- applies per-kind
  overrides (object merged into all projects of that kind, or
  callback receiving a Map for fine-grained mutation)

**Re-exports:**

* `TestProjectInlineConfiguration` from `vitest/config` is
  re-exported (`export type`) for consumer portability, so
  downstream packages do not need a direct `vitest` dependency
  to type their overrides

**Dependencies:**

* `workspace-tools` -- `getWorkspaceManagerRoot`,
  `getWorkspacePackagePaths`
* `vitest-agent-reporter` -- `AgentPlugin` (required peer
  dependency)
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
+--------+-----------------------------+
| VitestConfig.create(options?, post?) |
+--------+-----------------------------+
         |
    +----+----+----------+---------+
    |         |          |         |
    v         v          v         v
+---+---+ +---+--------+ +-----+ +--------+
| parse | | discover   | |build| |resolve |
|--proj | | workspace  | |repo-| |thresh- |
| argv  | | projects   | |rters| |olds    |
|(multi)| | (3-kind)   | |(CI?)| |(levels)|
+---+---+ +---+--------+ +--+--+ +---+----+
    |         |              |        |
    |    +----+----+----+    |        |
    |    |    |    |    |    |        |
    |    v    v    v    v    |        |
    | +--+--+ +--+--+ +-+  |        |
    | |scan | |scan | |det| |        |
    | |src/ | |test/| |ect| |        |
    | |dir  | |dir  | |set| |        |
    | +--+--+ +--+--+ |up | |        |
    |    |       |     +-+-+ |        |
    |    +---+---+       |   |        |
    |        |           |   |        |
    |        v           |   |        |
    | +------+--------+  |   |        |
    | |classify: unit  |  |  |        |
    | |e2e, int by     |  |  |        |
    | |filename pattern|  |  |        |
    | +------+--------+  |   |        |
    |        |           |   |        |
    |        v           |   |        |
    | +------+-----+     |   |        |
    | |VitestProject|    |   |        |
    | |.unit()      |    |   |        |
    | |.e2e()       |    |   |        |
    | |.int()       |    |   |        |
    | +------+-----+     |   |        |
    |        |           |   |        |
    +--------+---+-------+   |        |
             |               |        |
             v               |        |
    +--------+---------+     |        |
    |applyKindOverrides|     |        |
    |(object or cb)    |     |        |
    +--------+---------+     |        |
             |               |        |
    +--------+---+-----------+--------+
             |
             v
    +--------+---------+
    |getCoverageConfig |
    |  (named levels)  |
    +--------+---------+
             |
             v
    +--------+--------+
    |inject AgentPlugin|
    |(unless disabled) |
    +--------+---------+
             |
             v
    +--------+----------+
    | postProcess(config)|
    | (if provided)      |
    +--------+-----------+
             |
             v
        ViteUserConfig
```

### Current Limitations

* Requires a `src/` directory in each package; packages without
  `src/` are silently skipped
* Only scans `src/` and `__test__/` for test files; other
  directories (e.g., `tests/`, `test/`) are ignored
* Hardcodes `"node"` as the default environment for `unit()`,
  `e2e()`, and `int()` factories
* Test file classification relies solely on filename patterns;
  directory-based classification is not supported
* Packages with no existing test files still get a unit project
  entry (forward-looking, but adds noise)
* `vitest-agent-reporter` is a required peer dependency even when
  `agentReporter: false` is used

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

#### Decision 2: Declarative Options API

**Context:** `VitestConfig.create()` was originally callback-based.
The new API uses a declarative options object as the primary
interface, with an optional post-process callback as an escape
hatch.

**Options considered:**

1. **Declarative options + post-process escape hatch (Chosen):**
   * Pros: zero-config default (`VitestConfig.create()`); named
     coverage levels reduce boilerplate; per-kind overrides
     (object or callback) handle most customization; post-process
     callback provides full control when needed
   * Cons: slightly more opinionated about config shape
   * Why chosen: the vast majority of consumers need the same
     structure; the escape hatch preserves full flexibility

2. **Callback pattern (Previous design, replaced):**
   * Pros: consumer controls final config shape entirely
   * Cons: every consumer must assemble the same boilerplate;
     coverage provider/enabled always needed; no zero-config path
   * Why replaced: too much ceremony for the common case

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

#### Decision 4: VitestProject Class with Factories and Mutation

**Context:** A class that encapsulates merge logic and exposes
kind-specific factories with post-creation mutation methods rather
than exposing raw configuration objects.

**Options considered:**

1. **Factory class with mutation (Chosen):**
   * Pros: encapsulates merge precedence; enforces `name`/`include`
     immutability; kind-specific defaults in one place; extensible
     via `custom()` for arbitrary test kinds; chainable mutation
     methods enable per-project customization in kind override
     callbacks
   * Cons: more complex than a plain interface
   * Why chosen: merge logic was error-prone when scattered;
     factories (`unit`, `e2e`, `int`, `custom`) make intent
     explicit; mutation methods enable the callback form of
     `KindOverride`

#### Decision 5: Named Coverage Levels

**Context:** Coverage thresholds were previously a single default
constant (`DEFAULT_THRESHOLD = 80`). The new API provides named
presets.

**Options considered:**

1. **Named level presets (Chosen):**
   * Pros: self-documenting (`"strict"`, `"standard"`, `"full"`);
     gradual adoption path; frozen object prevents mutation;
     explicit per-metric values avoid ambiguity
   * Cons: another concept to learn
   * Why chosen: eliminates magic numbers; makes coverage intent
     clear in config files; `"strict"` as default preserves
     backward compatibility with the old 80% threshold

2. **Numeric threshold only:**
   * Pros: simpler
   * Cons: branches typically need lower thresholds than other
     metrics; single number is misleading
   * Why rejected: per-metric thresholds are more accurate

#### Decision 6: Agent Reporter Integration by Default

**Context:** `vitest-agent-reporter` provides CI-aware test
output. The decision was to inject it by default rather than
requiring explicit opt-in.

**Options considered:**

1. **Default-on with opt-out (Chosen):**
   * Pros: works out of the box for agent/CI consumers; coverage
     threshold automatically derived from resolved thresholds;
     `agentReporter: false` provides simple opt-out
   * Cons: adds a required peer dependency
   * Why chosen: the package targets AI agent and CI workflows
     where the reporter is almost always wanted

### Design Patterns Used

#### Pattern 1: Lazy Initialization with Caching

* **Where used:** `discoverWorkspaceProjects()`
* **Why used:** filesystem scanning is expensive; the result is
  stable within a single process
* **Implementation:** checks `cachedProjects` and
  `cachedVitestProjects` at the top of the method; returns
  immediately if non-null; otherwise scans and stores

#### Pattern 2: Factory Method

* **Where used:** `VitestProject.unit()`, `.e2e()`, `.int()`,
  `.custom()`
* **Why used:** each test kind requires different defaults; private
  constructor prevents invalid construction
* **Implementation:** each factory passes kind-specific defaults to
  the private constructor which handles the merge

#### Pattern 3: Builder Pattern (Chainable Mutation)

* **Where used:** `VitestProject.override()`, `.addInclude()`,
  `.addExclude()`, `.addCoverageExclude()`
* **Why used:** enables fluent per-project customization within
  kind override callbacks
* **Implementation:** each method mutates internal state and returns
  `this`; `name` and `include` are preserved across `override()`
  calls

#### Pattern 4: Strategy Pattern (Kind Overrides)

* **Where used:** `VitestConfigOptions.unit`, `.e2e`, `.int`
  (type `KindOverride`)
* **Why used:** two distinct customization strategies (blanket
  object merge vs. fine-grained callback) under a single option
* **Implementation:** `applyKindOverrides()` dispatches on
  `typeof override === "function"` to either invoke the callback
  with a Map or merge the object into all projects of that kind

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
* **Impact:** consumers must follow the naming conventions:
  `*.e2e.test.ts` for e2e, `*.int.test.ts` for integration,
  `*.test.ts` (catch-all) for unit
* **Mitigation:** convention is documented; the `custom()` factory
  and `KindOverride` callbacks allow escape-hatch for non-standard
  setups

#### Constraint 3: Required Agent Reporter Peer Dependency

* **Description:** `vitest-agent-reporter` is imported
  unconditionally at the module level
* **Impact:** consumers must install `vitest-agent-reporter` even
  when using `agentReporter: false`
* **Mitigation:** the reporter is the primary use case for this
  package; the dependency is lightweight

---

## System Architecture

### Component Interactions

#### Interaction 1: Zero-Config Test Run

**Participants:** VitestConfig, workspace-tools, filesystem,
AgentPlugin

**Flow:**

1. Consumer calls `VitestConfig.create()` (no arguments)
2. `getSpecificProjects()` parses argv, returns `[]`
3. `discoverWorkspaceProjects()` scans workspace:
   * Gets workspace root and package paths
   * For each package with `src/`, reads `package.json` name
   * Detects `vitest.setup.{ts,tsx,js,jsx}` at package root
   * Scans `src/` and `__test__/` (if exists) recursively
   * Classifies files: `*.e2e.{test,spec}.{ts,tsx,js,jsx}` as e2e,
     `*.int.{test,spec}.{ts,tsx,js,jsx}` as int, others as unit
   * Excludes `__test__/(fixtures|utils)/` and kind-scoped
     equivalents from discovery
   * Creates `VitestProject.unit()`, `.e2e()`, and/or `.int()`
     instances
   * Adds `:unit`/`:e2e`/`:int` name suffixes when 2+ kinds exist
   * Attaches setup files to all projects of that package
4. `resolveThresholds()` returns `COVERAGE_LEVELS.strict` (default)
5. No kind overrides to apply (no options)
6. `getCoverageConfig()` generates include patterns for all
   projects with `strict` thresholds and default excludes
7. Reporters are set: `["default"]` normally,
   `["default", "github-actions"]` when `GITHUB_ACTIONS` is set
8. Config is assembled with `coverage.provider: "v8"`,
   `coverage.enabled: true`
9. `AgentPlugin` is injected with `consoleStrategy: "own"` and
   `coverageThreshold` set to `Math.min()` of all resolved metrics
10. Returned `Promise<ViteUserConfig>` resolves to final config

#### Interaction 2: Multi-Project Test Run with Scoped Coverage

**Participants:** VitestConfig, process.argv

**Flow:**

1. Consumer calls `VitestConfig.create()`
2. `getSpecificProjects()` collects all `--project` values from
   argv (supports multiple `--project` flags)
3. `discoverWorkspaceProjects()` scans workspace (or uses cache)
4. `getCoverageConfig()` strips `:unit`/`:e2e`/`:int` suffix from
   each project name, looks up the base package in the project
   mapping, and unions include patterns for all matched packages
5. Config is assembled with coverage scoped to matched packages

#### Interaction 3: Declarative Options with Per-Kind Overrides

**Participants:** VitestConfig, VitestProject, consumer options

**Flow:**

1. Consumer calls `VitestConfig.create({ unit: { environment: "jsdom" } })`
2. Discovery and coverage proceed as normal
3. `applyKindOverrides()` processes `options.unit`:
   * Object form: merges `{ environment: "jsdom" }` into every
     unit project via `project.override({ test: override })`
   * Callback form: invokes callback with
     `Map<string, VitestProject>` for fine-grained mutation
4. Config is assembled with mutated projects

**Consumer examples:**

```typescript
import { VitestConfig } from "@savvy-web/vitest";

// Zero config (strict coverage, agent reporter on)
export default VitestConfig.create();

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

// Escape hatch with post-process callback
export default VitestConfig.create(
  { coverage: "standard" },
  (config) => { config.resolve = { alias: { "@": "/src" } }; },
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

// Scan result per directory (three-kind detection)
interface ScanResult {
  hasUnit: boolean;
  hasE2e: boolean;
  hasInt: boolean;
}

// Coverage config (internal, not exported)
interface CoverageConfig {
  include: string[];   // e.g., ["pkgs/vitest/src/**/*.ts"]
  exclude: string[];   // default + user-provided excludes
  thresholds: CoverageThresholds;
}

// Resolved coverage thresholds (exported)
interface CoverageThresholds {
  lines: number;
  functions: number;
  branches: number;
  statements: number;
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
      |     [detectSetupFile(pkgPath)]
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
      |     [classify: hasUnit / hasE2e / hasInt]
      |          |
      |     +----+----+----+----+
      |     |    |    |    |    |
      |     v    v    v    v    v
      |   3+?  2kind  unit  e2e  int
      |   kinds only  only  only only
      |     |    |    |     |    |
      |     v    v    v     v    v
      | suffix when 2+ kinds exist
      |     |
      |     v
      | buildIncludes() -> glob patterns
      | buildTestDirExclusions() -> exclude patterns
      |     |
      |     v
      | VitestProject.unit() + .e2e() + .int()
      |   (with setupFiles and excludes)
      |   or fallback unit (no tests found)
      |
      v
[Cache: cachedProjects + cachedVitestProjects]
      |
      v
[applyKindOverrides: object merge or callback]
      |
      v
[getCoverageConfig: apply --project filter +
 resolveThresholds (level name or object)]
      |
      v
[Assemble ViteUserConfig with AgentPlugin]
      |
      v
[postProcess callback (if provided)]
      |
      v
[Promise<ViteUserConfig>]
```

### Filename Classification Rules

Scan patterns are checked in order. The first match wins:

| Pattern | Kind | Example |
| --- | --- | --- |
| `*.e2e.test.{ts,tsx,js,jsx}` | e2e | `auth.e2e.test.ts` |
| `*.e2e.spec.{ts,tsx,js,jsx}` | e2e | `auth.e2e.spec.tsx` |
| `*.int.test.{ts,tsx,js,jsx}` | int | `db.int.test.ts` |
| `*.int.spec.{ts,tsx,js,jsx}` | int | `db.int.spec.ts` |
| `*.test.{ts,tsx,js,jsx}` (catch-all) | unit | `parser.test.ts` |
| `*.spec.{ts,tsx,js,jsx}` (catch-all) | unit | `parser.spec.jsx` |
| `*.unit.test.{ts,tsx,js,jsx}` | unit | `parser.unit.test.ts` |

The unit pattern is a catch-all that includes the `.unit.` signifier
convention.

### Fixture/Utils Exclusion

The following paths under `__test__/` are excluded from test
discovery when they are direct children:

* `__test__/fixtures/**`
* `__test__/utils/**`
* `__test__/unit/fixtures/**`
* `__test__/unit/utils/**`
* `__test__/e2e/fixtures/**`
* `__test__/e2e/utils/**`
* `__test__/integration/fixtures/**`
* `__test__/integration/utils/**`

### Setup File Detection

Auto-detects `vitest.setup.{ts,tsx,js,jsx}` at each package root.
Extensions are probed in order: `ts`, `tsx`, `js`, `jsx`. First
match wins. The detected file is added to `setupFiles` for all
projects of that package.

---

## Integration Points

### Internal Integrations

#### Integration 1: workspace-tools

**How it integrates:** Uses `getWorkspaceManagerRoot(cwd)` to find
the workspace root, then `getWorkspacePackagePaths(root)` to get
absolute paths to all workspace packages.

**Data exchange:** Returns array of absolute paths. Falls back to
`cwd` if no root found, and empty array if no paths found.

#### Integration 2: vitest-agent-reporter

**How it integrates:** `AgentPlugin` is imported from
`vitest-agent-reporter` and injected into `config.plugins` by
default. The plugin is configured with:

* `consoleStrategy: "own"` (default, configurable via
  `AgentReporterConfig`)
* `coverageThreshold` set to `Math.min()` of all four resolved
  threshold metrics
* Additional reporter options passed through from
  `AgentReporterConfig`

**Data exchange:** Plugin is a Vite plugin object added to the
plugins array. Disable with `agentReporter: false`.

**Dependency:** `vitest-agent-reporter` is a required peer
dependency (minimum Vitest 4.1.0).

#### Integration 3: Vitest Configuration

**How it integrates:** `VitestConfig.create()` returns a
`Promise<ViteUserConfig>` compatible with Vitest's `defineConfig()`.
Projects are passed as `VitestProject` instances internally;
`toConfig()` is called to produce `TestProjectInlineConfiguration`
objects in the final config. Coverage is always enabled with
`provider: "v8"`.

#### Integration 4: CI Environment Detection

**How it integrates:** Reads `process.env.GITHUB_ACTIONS` to
determine if running in CI. When truthy, adds `"github-actions"` to
the reporters array.

### External Integrations

#### Integration 1: Consumer vitest.config.ts

**Purpose:** Consumed by monorepo projects to auto-generate
multi-project Vitest configuration with coverage, reporters, and
agent plugin.

**Protocol:** TypeScript import + async call. The consumer exports
the returned promise directly.

---

## Companion Plugin

### Overview

The repository includes a Claude Code companion plugin at `plugin/`
that provides AI coding agents with test convention context and
configuration reference. The plugin is distributed as a separate
artifact from the npm package and is installed via Claude Code's
plugin system.

### Repository Structure

The repo uses a sidecar pattern with two pnpm workspace members:

```text
vitest/                        (workspace root)
  pnpm-workspace.yaml          packages: [".", "package"]
  package.json                  workspace root (not publishable)
  vitest.config.ts              workspace-level test config
  turbo.json                    workspace-level Turbo config
  package/                      publishable npm package
    package.json                @savvy-web/vitest
    src/index.ts                VitestConfig + VitestProject source
    rslib.config.ts             dual-output build config
    types/                      type declarations
    dist/                       build output (dev + npm)
  plugin/                       Claude Code companion plugin
    .claude-plugin/
      plugin.json               plugin manifest
    hooks/
      hooks.json                hook configuration
      session-start.sh          SessionStart hook
    skills/
      config/
        SKILL.md                vitest:config skill
```

The workspace root (`.`) owns the development tooling (Vitest,
Biome, Turbo, Husky, Commitlint). The `package/` directory
contains the publishable npm package source, build config, and
output. The `plugin/` directory is not a workspace member; it is
a standalone Claude Code plugin.

### Plugin Components

#### SessionStart Hook

**Location:** `plugin/hooks/session-start.sh`

**Purpose:** Injects test convention context at the start of every
Claude Code session in projects that install this plugin.

**Behavior:**

1. Parses `pnpm-workspace.yaml` to find workspace package
   directories
2. Scans each package for test files in `src/` and `__test__/`
3. Classifies packages by test pattern (dedicated `__test__/`,
   co-located in `src/`, or mixed)
4. Outputs static context explaining VitestConfig auto-discovery,
   the `__test__/` directory layout, test classification rules
   (e2e/int/unit by filename), and setup file detection
5. Outputs dynamic context with detected test pattern statistics
   and migration guidance for co-located tests
6. Documents the agent reporter integration

**Integration with VitestConfig:** The hook describes the same test
classification rules and directory conventions that
`VitestConfig.create()` uses for auto-discovery. This ensures AI
agents understand the conventions without needing to read the source.

#### Config Skill (vitest:config)

**Location:** `plugin/skills/config/SKILL.md`

**Purpose:** Provides the full VitestConfig/VitestProject API
reference as a loadable skill. Agents invoke `/vitest:config` when
modifying `vitest.config.ts` to get coverage level presets,
`KindOverride` patterns, mutation methods, and common recipes.

**Content:** Mirrors the API surface documented in this design doc
(VitestConfigOptions, VitestProject factories, CoverageLevelName,
AgentReporterConfig) in a concise reference format optimized for
agent consumption.

---

## Testing Strategy

### Unit Tests

**Location:** `package/src/index.test.ts`

**Coverage:** 63 tests, 96.8% statement coverage, 100% function
coverage.

**What is tested:**

* `VitestProject.unit()` -- default environment, override merging,
  top-level overrides, `name`/`include` always win over overrides
* `VitestProject.e2e()` -- timeout defaults (`testTimeout: 120_000`,
  `hookTimeout: 60_000`), CPU-based `maxConcurrency`, override of
  individual timeout fields
* `VitestProject.int()` -- timeout defaults (`testTimeout: 60_000`,
  `hookTimeout: 30_000`), CPU-based `maxConcurrency`
* `VitestProject.custom()` -- no preset defaults, custom kind
  stored, no default environment
* `VitestProject` mutation methods -- `override()` preserves
  `name`/`include`, `addInclude()`, `addExclude()`,
  `addCoverageExclude()` chainability and accumulation
* `VitestConfig.create()` -- zero-config call, declarative options,
  coverage level presets, explicit thresholds, per-kind overrides
  (object and callback), post-process callback, pool option
* `VitestConfig.COVERAGE_LEVELS` -- all five levels, frozen object
* Coverage configuration -- default excludes, additive
  `coverageExclude`, `--project` scoping (single and multiple)
* Agent reporter -- default injection, custom config,
  `agentReporter: false` opt-out, `coverageThreshold` derivation
* Reporter defaults -- `["default"]` normally,
  `["default", "github-actions"]` when `GITHUB_ACTIONS` env is set
* Three-kind detection -- unit, e2e, int classification, suffix
  triggers (2+ kinds)
* Setup file detection -- `vitest.setup.{ts,tsx,js,jsx}` probing
* Fixture/utils exclusion -- conventional subdirectories excluded

**Test infrastructure:**

* `workspace-tools` is mocked (`vi.mock`) to avoid filesystem
  dependency in unit tests
* `node:fs` is mocked for filesystem operations
* `vitest-agent-reporter` is mocked to verify plugin injection
* Static cache is reset via `afterEach` by casting to
  `Record<string, unknown>` and nulling cache properties

---

## Future Enhancements

### Phase 1: Short-term

* Support configurable test directory names beyond `__test__/`
* Support configurable source directory name beyond `src/`
* Add validation/warning when `--project` name does not match any
  discovered project
* Dynamic import of `vitest-agent-reporter` to make the peer
  dependency optional when `agentReporter: false`

### Phase 2: Medium-term

* Watch mode optimization: invalidate cache when
  `pnpm-workspace.yaml` or `package.json` files change
* Allow consumers to provide custom filename classification rules
* Per-project coverage threshold overrides via `VitestProject`
  mutation

### Phase 3: Long-term

* Plugin system for custom discovery strategies (e.g.,
  directory-based classification, config-file-based)
* Support for non-pnpm workspace managers (npm, yarn, bun)

---

## Related Documentation

**Package Documentation:**

* `package/README.md` -- Package overview
* `CLAUDE.md` -- Development guide

**Plugin Documentation:**

* `plugin/README.md` -- Plugin overview
* `plugin/skills/config/SKILL.md` -- VitestConfig API reference skill

---

**Document Status:** Current. Reflects the implementation as of
2026-03-29 at 90% completeness. The remaining 10% covers areas not
yet fully documented: edge-case behavior for malformed
`package.json` files, detailed interaction with Vitest's internal
project resolution, workspace-tools fallback paths, and the complete
`vitest-agent-reporter` plugin options surface.
