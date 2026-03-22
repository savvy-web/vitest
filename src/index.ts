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
 * export default VitestConfig.create();
 * ```
 *
 * @packageDocumentation
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { cpus } from "node:os";
import { join, relative } from "node:path";
import type { TestProjectInlineConfiguration, ViteUserConfig } from "vitest/config";

export type { TestProjectInlineConfiguration } from "vitest/config";

import { AgentPlugin } from "vitest-agent-reporter";
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
export type VitestProjectKind = "unit" | "e2e" | "int" | (string & {});

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
 * Configuration options for the agent reporter plugin.
 *
 * @see {@link VitestConfigOptions.agentReporter}
 *
 * @public
 */
export interface AgentReporterConfig {
	/** @defaultValue "own" */
	consoleStrategy?: "own" | "complement";
	/** @defaultValue 10 */
	coverageConsoleLimit?: number;
	/** @defaultValue true */
	omitPassingTests?: boolean;
	/** @defaultValue false */
	includeBareZero?: boolean;
}

/**
 * Override for a specific test kind (unit, e2e, int).
 *
 * @remarks
 * When an object is provided, it is merged into every project of that kind.
 * When a callback is provided, it receives a Map of project name to
 * {@link VitestProject} for fine-grained per-project mutation.
 *
 * @public
 */
export type KindOverride =
	| Partial<TestProjectInlineConfiguration["test"]>
	| ((projects: Map<string, VitestProject>) => void);

/**
 * Options for {@link VitestConfig.create}.
 *
 * @public
 */
export interface VitestConfigOptions {
	/**
	 * Coverage level name or explicit thresholds object.
	 *
	 * @remarks
	 * When a {@link CoverageLevelName} string is provided, the corresponding
	 * preset from {@link VitestConfig.COVERAGE_LEVELS} is used. When a
	 * {@link CoverageThresholds} object is provided, it is used directly.
	 *
	 * @defaultValue `"strict"` (lines: 80, branches: 75, functions: 80, statements: 80)
	 */
	coverage?: CoverageLevelName | CoverageThresholds;

	/** Additional glob patterns to exclude from coverage reporting. */
	coverageExclude?: string[];

	/**
	 * Whether to inject the vitest-agent-reporter plugin.
	 *
	 * @remarks
	 * When `true` or an {@link AgentReporterConfig} object, the plugin is
	 * injected with the given options. When `false`, the plugin is not injected.
	 *
	 * @defaultValue `true`
	 */
	agentReporter?: boolean | AgentReporterConfig;

	/**
	 * Vitest pool mode.
	 *
	 * @defaultValue Uses Vitest's default (threads)
	 */
	pool?: "threads" | "forks" | "vmThreads" | "vmForks";

	/** Override configuration for all unit test projects. */
	unit?: KindOverride;

	/** Override configuration for all e2e test projects. */
	e2e?: KindOverride;

	/** Override configuration for all integration test projects. */
	int?: KindOverride;
}

/**
 * Post-process callback for escape-hatch customization of the assembled config.
 *
 * @param config - The assembled Vitest configuration
 * @returns A replacement config, or void to use the mutated original
 *
 * @public
 */
export type PostProcessCallback = (config: ViteUserConfig) => ViteUserConfig | undefined;

/**
 * Coverage thresholds with all four metrics required.
 *
 * @public
 */
export interface CoverageThresholds {
	/** Minimum line coverage percentage. */
	lines: number;
	/** Minimum function coverage percentage. */
	functions: number;
	/** Minimum branch coverage percentage. */
	branches: number;
	/** Minimum statement coverage percentage. */
	statements: number;
}

/**
 * Named coverage level presets available on {@link VitestConfig.COVERAGE_LEVELS}.
 *
 * @public
 */
export type CoverageLevelName = "none" | "basic" | "standard" | "strict" | "full";

/**
 * Coverage configuration used internally by {@link VitestConfig}.
 *
 * @internal
 */
interface CoverageConfig {
	/** Glob patterns for files to include in coverage reporting. */
	include: string[];

	/** Glob patterns for files to exclude from coverage reporting. */
	exclude: string[];

	/** Resolved coverage thresholds with all metrics populated. */
	thresholds: CoverageThresholds;
}

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
	#config: TestProjectInlineConfiguration;
	readonly #coverageExcludes: string[] = [];

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
	 * Coverage exclusion patterns accumulated via {@link addCoverageExclude}.
	 *
	 * @remarks
	 * These patterns are not embedded in the inline project config but are
	 * made available for the workspace-level coverage configuration to consume.
	 */
	get coverageExcludes(): readonly string[] {
		return this.#coverageExcludes;
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
	 * Creates a clone of this project with independent config state.
	 *
	 * @remarks
	 * The clone has its own config object so mutations via
	 * {@link override}, {@link addInclude}, {@link addExclude}, and
	 * {@link addCoverageExclude} do not affect the original.
	 *
	 * @returns A new {@link VitestProject} with the same configuration
	 */
	clone(): VitestProject {
		const { test, ...rest } = this.#config;
		const cloned = new VitestProject({ name: this.#name, include: test?.include ?? [], kind: this.#kind }, {});
		cloned.#config = { ...rest, test: test ? { ...test } : undefined } as TestProjectInlineConfiguration;
		cloned.#coverageExcludes.push(...this.#coverageExcludes);
		return cloned;
	}

	/**
	 * Merges additional configuration over the current config.
	 *
	 * @remarks
	 * The {@link VitestProjectOptions.name | name} and
	 * {@link VitestProjectOptions.include | include} fields are preserved
	 * and cannot be overridden.
	 *
	 * @param config - Partial configuration to merge
	 * @returns `this` for chaining
	 */
	override(config: Partial<TestProjectInlineConfiguration>): this {
		const { test: overrideTest, ...overrideRest } = config;
		const { test: existingTest, ...existingRest } = this.#config;

		this.#config = {
			...existingRest,
			...overrideRest,
			test: {
				...existingTest,
				...overrideTest,
				name: this.#name,
				include: existingTest?.include,
			},
		} as TestProjectInlineConfiguration;

		return this;
	}

	/**
	 * Appends glob patterns to the test include list.
	 *
	 * @param patterns - Glob patterns to add
	 * @returns `this` for chaining
	 */
	addInclude(...patterns: string[]): this {
		const { test: existingTest, ...rest } = this.#config;
		this.#config = {
			...rest,
			test: { ...existingTest, include: [...(existingTest?.include ?? []), ...patterns] },
		} as TestProjectInlineConfiguration;
		return this;
	}

	/**
	 * Appends glob patterns to the test exclude list.
	 *
	 * @param patterns - Glob patterns to add
	 * @returns `this` for chaining
	 */
	addExclude(...patterns: string[]): this {
		const { test: existingTest, ...rest } = this.#config;
		this.#config = {
			...rest,
			test: { ...existingTest, exclude: [...(existingTest?.exclude ?? []), ...patterns] },
		} as TestProjectInlineConfiguration;
		return this;
	}

	/**
	 * Appends glob patterns to the coverage exclusion list.
	 *
	 * @remarks
	 * These patterns are exposed via {@link coverageExcludes} for the
	 * workspace-level coverage configuration to consume.
	 *
	 * @param patterns - Glob patterns to exclude from coverage
	 * @returns `this` for chaining
	 */
	addCoverageExclude(...patterns: string[]): this {
		this.#coverageExcludes.push(...patterns);
		return this;
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
	 * Creates an integration test project with sensible defaults.
	 *
	 * @remarks
	 * Defaults applied: `extends: true`, `environment: "node"`,
	 * `testTimeout: 60_000`, `hookTimeout: 30_000`,
	 * `maxConcurrency: clamp(floor(cpus / 2), 1, 8)`.
	 *
	 * @param options - Project options (the `kind` field is forced to `"int"`)
	 * @returns A new {@link VitestProject} configured for integration tests
	 *
	 * @example
	 * ```typescript
	 * import { VitestProject } from "@savvy-web/vitest";
	 *
	 * const project = VitestProject.int({
	 *   name: "@savvy-web/my-lib:int",
	 *   include: ["__test__/integration/**\/*.int.test.ts"],
	 * });
	 * ```
	 */
	static int(options: VitestProjectOptions): VitestProject {
		const concurrency = Math.max(1, Math.min(8, Math.floor(cpus().length / 2)));
		return new VitestProject(
			{ ...options, kind: "int" },
			{
				test: {
					environment: "node",
					testTimeout: 60_000,
					hookTimeout: 30_000,
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
 * export default VitestConfig.create();
 * ```
 *
 * @public
 */
