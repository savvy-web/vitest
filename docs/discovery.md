# Test Discovery

How `VitestConfig.create()` automatically discovers workspace
packages, classifies test files, names projects, and generates
coverage configuration.

## Workspace Scanning Flow

Discovery runs through this pipeline whenever
`VitestConfig.create()` is called and the internal cache is empty:

1. **Locate workspace root** --
   `workspace-tools.getWorkspaceManagerRoot(cwd)` returns the
   directory containing `pnpm-workspace.yaml`. Falls back to
   `process.cwd()` if no root is found.

2. **Enumerate packages** --
   `workspace-tools.getWorkspacePackagePaths(root)` returns
   absolute paths for every package listed in the workspace
   configuration.

3. **Read package name** -- For each package path, the `name`
   field is read from `package.json`. Packages with a missing or
   unreadable `package.json` are silently skipped.

4. **Check for `src/` directory** -- Only packages that contain a
   `src/` directory are considered. This is the sole entry
   criterion; packages without `src/` are ignored entirely.

5. **Check for `__test__/` directory** -- If a `__test__/`
   directory exists alongside `src/`, it is included in the scan.
   Other test directory names (`tests/`, `test/`) are not
   recognized.

6. **Scan for test files** -- Both `src/` and `__test__/` (when
   present) are scanned recursively. The scan short-circuits as
   soon as both unit and e2e files are found, avoiding unnecessary
   filesystem traversal.

7. **Create projects** -- Based on the scan results,
   `VitestProject` instances are created (see
   [Project Creation Rules](#project-creation-rules) below).

8. **Cache results** -- The discovered project mapping and
   `VitestProject` array are stored in static properties.
   Subsequent calls return the cached values without re-scanning.

## Filename Classification Rules

Test files are classified by matching their filename against
regular expressions. The e2e pattern is checked first; any file
that does not match e2e falls through to the unit check.

| Pattern | Kind | Regex | Examples |
| --- | --- | --- | --- |
| `*.e2e.test.ts` | e2e | `/\.e2e\.(test\|spec)\.ts$/` | `auth.e2e.test.ts` |
| `*.e2e.spec.ts` | e2e | (same) | `auth.e2e.spec.ts` |
| `*.test.ts` | unit | `/\.(test\|spec)\.ts$/` | `parser.test.ts` |
| `*.spec.ts` | unit | (same) | `parser.spec.ts` |

Files that match neither pattern are ignored. Classification is
based entirely on the filename; the directory location does not
influence the kind.

**Important:** A file like `foo.e2e.test.ts` matches the e2e
regex first, so it is never double-counted as a unit test.

## Project Naming

The project name is derived from the `name` field in the
package's `package.json`. Whether a `:unit` or `:e2e` suffix is
appended depends on whether the package contains both test kinds.

### When Suffixes Are Added

| Has unit files | Has e2e files | Project names created |
| --- | --- | --- |
| yes | no | `@scope/pkg` (bare, unit project) |
| no | yes | `@scope/pkg` (bare, e2e project) |
| yes | yes | `@scope/pkg:unit` and `@scope/pkg:e2e` |
| no | no | `@scope/pkg` (bare, unit fallback) |

When a package has both unit and e2e test files, two separate
`VitestProject` instances are created with explicit `:unit` and
`:e2e` suffixes. When only one kind exists, the bare package name
is used without a suffix.

Packages that contain a `src/` directory but no test files still
receive a unit project entry as a forward-looking placeholder.

### Project Creation Rules

For each discovered package, the factory method and include globs
are determined as follows:

- **Unit projects** use `VitestProject.unit()` with include
  patterns `src/**/*.{test,spec}.ts` (and
  `__test__/**/*.{test,spec}.ts` when the directory exists). An
  exclude pattern `**/*.e2e.{test,spec}.ts` is added to prevent
  e2e files from running in the unit project.

- **E2E projects** use `VitestProject.e2e()` with include
  patterns `src/**/*.e2e.{test,spec}.ts` (and
  `__test__/**/*.e2e.{test,spec}.ts` when present).

- **Fallback projects** (no test files found) use
  `VitestProject.unit()` with the standard unit include patterns
  and no exclude.

## Coverage Configuration

`VitestConfig.create()` generates a `CoverageConfig` that pairs
with the discovered projects. The coverage include patterns are
derived from the project mapping (package name to relative path).

### Include Pattern Generation

For each discovered package, a glob is generated:

```text
<relativePath>/src/**/*.ts
```

For example, if `@savvy-web/my-lib` lives at `pkgs/my-lib`
relative to the workspace root, its coverage include becomes
`pkgs/my-lib/src/**/*.ts`.

The exclude pattern is always `["**/*.{test,spec}.ts"]`, which
removes test files from coverage reporting.

### Thresholds

All four coverage metrics default to
`VitestConfig.DEFAULT_THRESHOLD` (80). Individual metrics can be
overridden through `VitestConfigCreateOptions.thresholds`:

```typescript
VitestConfig.create(callback, {
  thresholds: {
    lines: 90,
    branches: 85,
    // functions and statements default to 80
  },
});
```

## `--project` Filtering

When Vitest is invoked with `--project`, coverage is scoped to
the targeted package rather than the entire workspace.

### How It Works

1. `VitestConfig` parses `--project` from `process.argv`,
   supporting both `--project=value` and `--project value`
   formats.

2. If a project name is found, the `:unit` or `:e2e` suffix is
   stripped to recover the base package name.

3. The base name is looked up in the internal project mapping
   (package name to relative path).

4. If the lookup succeeds, coverage `include` is narrowed to that
   single package's `src/**/*.ts` glob.

5. If the lookup fails (name not found), coverage falls back to
   including all discovered packages.

### Suffix Stripping Example

```text
--project=@savvy-web/my-lib:unit
         |
         v
base name: @savvy-web/my-lib   (strip ":unit")
         |
         v
lookup:   projects["@savvy-web/my-lib"] -> "pkgs/my-lib"
         |
         v
coverage: include: ["pkgs/my-lib/src/**/*.ts"]
```

This design means running unit tests for a single package does
not require coverage for every other package in the workspace.

## Root-Package Normalization

When the workspace root itself is a package (its relative path
from the workspace root is an empty string), the discovery logic
normalizes it to `"."`. This affects glob generation:

- **Standard package** at `pkgs/my-lib`:
  include becomes `pkgs/my-lib/src/**/*.{test,spec}.ts`
- **Root package** at `"."`:
  include becomes `src/**/*.{test,spec}.ts` (no leading prefix)

The prefix logic uses:

```typescript
const prefix = relativePath === "." ? "" : `${relativePath}/`;
```

This prevents malformed globs like `./src/**/*.ts` or
`/src/**/*.ts` from being generated.

## Caching

Discovery results are cached in two static properties:

- `cachedProjects` -- the `Record<string, string>` mapping
  package names to relative paths
- `cachedVitestProjects` -- the `VitestProject[]` array

The cache persists for the lifetime of the Node.js process.
During watch mode or HMR, Vitest may re-evaluate the
configuration file multiple times; the cache ensures the
filesystem is scanned only once.

To pick up newly added or removed packages, the Vitest process
(or dev server) must be restarted.
