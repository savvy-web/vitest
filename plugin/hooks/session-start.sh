#!/usr/bin/env bash
set -euo pipefail

# SessionStart hook: inject @savvy-web/vitest convention context.
# Outputs JSON with additionalContext about test conventions,
# workspace discovery, and detected test patterns.

# Error trap: surface failures instead of silently producing no output
trap 'echo "ERROR: session-start.sh failed at line $LINENO (exit $?)" >&2; exit 1' ERR

# Consume stdin to prevent broken pipe errors
cat > /dev/null

if [ -z "${CLAUDE_PROJECT_DIR:-}" ]; then
  echo "ERROR: CLAUDE_PROJECT_DIR is not set" >&2
  exit 1
fi

PROJECT_DIR="$CLAUDE_PROJECT_DIR"

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

# --- Build Context ---

# Dynamic detection section
if [ "$total_with_tests" -eq 0 ]; then
  DETECTED_PATTERN="<detected_pattern>
No test files detected yet. When adding tests, use the __test__/
directory pattern described above.
</detected_pattern>"
elif [ "$total_colocated" -eq 0 ]; then
  DETECTED_PATTERN="<detected_pattern>
All $total_with_tests package(s) with tests use __test__/ directories.
Follow this pattern when adding tests.
</detected_pattern>"
else
  DETECTED_PATTERN="<detected_pattern>"
  if [ "$test_dir_count" -gt 0 ]; then
    DETECTED_PATTERN="$DETECTED_PATTERN
$test_dir_count package(s) use __test__/ directories."
  fi
  if [ "$colocated_count" -gt 0 ]; then
    DETECTED_PATTERN="$DETECTED_PATTERN
$colocated_count package(s) have co-located tests in src/ ($colocated_packages)."
  fi
  if [ "$mixed_count" -gt 0 ]; then
    DETECTED_PATTERN="$DETECTED_PATTERN
$mixed_count package(s) have both __test__/ and co-located tests ($mixed_packages)."
  fi
  DETECTED_PATTERN="$DETECTED_PATTERN
Migrate co-located tests to __test__/. The __test__/ pattern is preferred for this project.
</detected_pattern>"
fi

CONTEXT=$(cat <<CONTEXT
<EXTREMELY_IMPORTANT>
<savvy_web_vitest_workspace_discovery>

<overview>
This project uses @savvy-web/vitest for automatic Vitest project
configuration. vitest.config.ts calls VitestConfig.create() which
auto-discovers all workspace packages with src/ directories and generates
multi-project configs. Do not manually configure test projects — the
plugin handles discovery, classification, coverage, and reporter setup.

Use /vitest:config for the full options API when modifying vitest.config.ts.
</overview>

<test_directory_layout>
Use __test__/ at the package root. This is the preferred pattern.

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
</test_directory_layout>

<test_classification>
Tests are classified by filename convention only — location is irrelevant:

*.e2e.(test|spec).(ts|tsx|js|jsx)  → e2e (checked first)
*.int.(test|spec).(ts|tsx|js|jsx)  → integration (checked second)
*.(test|spec).(ts|tsx|js|jsx)      → unit (catch-all)

When a package has 2+ test kinds, projects are suffixed: @pkg:unit,
@pkg:e2e, @pkg:int. Single-kind packages use the bare name.
</test_classification>

${DETECTED_PATTERN}

<agent_reporter>
vitest-agent-reporter is injected by default via AgentPlugin. It provides
MCP tools for structured test data, coverage analysis, and test history.
Install its companion Claude Code plugin for full MCP tool access and
session context.
</agent_reporter>

</savvy_web_vitest_workspace_discovery>
</EXTREMELY_IMPORTANT>
CONTEXT
)

# Output as JSON with additionalContext
jq -n --arg ctx "$CONTEXT" '{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": $ctx
  }
}'

exit 0
