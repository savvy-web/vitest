# Vitest Companion Plugin Design

Companion Claude Code plugin for `@savvy-web/vitest` that provides
session context and configuration reference for AI coding agents.

## Problem

Agents working in repos that use `@savvy-web/vitest` encounter two
recurring issues:

1. The `vitest.config.ts` is a two-line file calling
   `VitestConfig.create()`. Agents don't understand the auto-discovery
   behind it and attempt to manually configure test projects or add
   standard Vitest configuration.

2. Agents default to co-locating test files next to source files in
   `src/`. The prescribed pattern uses `__test__/` directories with
   structured subdirectories for e2e, integration, fixtures, and
   utilities.

Both issues require repeated manual correction. A companion plugin
eliminates this by injecting context at session start and providing a
skill for deeper configuration reference.

## Scope

This plugin covers **only** `@savvy-web/vitest` conventions and
configuration. The `vitest-agent-reporter` has its own separate plugin;
this plugin merely notes that the reporter is auto-injected and
encourages installing the reporter's companion plugin.

## Components

### 1. Session Start Hook

**File:** `plugin/hooks/session-start.sh`

Replaces the existing session-start hook. Outputs markdown context
covering five areas:

#### 1a. VitestConfig.create() Orientation

Explain that:

- The minimal `vitest.config.ts` is intentional
- `VitestConfig.create()` auto-discovers workspace packages with
  `src/` directories
- Test projects are generated automatically — don't manually define
  them
- The config supports options for coverage, pool, and per-kind
  overrides
- Point to `/vitest:config` skill for the full options API

#### 1b. Prescribed Directory Layout

Present the `__test__/` directory structure:

```text
package-root/
  src/              # source code
  __test__/         # dedicated test directory (preferred)
    utils/          # shared test helpers (excluded from discovery)
    fixtures/       # test fixtures (excluded from discovery)
    *.test.ts       # unit tests
    e2e/
      utils/        # excluded
      fixtures/     # excluded
      *.e2e.test.ts
    integration/
      utils/        # excluded
      fixtures/     # excluded
      *.int.test.ts
  vitest.setup.ts   # optional, auto-detected and added to setupFiles
```

State that `__test__/` is the preferred pattern. Tests in `src/` are
supported but `__test__/` provides better organization.

#### 1c. Test Classification Rules

Document the filename-based classification:

| Pattern | Kind | Check order |
| --- | --- | --- |
| `*.e2e.(test\|spec).(ts\|tsx\|js\|jsx)` | e2e | first |
| `*.int.(test\|spec).(ts\|tsx\|js\|jsx)` | int | second |
| `*.(test\|spec).(ts\|tsx\|js\|jsx)` | unit | catch-all |

Classification is filename-only — location is irrelevant. When a
package has 2+ test kinds, projects get suffixed (`@pkg:unit`,
`@pkg:e2e`, `@pkg:int`). Single-kind packages stay bare.

#### 1d. Detected Pattern (Dynamic)

The hook scans the repo to detect what pattern is actually in use:

**Detection logic:**

1. Find workspace packages that have `src/` directories (same
   discovery logic as `VitestConfig`)
2. For each package, check for:
   - `__test__/` directory existence
   - Test files (`*.test.*`, `*.spec.*`) directly inside `src/`
     (co-located)
3. Classify each package as: `__test__` only, co-located only, mixed,
   or no tests
4. Summarize counts

**Output examples:**

When all packages use `__test__/`:

```markdown
### Detected Pattern

All 4 packages with tests use `__test__/` directories. Follow this
pattern when adding tests.
```

When co-located tests exist:

```markdown
### Detected Pattern

- 3 packages use `__test__/` directories
- 1 package has co-located tests in `src/` (my-legacy-pkg)

**Migrate co-located tests to `__test__/`.** The `__test__/` pattern
is preferred for this project.
```

When no tests exist:

```markdown
### Detected Pattern

No test files detected yet. When adding tests, use the `__test__/`
directory pattern described above.
```

**Implementation notes:**

- Use `pnpm ls --json` or parse `pnpm-workspace.yaml` to find
  workspace packages, or scan for `package.json` files in workspace
  globs
- Use `find` to detect test files — keep it simple, scan only one
  level deep in `src/` for co-located files
- Short-circuit: if the repo has no `pnpm-workspace.yaml`, treat it
  as a single-package repo and scan the root

#### 1e. Agent Reporter Note

Brief note (2-3 lines):

- `vitest-agent-reporter` is injected by default via `AgentPlugin`
- It provides MCP tools for structured test data, coverage analysis,
  and test history
- Install its companion Claude Code plugin for full MCP tool context

