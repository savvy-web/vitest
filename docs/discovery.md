# Test Discovery

How `VitestConfig.create()` automatically discovers workspace packages,
classifies test files, names projects, and generates coverage
configuration.

## Workspace Scanning Flow

Discovery runs through this pipeline whenever `VitestConfig.create()`
is called and the internal cache is empty:

1. **Locate workspace root** --
   `workspace-tools.getWorkspaceManagerRoot(cwd)` returns the
   directory containing `pnpm-workspace.yaml`. Falls back to
   `process.cwd()` if no root is found.

2. **Enumerate packages** --
   `workspace-tools.getWorkspacePackagePaths(root)` returns absolute
   paths for every package listed in the workspace configuration.

3. **Read package name** -- For each package path, the `name` field is
   read from `package.json`. Packages with a missing or unreadable
   `package.json` are silently skipped.

4. **Check for `src/` directory** -- Only packages that contain a
   `src/` directory are considered. This is the sole entry criterion;
   packages without `src/` are ignored entirely.

5. **Check for `__test__/` directory** -- If a `__test__/` directory
   exists alongside `src/`, it is included in the scan. Other test
   directory names (`tests/`, `test/`) are not recognized.

6. **Scan for test files** -- Both `src/` and `__test__/` (when
   present) are scanned recursively. The scan short-circuits as soon
   as all three kinds (unit, e2e, integration) are found, avoiding
   unnecessary filesystem traversal.