// biome-ignore lint/complexity/noStaticOnlyClass: Intentional namespace pattern for related functionality with shared cached state
export class VitestConfig {
	/** Default glob patterns excluded from coverage reporting. */
	private static readonly DEFAULT_COVERAGE_EXCLUDE = [
		"**/*.{test,spec}.{ts,tsx,js,jsx}",
		"**/__test__/**",
		"**/generated/**",
	];

	/**
	 * Named coverage level presets.
	 *
	 * @remarks
	 * Use a level name with the `coverage` option in {@link VitestConfig.create}
	 * to apply a preset. The object is frozen and cannot be mutated.
	 *
	 * | Level    | lines | branches | functions | statements |
	 * | -------- | ----- | -------- | --------- | ---------- |
	 * | none     | 0     | 0        | 0         | 0          |
	 * | basic    | 50    | 50       | 50        | 50         |
	 * | standard | 70    | 65       | 70        | 70         |
	 * | strict   | 80    | 75       | 80        | 80         |
	 * | full     | 90    | 85       | 90        | 90         |
	 */
	static readonly COVERAGE_LEVELS: Readonly<Record<CoverageLevelName, CoverageThresholds>> = Object.freeze({
		none: { lines: 0, branches: 0, functions: 0, statements: 0 },
		basic: { lines: 50, branches: 50, functions: 50, statements: 50 },
		standard: { lines: 70, branches: 65, functions: 70, statements: 70 },
		strict: { lines: 80, branches: 75, functions: 80, statements: 80 },
		full: { lines: 90, branches: 85, functions: 90, statements: 90 },
	});

