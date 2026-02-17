import { readFileSync, readdirSync, statSync } from "node:fs";
import { cpus } from "node:os";
import { join, relative } from "node:path";
import type { TestProjectInlineConfiguration, ViteUserConfig } from "vitest/config";
import { getWorkspaceManagerRoot, getWorkspacePackagePaths } from "workspace-tools";

/**
 * The kind of test a VitestProject represents.
 * @public
 */
export type VitestProjectKind = "unit" | "e2e";

/**
 * Options for constructing a VitestProject.
 * @public
 */
export interface VitestProjectOptions {
	/** The project name (typically a package name, optionally with `:unit`/`:e2e` suffix). */
	name: string;
	/** Glob patterns for test file inclusion. */
	include: string[];
	/** The test kind. Defaults to `"unit"`. */
	kind?: VitestProjectKind;
	/** Any vitest-native config fields to merge over the defaults. */
	overrides?: Partial<TestProjectInlineConfiguration>;
}

/**
 * Options for VitestConfig.create().
 * @public
 */
export interface VitestConfigCreateOptions {
	/** Coverage thresholds applied per-file. Default: 80 for all metrics. */
	thresholds?: {
		lines?: number;
		functions?: number;
		branches?: number;
		statements?: number;
	};
}

/**
 * Coverage configuration passed to the VitestConfigCallback.
 * @public
 */
export interface CoverageConfig {
	include: string[];
	exclude: string[];
	thresholds: {
		lines: number;
		functions: number;
		branches: number;
		statements: number;
	};
}

/**
 * Callback function type for VitestConfig.create() that receives configuration
 * objects and returns a Vitest configuration.
 *
 * @param config - Object containing projects, coverage, reporters, and CI flag
 * @returns Vitest user configuration (sync or async)
 * @public
 */
export type VitestConfigCallback = (config: {
	projects: VitestProject[];
	coverage: CoverageConfig;
	reporters: string[];
	isCI: boolean;
}) => ViteUserConfig | Promise<ViteUserConfig>;

/**
 * @deprecated Use `VitestProject` and `VitestProject.toConfig()` instead.
 * @public
 */
export interface VitestProjectConfig {
	extends: true;
	test: {
		name: string;
		include: string[];
		environment: string;
	};
}

const DEFAULT_THRESHOLD = 80;

/**
 * Represents a single Vitest project with sensible defaults per test kind.
 *
 * @remarks
 * Use the static factory methods `unit()`, `e2e()`, or `custom()` to create
 * instances with appropriate default timeouts and concurrency settings.
 *
 * @example
 * ```typescript
 * const unitProject = VitestProject.unit({
 *   name: "@savvy-web/my-lib",
 *   include: ["src/**\/*.test.ts"],
 * });
 *
 * const e2eProject = VitestProject.e2e({
 *   name: "@savvy-web/my-lib:e2e",
 *   include: ["test/e2e/**\/*.test.ts"],
 * });
 * ```
 * @public
 */
export class VitestProject {
	readonly #name: string;
	readonly #kind: VitestProjectKind;
	readonly #config: TestProjectInlineConfiguration;

