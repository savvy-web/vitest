# Vitest Companion Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code companion plugin for `@savvy-web/vitest` that injects test convention context at session start and provides a config reference skill.

**Architecture:** A shell-based session-start hook detects workspace packages and their test patterns, then outputs markdown context about auto-discovery, directory conventions, and classification rules. A static SKILL.md file provides the full `VitestConfigOptions` and `VitestProject` API reference on demand.

**Tech Stack:** Bash (hooks), Markdown (skill), jq (JSON parsing)

**Spec:** `docs/superpowers/specs/2026-03-29-vitest-companion-plugin-design.md`

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `plugin/.claude-plugin/plugin.json` | Modify | Update description to reflect new scope |
| `plugin/hooks/hooks.json` | Modify | Remove PostToolUse entry, keep SessionStart |
| `plugin/hooks/session-start.sh` | Rewrite | Detect test patterns, output convention context |
| `plugin/hooks/post-test-run.sh` | Delete | Belongs to agent-reporter plugin |
| `plugin/skills/config/SKILL.md` | Create | Full VitestConfig/VitestProject API reference |

---

### Task 1: Clean Up Plugin Metadata and Hooks Config

**Files:**

- Modify: `plugin/.claude-plugin/plugin.json`
- Modify: `plugin/hooks/hooks.json`
- Delete: `plugin/hooks/post-test-run.sh`

- [ ] **Step 1: Update plugin.json description**

Replace the contents of `plugin/.claude-plugin/plugin.json` with:

```json
{
  "name": "vitest",
  "description": "Companion plugin for @savvy-web/vitest that provides test convention context and configuration reference for AI coding agents",
  "version": "1.0.0",
  "author": {
    "name": "C. Spencer Beggs",
    "email": "spencer@savvyweb.systems"
  },
  "homepage": "https://github.com/savvy-web/vitest/plugin#readme",
  "repository": "https://github.com/savvy-web/vitest.git",
  "license": "MIT"
}
```

- [ ] **Step 2: Remove PostToolUse from hooks.json**

Replace the contents of `plugin/hooks/hooks.json` with:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh\"",
            "timeout": 30,
            "statusMessage": "Loading @savvy-web/vitest context..."
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: Delete post-test-run.sh**

```bash
rm plugin/hooks/post-test-run.sh
```

- [ ] **Step 4: Commit**

```bash
git add plugin/.claude-plugin/plugin.json plugin/hooks/hooks.json
git rm plugin/hooks/post-test-run.sh
git commit -m "chore(plugin): clean up metadata and remove agent-reporter hook

Remove PostToolUse hook and post-test-run.sh — these belong to the
vitest-agent-reporter companion plugin, not this one. Update plugin
description to reflect the actual scope.

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 2: Write Session Start Hook

**Files:**

- Rewrite: `plugin/hooks/session-start.sh`

The hook has two parts: static context (conventions/rules) and dynamic detection (scan repo for patterns). The static context is output unconditionally. The dynamic detection scans workspace packages.

- [ ] **Step 1: Write the session-start.sh script**

Replace `plugin/hooks/session-start.sh` with:

```bash
#!/usr/bin/env bash
set -euo pipefail

# SessionStart hook: inject @savvy-web/vitest convention context.
#
# Outputs:
# 1. Static context about VitestConfig.create() and test conventions
# 2. Dynamic detection of test patterns in the current workspace

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# --- Detection Logic ---

# Find workspace packages by parsing pnpm-workspace.yaml globs.
# Falls back to treating PROJECT_DIR as a single-package repo.
find_workspace_packages() {
  if [ -f "$PROJECT_DIR/pnpm-workspace.yaml" ]; then
    # Extract package globs from pnpm-workspace.yaml
    # Handles both "- ." (root) and "- packages/*" style entries
    local globs
    globs=$(sed -n '/^packages:/,/^[^ ]/{ /^  - /{ s/^  - //; s/[[:space:]]*$//; p; } }' \
      "$PROJECT_DIR/pnpm-workspace.yaml")

    for glob in $globs; do
      # Expand each glob relative to PROJECT_DIR
      # shellcheck disable=SC2086
      for dir in $PROJECT_DIR/$glob; do
        if [ -d "$dir/src" ] && [ -f "$dir/package.json" ]; then
          echo "$dir"
        fi
      done
    done
  elif [ -d "$PROJECT_DIR/src" ]; then
    echo "$PROJECT_DIR"
  fi
}

# Check if a directory contains test files (non-recursive, one level)
has_test_files() {
  local dir="$1"
  # Look for *.test.* or *.spec.* files
  find "$dir" -maxdepth 1 -type f \( -name "*.test.*" -o -name "*.spec.*" \) 2>/dev/null | head -1 | grep -q .
}