	private static cachedProjects: Record<string, string> | null = null;
	private static cachedVitestProjects: VitestProject[] | null = null;

	/**
	 * Creates a complete Vitest configuration by discovering workspace projects
	 * and generating appropriate settings.
	 *
	 * @param options - Optional declarative configuration
	 * @param postProcess - Optional escape-hatch callback for full config control
	 * @returns The assembled Vitest configuration
	 *
	 * @see {@link VitestConfigOptions} for available options
	 * @see {@link PostProcessCallback} for the post-process callback signature
	 */
	static async create(options?: VitestConfigOptions, postProcess?: PostProcessCallback): Promise<ViteUserConfig> {
		const specificProjects = VitestConfig.getSpecificProjects();
		const { projects, vitestProjects } = VitestConfig.discoverWorkspaceProjects();
		const thresholds = VitestConfig.resolveThresholds(options);
		const coverageConfig = VitestConfig.getCoverageConfig(specificProjects, projects, options);

		// Clone cached projects to avoid mutating cached state
		const workingProjects = vitestProjects.map((p) => p.clone());

		// Apply kind overrides to working copies
		VitestConfig.applyKindOverrides(workingProjects, options);

		// Build reporters
		const isCI = Boolean(process.env.GITHUB_ACTIONS);
		const reporters: string[] = isCI ? ["default", "github-actions"] : ["default"];

		// Assemble config
		let config: ViteUserConfig = {
			test: {
				reporters,
				projects: workingProjects.map((p) => p.toConfig()),
				...(options?.pool ? { pool: options.pool } : {}),
				coverage: {
					provider: "v8",
					...coverageConfig,
					enabled: true,
				},
			},
		};

		// Inject AgentPlugin
		if (options?.agentReporter !== false) {
			const coverageThreshold = Math.min(
				thresholds.lines,
				thresholds.branches,
				thresholds.functions,
				thresholds.statements,
			);

			const agentOpts = typeof options?.agentReporter === "object" ? options.agentReporter : {};

			const plugin = AgentPlugin({
				consoleStrategy: agentOpts.consoleStrategy ?? "own",
				reporter: {
					coverageThreshold,
					coverageConsoleLimit: agentOpts.coverageConsoleLimit,
					omitPassingTests: agentOpts.omitPassingTests,
					includeBareZero: agentOpts.includeBareZero,
				},
			});

			config.plugins = [plugin];
		}

		// Post-process escape hatch
		if (postProcess) {
			const result = postProcess(config);
			if (result !== undefined) {
				config = result;
			}
		}

		return config;
	}

	/**
	 * Applies kind-specific overrides to discovered projects.
	 *
	 * @privateRemarks
	 * When the override is an object, it is merged into every project of the
	 * matching kind. When it is a callback, it receives a Map of project name
	 * to {@link VitestProject} for fine-grained per-project mutation.
	 */
	private static applyKindOverrides(vitestProjects: VitestProject[], options?: VitestConfigOptions): void {
		if (!options) return;

		const kindOptions: Record<string, KindOverride | undefined> = {
			unit: options.unit,
			e2e: options.e2e,
			int: options.int,
		};

		for (const [kind, override] of Object.entries(kindOptions)) {
			if (override === undefined) continue;

			const projectsOfKind = vitestProjects.filter((p) => p.kind === kind);

			if (typeof override === "function") {
				const map = new Map<string, VitestProject>();
				for (const p of projectsOfKind) {
					map.set(p.name, p);
				}
				override(map);
			} else {
				for (const p of projectsOfKind) {
					p.override({ test: override });
				}
			}
		}
	}

