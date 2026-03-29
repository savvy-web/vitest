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
    globs=$(sed -n '/^packages:/,/^[^ ]/{ /^  - /{ s/^  - //; s/[[:space:]]*$//; p; }; }' \
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
mixed_packages=""

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
    mixed_packages="${mixed_packages:+$mixed_packages, }$pkg_name"
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

```
package-root/
  src/                # source code (co-located tests supported but discouraged)
  __test__/           # dedicated test directory (preferred)
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

All $total_with_tests package(s) with tests use \`__test__/\` directories.
Follow this pattern when adding tests.

EOF
else
  echo "### Detected Pattern"
  echo ""
  if [ "$test_dir_count" -gt 0 ]; then
    echo "- $test_dir_count package(s) use \`__test__/\` directories"
  fi
  if [ "$colocated_count" -gt 0 ]; then
    echo "- $colocated_count package(s) have co-located tests in \`src/\` ($colocated_packages)"
  fi
  if [ "$mixed_count" -gt 0 ]; then
    echo "- $mixed_count package(s) have both \`__test__/\` and co-located tests ($mixed_packages)"
  fi
  echo ""
  echo "**Migrate co-located tests to \`__test__/\`.** The \`__test__/\` pattern"
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