# Check if a directory tree contains test files (recursive)
has_test_files_recursive() {
  local dir="$1"
  find "$dir" -type f \( -name "*.test.*" -o -name "*.spec.*" \) 2>/dev/null | head -1 | grep -q .
}

# Scan packages and classify test patterns
test_dir_count=0
colocated_count=0
mixed_count=0
no_tests_count=0
colocated_packages=""

while IFS= read -r pkg_dir; do
  [ -z "$pkg_dir" ] && continue

  has_test_dir=false
  has_colocated=false

  if [ -d "$pkg_dir/__test__" ]; then
    if has_test_files_recursive "$pkg_dir/__test__"; then
      has_test_dir=true
    fi
  fi

  if has_test_files_recursive "$pkg_dir/src"; then
    has_colocated=true
  fi

  pkg_name=$(jq -r '.name // "unknown"' "$pkg_dir/package.json" 2>/dev/null || echo "unknown")

  if $has_test_dir && $has_colocated; then
    mixed_count=$((mixed_count + 1))
    colocated_packages="${colocated_packages:+$colocated_packages, }$pkg_name"
  elif $has_test_dir; then
    test_dir_count=$((test_dir_count + 1))
  elif $has_colocated; then
    colocated_count=$((colocated_count + 1))
    colocated_packages="${colocated_packages:+$colocated_packages, }$pkg_name"
  else
    no_tests_count=$((no_tests_count + 1))
  fi
done < <(find_workspace_packages)

total_with_tests=$((test_dir_count + colocated_count + mixed_count))
total_colocated=$((colocated_count + mixed_count))

# --- Output ---

cat <<'STATIC'
## @savvy-web/vitest — Workspace Discovery

This project uses **@savvy-web/vitest** for automatic Vitest project
configuration. The `vitest.config.ts` calls `VitestConfig.create()` which
auto-discovers all workspace packages with `src/` directories and generates
multi-project configs. **Do not manually configure test projects** — the
plugin handles discovery, classification, coverage, and reporter setup.

Use `/vitest:config` for the full options API when modifying `vitest.config.ts`.

### Test Directory Layout

Use `__test__/` at the package root. This is the **preferred pattern**.

```text
package-root/
  src/                # source code (co-located tests supported but discouraged)
  **test**/           # dedicated test directory (preferred)
    utils/            # shared test helpers (excluded from discovery)
    fixtures/         # test fixtures (excluded from discovery)
    *.test.ts         # unit tests
    e2e/
      utils/          # excluded from discovery
      fixtures/       # excluded from discovery
      *.e2e.test.ts   # e2e tests
    integration/
      utils/          # excluded from discovery
      fixtures/       # excluded from discovery
      *.int.test.ts   # integration tests
  vitest.setup.ts     # optional — auto-detected and added to setupFiles

```

### Test Classification

Tests are classified by **filename convention only** — location is irrelevant:

| Pattern | Kind | Check order |
| --- | --- | --- |
| `*.e2e.(test\|spec).(ts\|tsx\|js\|jsx)` | e2e | first |
| `*.int.(test\|spec).(ts\|tsx\|js\|jsx)` | integration | second |
| `*.(test\|spec).(ts\|tsx\|js\|jsx)` | unit | catch-all |

When a package has 2+ test kinds, projects are suffixed: `@pkg:unit`,
`@pkg:e2e`, `@pkg:int`. Single-kind packages use the bare name.

```bash
STATIC

# Dynamic detection section

if [ "$total_with_tests" -eq 0 ]; then
  cat <<'EOF'

### Detected Pattern

No test files detected yet. When adding tests, use the `__test__/`
directory pattern described above.

EOF
elif [ "$total_colocated" -eq 0 ]; then
  cat <<EOF

### Detected Pattern

All $total_with_tests package(s) with tests use \`**test**/\` directories.
Follow this pattern when adding tests.

EOF
else
  echo "### Detected Pattern"
  echo ""
  if [ "$test_dir_count" -gt 0 ]; then
    echo "- $test_dir_count package(s) use \`**test**/\` directories"
  fi
  if [ "$colocated_count" -gt 0 ]; then
    echo "- $colocated_count package(s) have co-located tests in \`src/\` ($colocated_packages)"
  fi
  if [ "$mixed_count" -gt 0 ]; then
    echo "- $mixed_count package(s) have both \`__test__/\` and co-located tests ($colocated_packages)"
  fi
  echo ""
  echo "**Migrate co-located tests to \`**test**/\`.** The \`**test**/\` pattern"
  echo "is preferred for this project."
  echo ""
fi

cat <<'REPORTER'

### Agent Reporter

`vitest-agent-reporter` is injected by default via `AgentPlugin`. It provides
MCP tools for structured test data, coverage analysis, and test history.
Install its companion Claude Code plugin for full MCP tool access and
session context.
REPORTER

exit 0

```

