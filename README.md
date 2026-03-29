# @savvy-web/vitest

[![npm version][npm-badge]][npm-url]
[![License: MIT][license-badge]][license-url]

Automatic Vitest project configuration discovery for pnpm monorepo
workspaces. Scans workspace packages, classifies test files as unit,
e2e, or integration by filename convention, and generates multi-project
Vitest configs with coverage thresholds, `vitest-agent-reporter`
integration, and CI-aware reporters.

## Features

- **Zero-config workspace discovery** -- Scans packages with `src/` directories automatically
- **Three-kind test classification** -- Unit, e2e, and integration tests classified by filename convention
- **Named coverage levels** -- `none`, `basic`, `standard`, `strict`, `full` presets
- **Per-kind and per-project overrides** -- Object or callback form with chainable mutation API
- **Agent reporter integration** -- Built-in `vitest-agent-reporter` plugin injection
- **Claude Code plugin** -- Session context and configuration reference for AI-assisted development

## Repository Structure

This is a pnpm workspace monorepo:

| Directory | Purpose |
| --------- | ------- |
| `package/` | The published `@savvy-web/vitest` npm package |
| `plugin/` | Companion Claude Code plugin (hooks, skills) |
| `docs/` | Repository-level documentation |
| `lib/` | Shared workspace configuration (lint-staged, markdownlint) |

## Development

```bash
pnpm install
pnpm run build          # Build all (dev + prod)
pnpm run test           # Run all tests
pnpm run lint           # Check code with Biome
pnpm run typecheck      # Type-check via Turbo (tsgo)
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for full development setup and conventions.

## Documentation

- [Package README](./package/README.md) -- Installation, quick start, and API overview
- [Plugin README](./plugin/README.md) -- Claude Code companion plugin
- [API Reference](./docs/api.md) -- Types, classes, and configuration options
- [Discovery](./docs/discovery.md) -- Workspace scanning and test classification
- [Guides](./docs/guides.md) -- Usage patterns and recipes

## License

[MIT](./LICENSE)

[npm-badge]: https://img.shields.io/npm/v/@savvy-web/vitest
[npm-url]: https://www.npmjs.com/package/@savvy-web/vitest
[license-badge]: https://img.shields.io/badge/License-MIT-yellow.svg
[license-url]: https://opensource.org/licenses/MIT