### 2. Skill: `vitest:config`

**File:** `plugin/skills/config/SKILL.md`

Static reference content invoked via `/vitest:config`. Covers the full
API surface for modifying `vitest.config.ts`.

#### 2a. VitestConfigOptions API

Document each option with type, default, and description:

- `coverage` — `CoverageLevelName | CoverageThresholds`
  - Named levels: `none` (0/0/0/0), `basic` (50/50/50/50),
    `standard` (70/65/70/70), `strict` (80/75/80/80),
    `full` (90/85/90/90)
  - Format: lines/branches/functions/statements
  - Or explicit `{ lines, functions, branches, statements }` object
  - Default: `"none"`
- `coverageTargets` — same type as `coverage`
  - Thresholds forwarded to agent-reporter (informational, no
    failures)
  - Default: `"basic"`
- `coverageExclude` — `string[]`
  - Additional glob patterns excluded from coverage
- `agentReporter` — `boolean | AgentReporterConfig`
  - Controls `vitest-agent-reporter` plugin injection
  - Default: `true`
- `pool` — `"threads" | "forks" | "vmThreads" | "vmForks"`
  - Vitest pool mode. Use `"forks"` for Effect-TS
  - Default: Vitest default (threads)
- `unit` / `e2e` / `int` — `KindOverride`
  - Object form: merged into every project of that kind
  - Callback form: `(projects: Map<string, VitestProject>) => void`
    for per-project mutation

#### 2b. VitestProject API

**Factory methods:**

| Factory | environment | testTimeout | hookTimeout | maxConcurrency |
| --- | --- | --- | --- | --- |
| `unit()` | node | vitest default | vitest default | vitest default |
| `int()` | node | 60,000 | 30,000 | floor(cpus/2) clamped 1..8 |
| `e2e()` | node | 120,000 | 60,000 | floor(cpus/2) clamped 1..8 |
| `custom(kind)` | — | — | — | — |

**Mutation methods** (chainable, return `this`):

- `override(config)` — merge additional config; `name` and `include`
  are preserved
- `addInclude(...patterns)` — append to test include list
- `addExclude(...patterns)` — append to test exclude list
- `addCoverageExclude(...patterns)` — append to per-project coverage
  exclusions

#### 2c. Common Recipes

```typescript
// Basic: just coverage
VitestConfig.create({
  coverage: "standard",
});

// With coverage targets for agent reporter
VitestConfig.create({
  coverage: "standard",
  coverageTargets: "strict",
});

// Per-kind override (object form)
VitestConfig.create({
  e2e: { testTimeout: 300_000 },
});

// Per-kind override (callback form for fine-grained control)
VitestConfig.create({
  unit: (projects) => {
    const pkg = projects.get("@savvy-web/my-lib:unit");
    pkg?.addCoverageExclude("**/generated/**");
  },
});

// Pool override for Effect-TS
VitestConfig.create({
  pool: "forks",
});

// Post-process escape hatch
VitestConfig.create({}, (config) => {
  config.plugins ??= [];
  config.plugins.push(myPlugin());
  return config;
});
```

#### 2d. Anti-Patterns

- **Don't manually define test projects** — `VitestConfig.create()`
  handles discovery. Adding manual `projects` entries bypasses the
  conventions.
- **Don't create per-package vitest configs** — the workspace root
  config discovers all packages.
- **Don't bypass `VitestConfig.create()`** — writing raw Vitest config
  loses auto-discovery, coverage presets, and agent-reporter
  integration.
- **Don't hardcode include patterns** — the plugin generates includes
  from directory scanning. Use `addInclude()` via per-kind overrides
  if you need extras.

### 3. Cleanup

Remove files that belong to the agent-reporter plugin:

- `plugin/hooks/post-test-run.sh` — agent-reporter concern
- Update `hooks.json` to remove the `PostToolUse` entry

### 4. Plugin Metadata

Update `plugin.json`:

- `description` — "Companion plugin for @savvy-web/vitest that
  provides test convention context and configuration reference for
  AI coding agents"
- Remove MCP-related references from description

## Files Changed

| File | Action |
| --- | --- |
| `plugin/hooks/session-start.sh` | Rewrite |
| `plugin/hooks/hooks.json` | Update (remove PostToolUse) |
| `plugin/hooks/post-test-run.sh` | Delete |
| `plugin/skills/config/SKILL.md` | Create |
| `plugin/.claude-plugin/plugin.json` | Update description |

## Out of Scope

- `vitest-agent-reporter` MCP tools documentation (separate plugin)
- Automatic test migration tooling
- Hook for validating test file placement
