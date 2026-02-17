---
status: stub
module: vitest
category: architecture
created: 2026-02-16
updated: 2026-02-16
last-synced: never
completeness: 0
related: []
dependencies: []
---

# Workspace Discovery Architecture

Utility class for automatic Vitest project configuration discovery in pnpm
monorepo workspaces.

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

{Describe the workspace discovery system at a high level. Cover: what problem
it solves for monorepo consumers, how VitestConfig.create() provides a
single-call configuration entry point, and the caching strategy for repeated
invocations.}

**Key Design Principles:**

- {Principle 1: e.g., Zero-configuration for workspace consumers}
- {Principle 2: e.g., Caching for performance across config reloads}
- {Principle 3: e.g., Support for both full-workspace and single-project
  test runs}

**When to reference this document:**

- When modifying the workspace discovery logic
- When adding support for new workspace layouts or test directory conventions
- When changing coverage configuration generation
- When debugging project filtering via `--project` flag

---

## Current State

### System Components

#### Component 1: VitestConfig (Static Class)

**Location:** `src/index.ts`

**Purpose:** Entry point that orchestrates workspace discovery and
configuration generation.

**Responsibilities:**

- {Enumerate responsibilities: CLI arg parsing, workspace scanning,
  config generation, caching}

**Key interfaces/APIs:**

```typescript
export type VitestConfigCallback = (config: {
  projects: VitestProjectConfig[];
  coverage: { include: string[]; exclude: string[] };
}) => ViteUserConfig | Promise<ViteUserConfig>;

export interface VitestProjectConfig {
  extends: true;
  test: {
    name: string;
    include: string[];
    environment: string;
  };
}
```

**Dependencies:**

- `workspace-tools` for workspace package path discovery
- `node:fs` for filesystem checks (readFileSync, statSync)
- `node:path` for path manipulation (basename, join)

### Architecture Diagram

```text
+-------------------+
|  vitest.config.ts |  (consumer's config file)
+--------+----------+
         |
         v
+--------+----------+
| VitestConfig      |
| .create(callback) |
+--------+----------+
         |
    +----+----+
    |         |
    v         v
+---+---+ +---+--------+
| parse | | discover   |
| --project  workspace |
| CLI arg|  projects   |
+---+---+ +---+--------+
    |         |
    v         v
+---+---------+---+
| getCoverageConfig|
+--------+--------+
         |
         v
+--------+--------+
| callback(config)|
+--------+--------+
         |
         v
    ViteUserConfig
```

### Current Limitations

- {Limitation 1: e.g., Assumes `pkgs/` directory convention}
- {Limitation 2: e.g., Assumes `__test__/` directory for test discovery}
- {Limitation 3: e.g., Hardcoded `node` test environment}

---

## Rationale

### Architectural Decisions

#### Decision 1: Static Class Pattern

**Context:** {Why a static-only class was chosen over module-level functions
or a factory pattern}

**Options considered:**

1. **Static class (Chosen):**
   - Pros: {Benefits}
   - Cons: {Drawbacks}
   - Why chosen: {Reasoning}

2. **Module-level functions:**
   - Pros: {Benefits}
   - Cons: {Drawbacks}
   - Why rejected: {Reasoning}

#### Decision 2: Callback-Based API

**Context:** {Why VitestConfig.create() accepts a callback rather than
returning a config directly}

**Options considered:**

1. **Callback pattern (Chosen):**
   - Pros: {Benefits}
   - Cons: {Drawbacks}
   - Why chosen: {Reasoning}

2. **Direct return:**
   - Pros: {Benefits}
   - Cons: {Drawbacks}
   - Why rejected: {Reasoning}

#### Decision 3: In-Memory Caching

**Context:** {Why static properties are used for caching discovered projects}

### Design Patterns Used

#### Pattern 1: Lazy Initialization with Caching

- **Where used:** `discoverWorkspaceProjects()`
- **Why used:** {Reasoning}
- **Implementation:** {Brief description}

### Constraints and Trade-offs

#### Constraint 1: pnpm Workspace Layout

- **Description:** {What the constraint is}
- **Impact:** {How it affects the architecture}
- **Mitigation:** {How we work within the constraint}

---

## System Architecture

### Component Interactions

#### Interaction 1: Full Workspace Test Run

**Participants:** VitestConfig, workspace-tools, filesystem

**Flow:**

1. Consumer calls `VitestConfig.create(callback)`
2. `getSpecificProject()` parses argv, returns null
3. `discoverWorkspaceProjects()` scans workspace
4. `getCoverageConfig()` generates include patterns for all projects
5. `callback` receives projects + coverage config
6. Returned ViteUserConfig used by Vitest

#### Interaction 2: Single Project Test Run

**Participants:** VitestConfig, process.argv

**Flow:**

1. Consumer calls `VitestConfig.create(callback)`
2. `getSpecificProject()` finds `--project=@scope/pkg`
3. `discoverWorkspaceProjects()` scans workspace (or uses cache)
4. `getCoverageConfig()` generates include for single project folder
5. `callback` receives projects + scoped coverage

---

## Data Flow

### Data Model

```typescript
// Internal mapping: package name -> folder name
type ProjectMapping = Record<string, string>;

// Generated per-project config
interface VitestProjectConfig {
  extends: true;
  test: {
    name: string;       // e.g., "@savvy-web/tsconfig"
    include: string[];  // e.g., ["pkgs/tsconfig/__test__/**/*.test.ts"]
    environment: string; // "node"
  };
}
```

### Data Flow Diagram

```text
[pnpm workspace]
      |
      v
[workspace-tools.getWorkspacePackagePaths()]
      |
      v
[Filter: includes("/pkgs/")]
      |
      v
[For each: read package.json name, check __test__ dir]
      |
      v
[Build: ProjectMapping + VitestProjectConfig[]]
      |
      v
[Cache in static properties]
```

---

## Integration Points

### Internal Integrations

#### Integration 1: workspace-tools

**How it integrates:** Uses `getWorkspacePackagePaths(process.cwd())` to
discover all workspace package paths.

**Data exchange:** Returns array of absolute paths to workspace packages.

#### Integration 2: Vitest Configuration

**How it integrates:** Returns `ViteUserConfig` compatible with Vitest's
`defineConfig()` expectations via the callback pattern.

### External Integrations

#### Integration 1: Consumer vitest.config.ts

**Purpose:** Consumed by monorepo projects to auto-generate multi-project
Vitest configuration.

**Protocol:** TypeScript import + callback invocation.

---

## Testing Strategy

### Unit Tests

**Location:** `src/**/*.test.ts`

**Coverage target:** {Target percentage}

**What to test:**

- {Workspace discovery with various layouts}
- {CLI argument parsing for --project flag}
- {Coverage config generation (single vs all projects)}
- {Caching behavior}
- {Error handling for missing package.json or **test** directories}

---

## Future Enhancements

### Phase 1: Short-term

- {Enhancement 1: e.g., Support configurable test directory names}
- {Enhancement 2: e.g., Support configurable package directory path}

### Phase 2: Medium-term

- {Enhancement 3: e.g., Support for multiple test environments per package}
- {Enhancement 4: e.g., Watch mode optimization}

### Phase 3: Long-term

- {Enhancement 5: e.g., Plugin system for custom discovery strategies}

---

## Related Documentation

**Package Documentation:**

- `README.md` - Package overview
- `CLAUDE.md` - Development guide

---

**Document Status:** Stub with basic outline and template structure populated
from codebase analysis.

**Next Steps:** Fill in design principles, rationale for architectural
decisions, current limitations, and testing strategy details.
