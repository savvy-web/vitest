/**
 * Vitest utility functions for automatic project configuration discovery
 * in pnpm monorepo workspaces.
 *
 * @remarks
 * This package provides two main classes:
 *
 * - {@link VitestProject} - Represents a single Vitest project with sensible
 *   defaults per test kind (unit, e2e, or custom).
 *
 * - {@link VitestConfig} - Orchestrates workspace discovery, coverage
 *   configuration, reporter selection, and callback invocation.
 *
 * @example
 * ```typescript
 * import { VitestConfig } from "@savvy-web/vitest";
 *
 * export default VitestConfig.create(
 *   ({ projects, coverage, reporters }) => ({
 *     test: {
 *       reporters,
 *       projects: projects.map((p) => p.toConfig()),
 *       coverage: { provider: "v8", ...coverage },
 *     },
 *   }),
 * );
 * ```
 *
 * @packageDocumentation
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { cpus } from "node:os";
import { join, relative } from "node:path";
import type { TestProjectInlineConfiguration, ViteUserConfig } from "vitest/config";

export type { TestProjectInlineConfiguration } from "vitest/config";

import { getWorkspaceManagerRoot, getWorkspacePackagePaths } from "workspace-tools";

/**
 * The kind of test a {@link VitestProject} represents.
 *
 * @remarks
 * The built-in factories {@link VitestProject.unit | unit()} and
 * {@link VitestProject.e2e | e2e()} correspond to the `"unit"` and `"e2e"`
 * values respectively. The {@link VitestProject.custom | custom()} factory
 * accepts an arbitrary string that is stored as the kind.
 *
 * @public
 */
export type VitestProjectKind = "unit" | "e2e" | (string & {});

/**
 * Options for constructing a {@link VitestProject}.
 *
 * @see {@link VitestProject.unit} for creating unit test projects
 * @see {@link VitestProject.e2e} for creating e2e test projects
 * @see {@link VitestProject.custom} for creating custom test projects
 *
 * @public
 */
export interface VitestProjectOptions {
	/**
	 * The project name, typically a package name optionally suffixed
	 * with `:unit` or `:e2e` when both kinds exist in the same package.
	 */
	name: string;

	/** Glob patterns for test file inclusion. */
	include: string[];

	/**
	 * The test kind. Defaults to `"unit"`.
	 * @defaultValue `"unit"`
	 */
	kind?: VitestProjectKind;

	/**
	 * Vitest-native config fields to merge over the factory defaults.
	 *
	 * @remarks
	 * The {@link VitestProjectOptions.name | name} and
	 * {@link VitestProjectOptions.include | include} fields always take
	 * precedence over any values provided in overrides.
	 *
	 * @see {@link https://vitest.dev/config/ | Vitest Configuration} for available fields
	 */
	overrides?: Partial<TestProjectInlineConfiguration>;
}

/**
 * Options for {@link VitestConfig.create}.
 *
 * @public
 */
export interface VitestConfigCreateOptions {
	/**
	 * Coverage thresholds applied per-file.
	 *
	 * @remarks
	 * Any omitted metric defaults to {@link VitestConfig.DEFAULT_THRESHOLD | 80}.
	 *
	 * @defaultValue `{ lines: 80, functions: 80, branches: 80, statements: 80 }`
	 */
	thresholds?: {
		/** Minimum line coverage percentage. */
		lines?: number;
		/** Minimum function coverage percentage. */
		functions?: number;
		/** Minimum branch coverage percentage. */
		branches?: number;
		/** Minimum statement coverage percentage. */
		statements?: number;
	};
}

/**
 * Coverage configuration passed to the {@link VitestConfigCallback}.
 *
 * @see {@link VitestConfig.create} for how this is generated
 *
 * @public
 */
export interface CoverageConfig {
	/** Glob patterns for files to include in coverage reporting. */
	include: string[];

	/** Glob patterns for files to exclude from coverage reporting. */
	exclude: string[];

	/** Resolved coverage thresholds with all metrics populated. */
	thresholds: {
		/** Minimum line coverage percentage. */
		lines: number;
		/** Minimum function coverage percentage. */
		functions: number;
		/** Minimum branch coverage percentage. */
		branches: number;
		/** Minimum statement coverage percentage. */
		statements: number;
	};
}