7. **Create projects** -- Based on the scan results, `VitestProject`
   instances are created (see
   [Project Creation Rules](#project-creation-rules) below).

8. **Cache results** -- The discovered project mapping and
   `VitestProject` array are stored in static properties. Subsequent
   calls return the cached values without re-scanning.

## Filename Classification Rules

Test files are classified by matching their filename against regular
expressions. Patterns are checked in the following order; the first
match wins.

| Pattern | Kind | Regex | Examples |
| --- | --- | --- | --- |
| `*.e2e.(test\|spec).(ts\|tsx\|js\|jsx)` | e2e | `/\.e2e\.(test\|spec)\.(ts\|tsx\|js\|jsx)$/` | `auth.e2e.test.ts` |
| `*.int.(test\|spec).(ts\|tsx\|js\|jsx)` | int | `/\.int\.(test\|spec)\.(ts\|tsx\|js\|jsx)$/` | `db.int.test.ts` |
| `*.(test\|spec).(ts\|tsx\|js\|jsx)` | unit | `/\.(test\|spec)\.(ts\|tsx\|js\|jsx)$/` | `parser.test.ts`, `parser.unit.test.ts` |

Files that match neither pattern are ignored. Classification is based
entirely on the filename; the directory location does not influence the
kind.

A file like `foo.e2e.test.ts` matches the e2e regex first, so it is
never double-counted as a unit test. Similarly, `bar.int.test.ts`
matches integration before falling through to unit. The `.unit.`
signifier (e.g., `parser.unit.test.ts`) is caught by the unit
catch-all pattern.

## Fixture and Utils Exclusion

Conventional subdirectories under `__test__/` that hold helpers or
test data are excluded from test discovery. Exclusion applies only at
these conventional locations:

- `__test__/fixtures/`
- `__test__/utils/`
- `__test__/unit/fixtures/`
- `__test__/unit/utils/`
- `__test__/e2e/fixtures/`
- `__test__/e2e/utils/`
- `__test__/integration/fixtures/`
- `__test__/integration/utils/`

Files within these directories are never matched as test files,
regardless of their filename.

## Setup File Detection

`VitestConfig` auto-detects a `vitest.setup.{ts,tsx,js,jsx}` file at
the package root. Extensions are probed in that order; the first match
wins. When found, the setup file path is added to the `setupFiles`
array for all projects discovered in that package.

## Project Naming

The project name is derived from the `name` field in the package's
`package.json`. Whether a `:unit`, `:e2e`, or `:int` suffix is
appended depends on how many test kinds the package contains.

### Suffixing Rules

| Kinds found | Project names created |
| --- | --- |
| 1 kind only | Bare package name (e.g., `@scope/pkg`) |
| 2 or more kinds | Suffixed names (e.g., `@scope/pkg:unit`, `@scope/pkg:e2e`) |
| No test files | Bare package name (unit fallback placeholder) |

When a package has two or more test kinds, separate `VitestProject`
instances are created with explicit suffixes. When only one kind
exists, the bare package name is used without a suffix.

Packages that contain a `src/` directory but no test files still
receive a unit project entry as a forward-looking placeholder.

### Project Creation Rules

For each discovered package, the factory method and include globs are
determined as follows:

- **Unit projects** use `VitestProject.unit()` with include patterns
  `src/**/*.{test,spec}.{ts,tsx,js,jsx}` (and
  `__test__/**/*.{test,spec}.{ts,tsx,js,jsx}` when present). Exclude
  patterns `**/*.e2e.{test,spec}.*` and `**/*.int.{test,spec}.*`
  prevent non-unit files from running in the unit project.

- **E2E projects** use `VitestProject.e2e()` with include patterns
  `src/**/*.e2e.{test,spec}.{ts,tsx,js,jsx}` (and
  `__test__/**/*.e2e.{test,spec}.{ts,tsx,js,jsx}` when present).

- **Integration projects** use `VitestProject.int()` with include
  patterns `src/**/*.int.{test,spec}.{ts,tsx,js,jsx}` (and
  `__test__/**/*.int.{test,spec}.{ts,tsx,js,jsx}` when present).

- **Fallback projects** (no test files found) use
  `VitestProject.unit()` with the standard unit include patterns and
  no kind-specific exclusions.

## Coverage Configuration

`VitestConfig.create()` generates coverage configuration that pairs
with the discovered projects.

### Include Pattern Generation

For each discovered package, a glob is generated:

```text
<relativePath>/src/**/*.ts
```

For example, if `@savvy-web/my-lib` lives at `pkgs/my-lib` relative
to the workspace root, its coverage include becomes
`pkgs/my-lib/src/**/*.ts`.

### Default Coverage Excludes

The following patterns are always excluded from coverage reporting:

- `**/*.{test,spec}.{ts,tsx,js,jsx}`
- `**/__test__/**`
- `**/generated/**`

Additional patterns can be added with the `coverageExclude` option in
`VitestConfigOptions`. User-supplied patterns are additive; they do
not replace the built-in defaults.

### Thresholds

Coverage thresholds default to the `"strict"` level (lines: 80,
branches: 75, functions: 80, statements: 80). Use the `coverage`
option to select a different named level or provide explicit
thresholds.

```typescript
// Named level
VitestConfig.create({ coverage: "standard" });

// Explicit thresholds
VitestConfig.create({
  coverage: { lines: 95, branches: 90, functions: 95, statements: 95 },
});
```

## `--project` Filtering

When Vitest is invoked with one or more `--project` flags, coverage is
scoped to the union of matched packages rather than the entire
workspace.

### How It Works

1. `VitestConfig` parses all `--project` arguments from
   `process.argv`, supporting both `--project=value` and
   `--project value` formats.

2. For each project name, the `:unit`, `:e2e`, or `:int` suffix is
   stripped to recover the base package name.

3. Each base name is looked up in the internal project mapping
   (package name to relative path).

4. If any lookups succeed, coverage `include` is narrowed to the union
   of those packages' `src/**/*.ts` globs.

5. If all lookups fail (no names found), coverage falls back to
   including all discovered packages.

### Example

```text
--project=@savvy-web/my-lib:unit --project=@savvy-web/auth:e2e
         |                                |
         v                                v
base:    @savvy-web/my-lib                @savvy-web/auth
         |                                |
         v                                v
lookup:  projects["@savvy-web/my-lib"]    projects["@savvy-web/auth"]
         -> "pkgs/my-lib"                 -> "pkgs/auth"
         |                                |
         v                                v
coverage include: [
  "pkgs/my-lib/src/**/*.ts",
  "pkgs/auth/src/**/*.ts",
]
```

## Root-Package Normalization

When the workspace root itself is a package (its relative path from
the workspace root is an empty string), the discovery logic normalizes
it to `"."`. This affects glob generation:

- **Standard package** at `pkgs/my-lib`:
  include becomes `pkgs/my-lib/src/**/*.{test,spec}.{ts,tsx,js,jsx}`
- **Root package** at `"."`:
  include becomes `src/**/*.{test,spec}.{ts,tsx,js,jsx}` (no prefix)

This prevents malformed globs like `./src/**/*.ts` or `/src/**/*.ts`
from being generated.

## Caching

Discovery results are cached in two static properties:

- `cachedProjects` -- the `Record<string, string>` mapping package
  names to relative paths
- `cachedVitestProjects` -- the `VitestProject[]` array

The cache persists for the lifetime of the Node.js process. During
watch mode or HMR, Vitest may re-evaluate the configuration file
multiple times; the cache ensures the filesystem is scanned only once.

To pick up newly added or removed packages, the Vitest process (or
dev server) must be restarted.