	/**
	 * Extracts all specific project names from command line arguments.
	 *
	 * @privateRemarks
	 * Supports both `--project=value` and `--project value` formats to match
	 * Vitest's own argument parsing behavior. All `--project` flags are
	 * collected to support multi-project coverage scoping.
	 */
	private static getSpecificProjects(): string[] {
		const args = process.argv;
		const projects: string[] = [];

		for (let i = 0; i < args.length; i++) {
			const arg = args[i];
			if (arg.startsWith("--project=")) {
				const value = arg.split("=")[1];
				if (value) projects.push(value);
			} else if (arg === "--project" && i + 1 < args.length) {
				const value = args[i + 1];
				if (value) projects.push(value);
				i++; // skip next arg
			}
		}

		return projects;
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

	/** Extensions probed (in order) when detecting a setup file. */
	private static readonly SETUP_FILE_EXTENSIONS = ["ts", "tsx", "js", "jsx"] as const;

	/**
	 * Detects a `vitest.setup.{ts,tsx,js,jsx}` file at the package root.
	 *
	 * @privateRemarks
	 * First match wins. Returns just the filename (e.g. `"vitest.setup.ts"`)
	 * so the caller can prepend the relative prefix as needed.
	 */
	private static detectSetupFile(packagePath: string): string | null {
		for (const ext of VitestConfig.SETUP_FILE_EXTENSIONS) {
			const candidate = join(packagePath, `vitest.setup.${ext}`);
			try {
				const stat = statSync(candidate);
				if (stat.isFile()) return `vitest.setup.${ext}`;
			} catch {}
		}
		return null;
	}

	/**
	 * Recursively scans a directory for test files and classifies them by kind.
	 *
	 * @privateRemarks
	 * Short-circuits as soon as all three kinds (unit, e2e, and int) are
	 * found, avoiding unnecessary filesystem traversal.
	 */
	private static scanForTestFiles(dirPath: string): { hasUnit: boolean; hasE2e: boolean; hasInt: boolean } {
		let hasUnit = false;
		let hasE2e = false;
		let hasInt = false;

		try {
			const entries = readdirSync(dirPath, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.isDirectory()) {
					const sub = VitestConfig.scanForTestFiles(join(dirPath, entry.name));
					hasUnit = hasUnit || sub.hasUnit;
					hasE2e = hasE2e || sub.hasE2e;
					hasInt = hasInt || sub.hasInt;
				} else if (entry.isFile()) {
					if (/\.e2e\.(test|spec)\.(ts|tsx|js|jsx)$/.test(entry.name)) {
						hasE2e = true;
					} else if (/\.int\.(test|spec)\.(ts|tsx|js|jsx)$/.test(entry.name)) {
						hasInt = true;
					} else if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(entry.name)) {
						hasUnit = true;
					}
				}
				if (hasUnit && hasE2e && hasInt) break;
			}
		} catch {
			// Directory unreadable or does not exist
		}

		return { hasUnit, hasE2e, hasInt };
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
	 * Conventional subdirectories under `__test__/` that hold helpers, not
	 * test files, and should be excluded from test discovery.
	 */
	private static readonly TEST_DIR_EXCLUSIONS = [
		"__test__/fixtures/**",
		"__test__/utils/**",
		"__test__/unit/fixtures/**",
		"__test__/unit/utils/**",
		"__test__/e2e/fixtures/**",
		"__test__/e2e/utils/**",
		"__test__/int/fixtures/**",
		"__test__/int/utils/**",
		"__test__/integration/fixtures/**",
		"__test__/integration/utils/**",
	];