/**
 * Callback that receives discovered configuration and returns a Vitest config.
 *
 * @param config - Object containing discovered projects, coverage settings,
 *   reporters array, and CI detection flag
 * @returns A Vitest user configuration, optionally async
 *
 * @see {@link VitestConfig.create} for the entry point that invokes this callback
 *
 * @public
 */
export type VitestConfigCallback = (config: {
	/** Discovered {@link VitestProject} instances for the workspace. */
	projects: VitestProject[];
	/** Generated coverage configuration with thresholds. */
	coverage: CoverageConfig;
	/** Reporter names based on environment (adds `"github-actions"` in CI). */
	reporters: string[];
	/** Whether the current environment is GitHub Actions CI. */
	isCI: boolean;
}) => ViteUserConfig | Promise<ViteUserConfig>;

/**
 * Represents a single Vitest project with sensible defaults per test kind.
 *
 * @remarks
 * Instances are created through static factory methods. The private constructor
 * enforces that all projects are built with validated merge semantics.
 *
 * Override merge precedence (highest wins):
 * 1. `name` and `include` from options (always win)
 * 2. `overrides.test` fields
 * 3. Factory defaults for `test`
 * 4. Top-level: `overrides` rest spreads over factory defaults rest
 *
 * @example
 * ```typescript
 * import { VitestProject } from "@savvy-web/vitest";
 *
 * const unitProject = VitestProject.unit({
 *   name: "@savvy-web/my-lib",
 *   include: ["src/**\/*.test.ts"],
 * });
 *
 * const e2eProject = VitestProject.e2e({
 *   name: "@savvy-web/my-lib:e2e",
 *   include: ["test/e2e/**\/*.test.ts"],
 * });
 *
 * const config = unitProject.toConfig();
 * ```
 *
 * @public
 */
export class VitestProject {
	readonly #name: string;
	readonly #kind: VitestProjectKind;
	readonly #config: TestProjectInlineConfiguration;

	private constructor(options: VitestProjectOptions, defaults: Partial<TestProjectInlineConfiguration>) {
		this.#name = options.name;
		this.#kind = options.kind ?? "unit";

		const { test: defaultTest, ...defaultRest } = defaults;
		const { test: overrideTest, ...overrideRest } = options.overrides ?? {};

		this.#config = {
			extends: true as const,
			...defaultRest,
			...overrideRest,
			test: {
				...defaultTest,
				...overrideTest,
				name: options.name,
				include: options.include,
			},
		} as TestProjectInlineConfiguration;
	}

	/**
	 * The project name.
	 * @see {@link VitestProjectOptions.name}
	 */
	get name(): string {
		return this.#name;
	}

	/**
	 * The test kind (e.g., `"unit"`, `"e2e"`, or a custom string).
	 * @see {@link VitestProjectKind}
	 */
	get kind(): VitestProjectKind {
		return this.#kind;
	}

	/**
	 * Returns the vitest-native inline configuration object.
	 *
	 * @returns A {@link https://vitest.dev/config/ | TestProjectInlineConfiguration}
	 *   with all defaults and overrides merged
	 */
	toConfig(): TestProjectInlineConfiguration {
		return this.#config;
	}

	/**
	 * Creates a unit test project with sensible defaults.
	 *
	 * @remarks
	 * Defaults applied: `extends: true`, `environment: "node"`.
	 *
	 * @param options - Project options (the `kind` field is forced to `"unit"`)
	 * @returns A new {@link VitestProject} configured for unit tests
	 *
	 * @example
	 * ```typescript
	 * import { VitestProject } from "@savvy-web/vitest";
	 *
	 * const project = VitestProject.unit({
	 *   name: "@savvy-web/my-lib",
	 *   include: ["src/**\/*.test.ts"],
	 * });
	 * ```
	 */
	static unit(options: VitestProjectOptions): VitestProject {
		return new VitestProject(
			{ ...options, kind: "unit" },
			{
				test: {
					environment: "node",
				},
			},
		);
	}

	/**
	 * Creates an e2e test project with sensible defaults.
	 *
	 * @remarks
	 * Defaults applied: `extends: true`, `environment: "node"`,
	 * `testTimeout: 120_000`, `hookTimeout: 60_000`,
	 * `maxConcurrency: clamp(floor(cpus / 2), 1, 8)`.
	 *
	 * @param options - Project options (the `kind` field is forced to `"e2e"`)
	 * @returns A new {@link VitestProject} configured for e2e tests
	 *
	 * @example
	 * ```typescript
	 * import { VitestProject } from "@savvy-web/vitest";
	 *
	 * const project = VitestProject.e2e({
	 *   name: "@savvy-web/my-lib:e2e",
	 *   include: ["test/e2e/**\/*.test.ts"],
	 * });
	 * ```
	 */
	static e2e(options: VitestProjectOptions): VitestProject {
		const concurrency = Math.max(1, Math.min(8, Math.floor(cpus().length / 2)));
		return new VitestProject(
			{ ...options, kind: "e2e" },
			{
				test: {
					environment: "node",
					testTimeout: 120_000,
					hookTimeout: 60_000,
					maxConcurrency: concurrency,
				},
			},
		);
	}

	/**
	 * Creates a custom test project with no preset defaults beyond `extends: true`.
	 *
	 * @remarks
	 * Use this factory when the built-in `unit()` and `e2e()` presets do not
	 * match your needs. The `kind` string is stored on the instance but does
	 * not influence any default configuration.
	 *
	 * @param kind - A custom kind string (e.g., `"integration"`, `"smoke"`)
	 * @param options - Project options
	 * @returns A new {@link VitestProject} with no preset defaults
	 *
	 * @example
	 * ```typescript
	 * import { VitestProject } from "@savvy-web/vitest";
	 *
	 * const project = VitestProject.custom("integration", {
	 *   name: "@savvy-web/my-lib:integration",
	 *   include: ["test/integration/**\/*.test.ts"],
	 * });
	 * ```
	 */
	static custom(kind: VitestProjectKind, options: VitestProjectOptions): VitestProject {
		return new VitestProject({ ...options, kind }, {});
	}
}