- [ ] **Step 2: Make the script executable and test it**

```bash
chmod +x plugin/hooks/session-start.sh
cd /path/to/a/repo/using/savvy-web-vitest
CLAUDE_PROJECT_DIR="$(pwd)" bash /path/to/vitest/plugin/hooks/session-start.sh
```

Verify the output contains:

1. The static "Workspace Discovery" section with the directory layout
2. A "Detected Pattern" section that reflects the repo's actual test layout
3. The "Agent Reporter" note at the bottom

- [ ] **Step 3: Commit**

```bash
git add plugin/hooks/session-start.sh
git commit -m "feat(plugin): rewrite session-start hook for test convention context

Replace the agent-reporter-focused session start with context about
@savvy-web/vitest workspace discovery, prescribed __test__/ directory
layout, filename-based test classification, and dynamic detection of
the repo's actual test patterns.

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 3: Create the `vitest:config` Skill

**Files:**

- Create: `plugin/skills/config/SKILL.md`

- [ ] **Step 1: Create the skill directory**

```bash
mkdir -p plugin/skills/config
```

- [ ] **Step 2: Write SKILL.md**

Create `plugin/skills/config/SKILL.md` with the following content:

````markdown
---
name: config
description: >
  Full API reference for @savvy-web/vitest configuration. Use when modifying
  vitest.config.ts — covers VitestConfigOptions, VitestProject factories,
  mutation methods, coverage level presets, and common recipes.
---

# @savvy-web/vitest Configuration Reference

## VitestConfig.create()

```typescript
import { VitestConfig } from "@savvy-web/vitest";