	private constructor(options: VitestProjectOptions, defaults: Partial<TestProjectInlineConfiguration>) {
		this.#name = options.name;
		this.#kind = options.kind ?? "unit";

		const overrides = options.overrides ?? {};
		const overrideTest = overrides.test as Record<string, unknown> | undefined;

		// Build merged test config: defaults.test < overrides.test < name/include
		const defaultTest = (defaults.test ?? {}) as Record<string, unknown>;
		const mergedTest = {
			...defaultTest,
			...overrideTest,
			name: options.name,
			include: options.include,
		};

		// Build merged top-level config: defaults < overrides < extends/test
		const { test: _defaultTest, ...defaultRest } = defaults;
		const { test: _overrideTest, ...overrideRest } = overrides;
		this.#config = {
			extends: true as const,
			...defaultRest,
			...overrideRest,
			test: mergedTest,
		} as TestProjectInlineConfiguration;
	}

	/** The project name. */
	get name(): string {
		return this.#name;
	}

	/** The test kind (e.g., `"unit"` or `"e2e"`). */
	get kind(): VitestProjectKind {
		return this.#kind;
	}

	/** Returns the vitest-native `TestProjectInlineConfiguration`. */
	toConfig(): TestProjectInlineConfiguration {
		return this.#config;
	}

	/**
	 * Creates a unit test project with sensible defaults.
	 *
	 * Defaults: `extends: true`, `environment: "node"`
	 */
	static unit(options: VitestProjectOptions): VitestProject {
		return new VitestProject({ ...options, kind: "unit" }, {
			test: {
				environment: "node",
			},
		} as Partial<TestProjectInlineConfiguration>);
	}

	/**
	 * Creates an e2e test project with sensible defaults.
	 *
	 * Defaults: `extends: true`, `environment: "node"`,
	 * `testTimeout: 120_000`, `hookTimeout: 60_000`,
	 * `maxConcurrency: Math.max(1, Math.min(8, Math.floor(cpus().length / 2)))`
	 */
	static e2e(options: VitestProjectOptions): VitestProject {
		const concurrency = Math.max(1, Math.min(8, Math.floor(cpus().length / 2)));
		return new VitestProject({ ...options, kind: "e2e" }, {
			test: {
				environment: "node",
				testTimeout: 120_000,
				hookTimeout: 60_000,
				maxConcurrency: concurrency,
			},
		} as Partial<TestProjectInlineConfiguration>);
	}

	/**
	 * Creates a custom test project with no preset defaults beyond `extends: true`.
	 *
	 * @param kind - A custom kind string (stored but not used for defaults)
	 * @param options - Project options
	 */
	static custom(kind: string, options: VitestProjectOptions): VitestProject {
		return new VitestProject({ ...options, kind: kind as VitestProjectKind }, {});
	}
}

/**
 * Utility class for generating Vitest configuration in monorepo workspaces.
 *
 * @remarks
 * This class automatically discovers packages in a workspace that contain a `src/` directory
 * and generates appropriate Vitest project configurations. Tests are discovered by filename
 * convention:
 * - `*.test.ts` / `*.spec.ts` → unit tests
 * - `*.e2e.test.ts` / `*.e2e.spec.ts` → e2e tests
 *
 * It supports both running all tests and targeting specific projects via command line arguments.
 *
 * @example
 * ```typescript
 * import { VitestConfig } from "@savvy-web/vitest";
 *
 * export default VitestConfig.create(
 *   ({ projects, coverage, reporters }) => ({
 *     test: {
 *       reporters,
 *       projects: projects.map(p => p.toConfig()),
 *       coverage: { provider: "v8", ...coverage },
 *     },
 *   }),
 * );
 * ```
 * @public
 */
// biome-ignore lint/complexity/noStaticOnlyClass: This class serves as a namespace for related functionality
export class VitestConfig {
	private static cachedProjects: Record<string, string> | null = null;
	private static cachedVitestProjects: VitestProject[] | null = null;

	/**
	 * Creates a complete Vitest configuration by discovering workspace projects
	 * and generating appropriate settings.
	 *
	 * @param callback - Function that receives discovered projects, coverage config,
	 *   reporters, and CI flag, and returns a Vitest config
	 * @param options - Optional configuration including coverage thresholds
	 * @returns The Vitest configuration returned by the callback
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
	 * Supports both `--project=value` and `--project value` formats.
	 */
	private static getSpecificProject(): string | null {
		const args = process.argv;

		const projectArg = args.find((arg) => arg.startsWith("--project="));
		if (projectArg) {
			return projectArg.split("=")[1];
		}

		const projectIndex = args.indexOf("--project");
		if (projectIndex !== -1 && projectIndex + 1 < args.length) {
			return args[projectIndex + 1];
		}

		return null;
	}

	private static getPackageNameFromPath(packagePath: string): string | null {
		try {
			const packageJsonPath = join(packagePath, "package.json");
			const packageJsonContent = readFileSync(packageJsonPath, "utf8");
			const packageJson = JSON.parse(packageJsonContent);
			return packageJson.name;
		} catch {
			return null;
		}
	}