/**
 * Utility class for generating Vitest configuration in monorepo workspaces.
 *
 * @remarks
 * This class automatically discovers packages in a workspace that contain a
 * `src/` directory and generates appropriate {@link VitestProject} configurations.
 * Tests are discovered by filename convention:
 *
 * | Pattern | Kind |
 * | --- | --- |
 * | `*.test.ts` / `*.spec.ts` | unit |
 * | `*.e2e.test.ts` / `*.e2e.spec.ts` | e2e |
 *
 * It supports both running all tests and targeting specific projects via the
 * `--project` command line argument.
 *
 * Results are cached in static properties so that repeated config evaluations
 * during watch mode or HMR do not re-scan the filesystem.
 *
 * @example
 * ```typescript
 * import { VitestConfig } from "@savvy-web/vitest";
 *
 * export default VitestConfig.create(
 *   ({ projects, coverage, reporters }) => ({
 *     test: {
 *       reporters,
 *       projects: projects.map((p) => p.toConfig()),
 *       coverage: { provider: "v8", ...coverage },
 *     },
 *   }),
 * );
 * ```
 *
 * @public
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Intentional namespace pattern for related functionality with shared cached state
export class VitestConfig {
	/** Default coverage threshold percentage applied when not overridden. */
	static readonly DEFAULT_THRESHOLD = 80;

	private static cachedProjects: Record<string, string> | null = null;
	private static cachedVitestProjects: VitestProject[] | null = null;

	/**
	 * Creates a complete Vitest configuration by discovering workspace projects
	 * and generating appropriate settings.
	 *
	 * @param callback - Receives discovered projects, coverage config,
	 *   reporters, and CI flag; returns a Vitest config
	 * @param options - Optional configuration including coverage thresholds
	 * @returns The Vitest configuration returned by the callback
	 *
	 * @see {@link VitestConfigCallback} for the callback signature
	 * @see {@link VitestConfigCreateOptions} for available options
	 */
	static create(
		callback: VitestConfigCallback,
		options?: VitestConfigCreateOptions,
	): Promise<ViteUserConfig> | ViteUserConfig {
		const specificProject = VitestConfig.getSpecificProject();
		const { projects, vitestProjects } = VitestConfig.discoverWorkspaceProjects();
		const coverage = VitestConfig.getCoverageConfig(specificProject, projects, options);

		const isCI = Boolean(process.env.GITHUB_ACTIONS);
		const reporters = isCI ? ["default", "github-actions"] : ["default"];

		return callback({
			projects: vitestProjects,
			coverage,
			reporters,
			isCI,
		});
	}

	/**
	 * Extracts the specific project name from command line arguments.
	 *
	 * @privateRemarks
	 * Supports both `--project=value` and `--project value` formats to match
	 * Vitest's own argument parsing behavior. Only the first `--project` flag
	 * is returned; repeated flags (e.g. `--project foo --project bar`) are
	 * ignored since multi-project coverage scoping is not supported.
	 */
	private static getSpecificProject(): string | null {
		const args = process.argv;

		const projectArg = args.find((arg) => arg.startsWith("--project="));
		if (projectArg) {
			return projectArg.split("=")[1] ?? null;
		}

		const projectIndex = args.indexOf("--project");
		if (projectIndex !== -1 && projectIndex + 1 < args.length) {
			return args[projectIndex + 1] ?? null;
		}

		return null;
	}

	/**
	 * Reads the `name` field from a package's `package.json`.
	 *
	 * @privateRemarks
	 * Uses try/catch because the package.json may not exist or may be malformed.
	 * Returns `null` to signal the caller should skip this package.
	 */
	private static getPackageNameFromPath(packagePath: string): string | null {
		try {
			const content = readFileSync(join(packagePath, "package.json"), "utf8");
			return JSON.parse(content).name ?? null;
		} catch {
			return null;
		}
	}

	/**
	 * Checks whether a path is an existing directory.
	 *
	 * @privateRemarks
	 * Consolidates the repeated `statSync` + `isDirectory()` + try/catch
	 * pattern used throughout workspace discovery.
	 */
	private static isDirectory(dirPath: string): boolean {
		try {
			return statSync(dirPath).isDirectory();
		} catch {
			return false;
		}
	}

	/**
	 * Recursively scans a directory for test files and classifies them by kind.
	 *
	 * @privateRemarks
	 * Short-circuits as soon as both unit and e2e files are found, avoiding
	 * unnecessary filesystem traversal.
	 */
	private static scanForTestFiles(dirPath: string): { hasUnit: boolean; hasE2e: boolean } {
		let hasUnit = false;
		let hasE2e = false;

		try {
			const entries = readdirSync(dirPath, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.isDirectory()) {
					const sub = VitestConfig.scanForTestFiles(join(dirPath, entry.name));
					hasUnit = hasUnit || sub.hasUnit;
					hasE2e = hasE2e || sub.hasE2e;
				} else if (entry.isFile()) {
					if (/\.e2e\.(test|spec)\.ts$/.test(entry.name)) {
						hasE2e = true;
					} else if (/\.(test|spec)\.ts$/.test(entry.name)) {
						hasUnit = true;
					}
				}
				if (hasUnit && hasE2e) break;
			}
		} catch {
			// Directory unreadable or does not exist
		}

		return { hasUnit, hasE2e };
	}

	/**
	 * Builds include glob patterns for a given relative path and optional
	 * test directory.
	 */
	private static buildIncludes(srcGlob: string, testGlob: string | null, pattern: string): string[] {
		const includes = [`${srcGlob}/**/${pattern}`];
		if (testGlob) {
			includes.push(`${testGlob}/**/${pattern}`);
		}
		return includes;
	}

	/**
	 * Discovers all packages in the workspace that contain a `src/` directory
	 * and generates {@link VitestProject} instances based on filename conventions.
	 *
	 * @privateRemarks
	 * When a package has both unit and e2e test files, projects are suffixed
	 * with `:unit` and `:e2e` to disambiguate. Packages with `src/` but no
	 * test files still get a unit project entry as a forward-looking placeholder.
	 */
	private static discoverWorkspaceProjects(): {
		projects: Record<string, string>;
		vitestProjects: VitestProject[];
	} {
		if (VitestConfig.cachedProjects && VitestConfig.cachedVitestProjects) {
			return {
				projects: VitestConfig.cachedProjects,
				vitestProjects: VitestConfig.cachedVitestProjects,
			};
		}

		const cwd = process.cwd();
		const workspaceRoot = getWorkspaceManagerRoot(cwd) ?? cwd;
		const workspacePaths = getWorkspacePackagePaths(workspaceRoot) ?? [];

		const projects: Record<string, string> = {};
		const vitestProjects: VitestProject[] = [];

		for (const pkgPath of workspacePaths) {
			const packageName = VitestConfig.getPackageNameFromPath(pkgPath);
			if (!packageName) continue;

			const srcDirPath = join(pkgPath, "src");
			if (!VitestConfig.isDirectory(srcDirPath)) continue;

			const relativePath = relative(workspaceRoot, pkgPath) || ".";
			projects[packageName] = relativePath;

			const testDirPath = join(pkgPath, "__test__");
			const hasTestDir = VitestConfig.isDirectory(testDirPath);

			const srcScan = VitestConfig.scanForTestFiles(srcDirPath);
			const testScan = hasTestDir ? VitestConfig.scanForTestFiles(testDirPath) : { hasUnit: false, hasE2e: false };

			const hasUnit = srcScan.hasUnit || testScan.hasUnit;
			const hasE2e = srcScan.hasE2e || testScan.hasE2e;
			const hasBoth = hasUnit && hasE2e;

			const prefix = relativePath === "." ? "" : `${relativePath}/`;
			const srcGlob = `${prefix}src`;
			const testGlob = hasTestDir ? `${prefix}__test__` : null;

			if (hasUnit) {
				vitestProjects.push(
					VitestProject.unit({
						name: hasBoth ? `${packageName}:unit` : packageName,
						include: VitestConfig.buildIncludes(srcGlob, testGlob, "*.{test,spec}.ts"),
						overrides: {
							test: { exclude: ["**/*.e2e.{test,spec}.ts"] },
						},
					}),
				);
			}

			if (hasE2e) {
				vitestProjects.push(
					VitestProject.e2e({
						name: hasBoth ? `${packageName}:e2e` : packageName,
						include: VitestConfig.buildIncludes(srcGlob, testGlob, "*.e2e.{test,spec}.ts"),
					}),
				);
			}

			if (!hasUnit && !hasE2e) {
				// No e2e exclude needed — no e2e files were detected in this package
				vitestProjects.push(
					VitestProject.unit({
						name: packageName,
						include: VitestConfig.buildIncludes(srcGlob, testGlob, "*.{test,spec}.ts"),
					}),
				);
			}
		}

		VitestConfig.cachedProjects = projects;
		VitestConfig.cachedVitestProjects = vitestProjects;

		return { projects, vitestProjects };
	}

	/**
	 * Generates coverage configuration including thresholds.
	 *
	 * @privateRemarks
	 * Strips `:unit`/`:e2e` suffix when looking up project paths for
	 * `--project` filtering, since coverage applies to the entire package
	 * regardless of test kind.
	 */
	private static getCoverageConfig(
		specificProject: string | null,
		projects: Record<string, string>,
		options?: VitestConfigCreateOptions,
	): CoverageConfig {
		const exclude = ["**/*.{test,spec}.ts"];
		const t = VitestConfig.DEFAULT_THRESHOLD;
		const thresholds = {
			lines: options?.thresholds?.lines ?? t,
			functions: options?.thresholds?.functions ?? t,
			branches: options?.thresholds?.branches ?? t,
			statements: options?.thresholds?.statements ?? t,
		};

		const toSrcGlob = (relPath: string): string => {
			const prefix = relPath === "." ? "" : `${relPath}/`;
			return `${prefix}src/**/*.ts`;
		};

		if (specificProject) {
			const baseName = specificProject.replace(/:(unit|e2e)$/, "");
			const relPath = projects[baseName];
			if (relPath !== undefined) {
				return {
					include: [toSrcGlob(relPath)],
					exclude,
					thresholds,
				};
			}
		}

		return {
			include: Object.values(projects).map(toSrcGlob),
			exclude,
			thresholds,
		};
	}
}