export default VitestConfig.create(options?, postProcess?);
```

`VitestConfig.create()` auto-discovers workspace packages with `src/`
directories, classifies test files by filename convention, and generates
multi-project Vitest configs. Do not manually define test projects.

## VitestConfigOptions

### coverage

**Type:** `CoverageLevelName | CoverageThresholds`
**Default:** `"none"`

Coverage thresholds that **fail tests** when not met. Use a named level
or an explicit object.

**Named levels** (lines / branches / functions / statements):

| Level | lines | branches | functions | statements |
| --- | --- | --- | --- | --- |
| `none` | 0 | 0 | 0 | 0 |
| `basic` | 50 | 50 | 50 | 50 |
| `standard` | 70 | 65 | 70 | 70 |
| `strict` | 80 | 75 | 80 | 80 |
| `full` | 90 | 85 | 90 | 90 |

Access programmatically via `VitestConfig.COVERAGE_LEVELS.standard`.

### coverageTargets

**Type:** `CoverageLevelName | CoverageThresholds`
**Default:** `"basic"`

Thresholds forwarded to `vitest-agent-reporter`. These are
**informational only** — they do not cause test failures. The reporter
uses them to identify coverage gaps.

### coverageExclude

**Type:** `string[]`

Additional glob patterns excluded from coverage reporting, appended to
the built-in exclusions.

### agentReporter

**Type:** `boolean | AgentReporterConfig`
**Default:** `true`

Controls injection of the `vitest-agent-reporter` plugin. When `true`,
injects with default options. When an `AgentReporterConfig` object,
passes the options through. When `false`, disables injection.

### pool

**Type:** `"threads" | "forks" | "vmThreads" | "vmForks"`
**Default:** Vitest default (threads)

Vitest pool mode. Use `"forks"` for Effect-TS compatibility.

### unit / e2e / int

**Type:** `KindOverride`

Per-kind overrides applied to all projects of that test kind.

**Object form** — merged into every project's `test` config:

```typescript
VitestConfig.create({
  e2e: { testTimeout: 300_000 },
});
```

**Callback form** — receives a `Map<string, VitestProject>` for
fine-grained per-project mutation:

```typescript
VitestConfig.create({
  unit: (projects) => {
    const pkg = projects.get("@savvy-web/my-lib:unit");
    pkg?.addCoverageExclude("**/generated/**");
  },
});
```

### postProcess (second argument)

**Type:** `(config: ViteUserConfig) => ViteUserConfig | undefined`

Escape hatch for modifying the assembled config after all discovery
and overrides have been applied. Return a replacement config or
`undefined` to use the mutated original.

```typescript
VitestConfig.create({}, (config) => {
  config.plugins ??= [];
  config.plugins.push(myPlugin());
  return config;
});
```

## VitestProject

Projects are created via static factory methods. Each factory applies
kind-specific defaults.

### Factory Defaults

| Factory | environment | testTimeout | hookTimeout | maxConcurrency |
| --- | --- | --- | --- | --- |
| `unit()` | node | vitest default | vitest default | vitest default |
| `int()` | node | 60,000 | 30,000 | floor(cpus/2) clamped 1..8 |
| `e2e()` | node | 120,000 | 60,000 | floor(cpus/2) clamped 1..8 |
| `custom(kind)` | — | — | — | — |

### Mutation Methods

All methods are chainable (return `this`):

- **`override(config)`** — merge additional
  `TestProjectInlineConfiguration`; `name` and `include` are always
  preserved
- **`addInclude(...patterns)`** — append glob patterns to the test
  include list
- **`addExclude(...patterns)`** — append glob patterns to the test
  exclude list
- **`addCoverageExclude(...patterns)`** — append glob patterns to
  per-project coverage exclusions

### Properties

- **`name`** — project name (read-only)
- **`kind`** — test kind: `"unit"`, `"e2e"`, `"int"`, or custom
  (read-only)
- **`coverageExcludes`** — accumulated coverage exclusion patterns
  (read-only)
- **`toConfig()`** — returns the Vitest-native
  `TestProjectInlineConfiguration`

## Common Recipes

### Set coverage with agent-reporter targets

```typescript
VitestConfig.create({
  coverage: "standard",
  coverageTargets: "strict",
});
```

### Use forks pool for Effect-TS

```typescript
VitestConfig.create({
  pool: "forks",
});
```

### Exclude generated code from coverage

```typescript
VitestConfig.create({
  unit: (projects) => {
    for (const [, project] of projects) {
      project.addCoverageExclude("**/generated/**");
    }
  },
});
```

### Increase e2e timeout for slow tests

```typescript
VitestConfig.create({
  e2e: { testTimeout: 300_000, hookTimeout: 120_000 },
});
```

### Add a Vite plugin via postProcess

```typescript
VitestConfig.create({}, (config) => {
  config.plugins ??= [];
  config.plugins.push(myVitePlugin());
  return config;
});
```

## Anti-Patterns

- **Don't manually define test projects** — `VitestConfig.create()`
  handles discovery. Adding manual `projects` entries bypasses
  conventions.
- **Don't create per-package vitest configs** — one workspace-root
  config discovers all packages.
- **Don't bypass `VitestConfig.create()`** — raw Vitest config loses
  auto-discovery, coverage presets, and agent-reporter integration.
- **Don't hardcode include patterns** — use `addInclude()` via
  per-kind overrides if you need extras.
````

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/config/SKILL.md
git commit -m "feat(plugin): add vitest:config skill for API reference

Static skill covering VitestConfigOptions, VitestProject factories
and mutation API, coverage level presets, common recipes, and
anti-patterns.

Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>"
```

---

### Task 4: Integration Test

**Files:** None (manual verification)

- [ ] **Step 1: Verify plugin structure**

```bash
ls -R plugin/
```

Expected structure:

```text
plugin/
  .claude-plugin/
    plugin.json
  hooks/
    hooks.json
    session-start.sh
  skills/
    config/
      SKILL.md
  README.md
```

No `post-test-run.sh` should exist.

- [ ] **Step 2: Run session-start hook against this repo**

```bash
CLAUDE_PROJECT_DIR="$(pwd)" bash plugin/hooks/session-start.sh
```

Verify output includes:

1. `## @savvy-web/vitest — Workspace Discovery` heading
2. The `__test__/` directory layout diagram
3. The test classification table
4. A `### Detected Pattern` section (should detect this repo's actual pattern)
5. The `### Agent Reporter` note at the bottom

- [ ] **Step 3: Verify no shellcheck errors**

```bash
shellcheck plugin/hooks/session-start.sh
```

Expected: no errors (warnings about `SC2086` are suppressed inline).

- [ ] **Step 4: Verify skill is loadable**

Check that the SKILL.md frontmatter is valid YAML and the content renders properly:

```bash
head -7 plugin/skills/config/SKILL.md
```

Expected output:

```yaml
---
name: config
description: >
  Full API reference for @savvy-web/vitest configuration. Use when modifying
  vitest.config.ts — covers VitestConfigOptions, VitestProject factories,
  mutation methods, coverage level presets, and common recipes.
---
```

- [ ] **Step 5: Final commit (if any fixes needed)**

Only commit if integration testing revealed issues that needed fixing.