	/**
	 * Returns exclusion patterns for fixture/utils directories under
	 * `__test__/`, scoped to the given package prefix.
	 *
	 * @param prefix - Either `"<relativePath>/"` for non-root packages or
	 *   `""` for the workspace root.
	 */
	private static buildTestDirExclusions(prefix: string): string[] {
		return VitestConfig.TEST_DIR_EXCLUSIONS.map((pattern) => `${prefix}${pattern}`);
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
			const testScan = hasTestDir
				? VitestConfig.scanForTestFiles(testDirPath)
				: { hasUnit: false, hasE2e: false, hasInt: false };

			const hasUnit = srcScan.hasUnit || testScan.hasUnit;
			const hasE2e = srcScan.hasE2e || testScan.hasE2e;
			const hasInt = srcScan.hasInt || testScan.hasInt;
			const kindCount = [hasUnit, hasE2e, hasInt].filter(Boolean).length;
			const shouldSuffix = kindCount >= 2;

			const prefix = relativePath === "." ? "" : `${relativePath}/`;
			const srcGlob = `${prefix}src`;
			const testGlob = hasTestDir ? `${prefix}__test__` : null;

			const testDirExcludes = hasTestDir ? VitestConfig.buildTestDirExclusions(prefix) : [];

			const setupFile = VitestConfig.detectSetupFile(pkgPath);
			const setupFiles = setupFile ? [`${prefix}${setupFile}`] : undefined;

			if (hasUnit) {
				vitestProjects.push(
					VitestProject.unit({
						name: shouldSuffix ? `${packageName}:unit` : packageName,
						include: VitestConfig.buildIncludes(srcGlob, testGlob, "*.{test,spec}.{ts,tsx,js,jsx}"),
						overrides: {
							test: {
								...(setupFiles ? { setupFiles } : {}),
								exclude: ["**/*.e2e.{test,spec}.*", "**/*.int.{test,spec}.*", ...testDirExcludes],
							},
						},
					}),
				);
			}

			if (hasE2e) {
				vitestProjects.push(
					VitestProject.e2e({
						name: shouldSuffix ? `${packageName}:e2e` : packageName,
						include: VitestConfig.buildIncludes(srcGlob, testGlob, "*.e2e.{test,spec}.{ts,tsx,js,jsx}"),
						overrides: {
							test: {
								...(setupFiles ? { setupFiles } : {}),
								exclude: [...testDirExcludes],
							},
						},
					}),
				);
			}

			if (hasInt) {
				vitestProjects.push(
					VitestProject.int({
						name: shouldSuffix ? `${packageName}:int` : packageName,
						include: VitestConfig.buildIncludes(srcGlob, testGlob, "*.int.{test,spec}.{ts,tsx,js,jsx}"),
						overrides: {
							test: {
								...(setupFiles ? { setupFiles } : {}),
								exclude: [...testDirExcludes],
							},
						},
					}),
				);
			}

			if (!hasUnit && !hasE2e && !hasInt) {
				// No test files detected — create a forward-looking placeholder
				vitestProjects.push(
					VitestProject.unit({
						name: packageName,
						include: VitestConfig.buildIncludes(srcGlob, testGlob, "*.{test,spec}.{ts,tsx,js,jsx}"),
						overrides: {
							test: {
								...(setupFiles ? { setupFiles } : {}),
								exclude: [...testDirExcludes],
							},
						},
					}),
				);
			}
		}

		VitestConfig.cachedProjects = projects;
		VitestConfig.cachedVitestProjects = vitestProjects;

		return { projects, vitestProjects };
	}

	/**
	 * Resolves coverage thresholds from options.
	 *
	 * @privateRemarks
	 * Priority: `options.coverage` (name or object) \> `COVERAGE_LEVELS.strict`.
	 */
	private static resolveThresholds(options?: VitestConfigOptions): CoverageThresholds {
		if (options?.coverage === undefined) {
			return { ...VitestConfig.COVERAGE_LEVELS.strict };
		}
		if (typeof options.coverage === "string") {
			return { ...VitestConfig.COVERAGE_LEVELS[options.coverage] };
		}
		return { ...options.coverage };
	}

	/**
	 * Generates coverage configuration including thresholds.
	 *
	 * @privateRemarks
	 * Strips `:unit`/`:e2e`/`:int` suffix when looking up project paths for
	 * `--project` filtering, since coverage applies to the entire package
	 * regardless of test kind. When multiple `--project` flags are provided,
	 * coverage includes are unioned across all matched packages.
	 */
	private static getCoverageConfig(
		specificProjects: string[],
		projects: Record<string, string>,
		options?: VitestConfigOptions,
	): CoverageConfig {
		const exclude = [...VitestConfig.DEFAULT_COVERAGE_EXCLUDE, ...(options?.coverageExclude ?? [])];
		const thresholds = VitestConfig.resolveThresholds(options);

		const toSrcGlob = (relPath: string): string => {
			const prefix = relPath === "." ? "" : `${relPath}/`;
			return `${prefix}src/**/*.ts`;
		};

		if (specificProjects.length > 0) {
			const includes: string[] = [];
			for (const sp of specificProjects) {
				const baseName = sp.replace(/:(unit|e2e|int)$/, "");
				const relPath = projects[baseName];
				if (relPath !== undefined) {
					includes.push(toSrcGlob(relPath));
				}
			}
			if (includes.length > 0) {
				return { include: includes, exclude, thresholds };
			}
		}

		return {
			include: Object.values(projects).map(toSrcGlob),
			exclude,
			thresholds,
		};
	}
}