	/**
	 * Recursively scans a directory for test files and classifies them by kind.
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
					const name = entry.name;
					if (/\.e2e\.(test|spec)\.ts$/.test(name)) {
						hasE2e = true;
					} else if (/\.(test|spec)\.ts$/.test(name)) {
						hasUnit = true;
					}
				}
				if (hasUnit && hasE2e) break;
			}
		} catch {
			// Directory doesn't exist or can't be read
		}

		return { hasUnit, hasE2e };
	}

	/**
	 * Discovers all packages in the workspace that contain a `src/` directory
	 * and generates VitestProject instances based on filename conventions.
	 *
	 * Test files are classified by filename pattern:
	 * - `*.e2e.test.ts` / `*.e2e.spec.ts` → e2e project
	 * - `*.test.ts` / `*.spec.ts` → unit project
	 *
	 * When a package has both kinds, projects are suffixed with `:unit` and `:e2e`.
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

			// Check if the package has a src/ directory
			const srcDirPath = join(pkgPath, "src");
			try {
				const srcDirStats = statSync(srcDirPath);
				if (!srcDirStats.isDirectory()) continue;
			} catch {
				continue;
			}

			const relativePath = relative(workspaceRoot, pkgPath);
			projects[packageName] = relativePath;

			// Check for __test__/ directory
			const testDirPath = join(pkgPath, "__test__");
			let hasTestDir = false;
			try {
				hasTestDir = statSync(testDirPath).isDirectory();
			} catch {
				// No __test__/ directory
			}

			// Scan for test file kinds
			const srcScan = VitestConfig.scanForTestFiles(srcDirPath);
			const testScan = hasTestDir ? VitestConfig.scanForTestFiles(testDirPath) : { hasUnit: false, hasE2e: false };

			const hasUnit = srcScan.hasUnit || testScan.hasUnit;
			const hasE2e = srcScan.hasE2e || testScan.hasE2e;
			const hasBoth = hasUnit && hasE2e;

			// Build include patterns
			const srcGlob = `${relativePath}/src`;
			const testGlob = hasTestDir ? `${relativePath}/__test__` : null;

			if (hasUnit) {
				const unitIncludes = [`${srcGlob}/**/*.{test,spec}.ts`];
				if (testGlob) unitIncludes.push(`${testGlob}/**/*.{test,spec}.ts`);

				vitestProjects.push(
					VitestProject.unit({
						name: hasBoth ? `${packageName}:unit` : packageName,
						include: unitIncludes,
						overrides: {
							test: { exclude: ["**/*.e2e.{test,spec}.ts"] },
						} as Partial<TestProjectInlineConfiguration>,
					}),
				);
			}

			if (hasE2e) {
				const e2eIncludes = [`${srcGlob}/**/*.e2e.{test,spec}.ts`];
				if (testGlob) e2eIncludes.push(`${testGlob}/**/*.e2e.{test,spec}.ts`);

				vitestProjects.push(
					VitestProject.e2e({
						name: hasBoth ? `${packageName}:e2e` : packageName,
						include: e2eIncludes,
					}),
				);
			}

			// If no test files found at all, still create a unit project
			// (the package has src/ but maybe tests will be added later)
			if (!hasUnit && !hasE2e) {
				const includes = [`${srcGlob}/**/*.{test,spec}.ts`];
				if (testGlob) includes.push(`${testGlob}/**/*.{test,spec}.ts`);

				vitestProjects.push(
					VitestProject.unit({
						name: packageName,
						include: includes,
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
	 * Strips `:unit`/`:e2e` suffix when looking up project paths for
	 * `--project` filtering.
	 */
	private static getCoverageConfig(
		specificProject: string | null,
		projects: Record<string, string>,
		options?: VitestConfigCreateOptions,
	): CoverageConfig {
		const exclude = ["**/*.{test,spec}.ts"];
		const thresholds = {
			lines: options?.thresholds?.lines ?? DEFAULT_THRESHOLD,
			functions: options?.thresholds?.functions ?? DEFAULT_THRESHOLD,
			branches: options?.thresholds?.branches ?? DEFAULT_THRESHOLD,
			statements: options?.thresholds?.statements ?? DEFAULT_THRESHOLD,
		};

		if (specificProject) {
			// Strip :unit or :e2e suffix for project lookup
			const baseName = specificProject.replace(/:(unit|e2e)$/, "");
			if (baseName in projects) {
				const relPath = projects[baseName];
				return {
					include: [`${relPath}/src/**/*.ts`],
					exclude,
					thresholds,
				};
			}
		}

		const relativePaths = Object.values(projects);
		return {
			include: relativePaths.map((relPath) => `${relPath}/src/**/*.ts`),
			exclude,
			thresholds,
		};
	}
}
