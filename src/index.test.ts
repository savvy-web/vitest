import type { Dirent, Stats } from "node:fs";
import { cpus } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestProjectInlineConfiguration, ViteUserConfig } from "vitest/config";
import { VitestConfig, VitestProject } from "./index.js";

const { mockAgentPlugin } = vi.hoisted(() => ({
	mockAgentPlugin: vi.fn((_opts?: unknown) => ({ name: "vitest-agent-reporter" })),
}));

vi.mock("vitest-agent-reporter", () => ({
	AgentPlugin: (opts: unknown) => mockAgentPlugin(opts),
}));

// Mock workspace-tools
const mockGetRoot = vi.fn(() => "/mock/workspace");
const mockGetPaths = vi.fn<() => string[]>(() => []);

vi.mock("workspace-tools", () => ({
	getWorkspaceManagerRoot: () => mockGetRoot(),
	getWorkspacePackagePaths: () => mockGetPaths(),
}));

// Mock node:fs
const mockReadFileSync = vi.fn();
const mockStatSync = vi.fn();
const mockReaddirSync = vi.fn();

vi.mock("node:fs", async (importOriginal) => {
	const original = await importOriginal<typeof import("node:fs")>();
	return {
		...original,
		readFileSync: (...args: Parameters<typeof original.readFileSync>) => mockReadFileSync(...args),
		statSync: (...args: Parameters<typeof original.statSync>) => mockStatSync(...args),
		readdirSync: (...args: Parameters<typeof original.readdirSync>) => mockReaddirSync(...args),
	};
});

/** Helper to create a mock Dirent */
function dirent(name: string, type: "file" | "directory"): Dirent {
	return {
		name,
		isFile: () => type === "file",
		isDirectory: () => type === "directory",
		isBlockDevice: () => false,
		isCharacterDevice: () => false,
		isFIFO: () => false,
		isSocket: () => false,
		isSymbolicLink: () => false,
	} as Dirent;
}

/** Helper to reset VitestConfig caches */
function resetCache(): void {
	const config = VitestConfig as unknown as Record<string, unknown>;
	config.cachedProjects = null;
	config.cachedVitestProjects = null;
}

/** Helper to extract projects from returned config */
function extractProjects(config: ViteUserConfig): TestProjectInlineConfiguration[] {
	const test = config.test as Record<string, unknown>;
	return (test?.projects ?? []) as TestProjectInlineConfiguration[];
}

/**
 * Configure mocks for a workspace with the given packages.
 *
 * Each package entry describes its directory layout:
 * - `name`: package.json name
 * - `path`: absolute path
 * - `hasSrc`: whether src/ directory exists
 * - `hasTestDir`: whether __test__/ directory exists
 * - `srcFiles`: file names in src/ (e.g., ["foo.test.ts", "bar.e2e.test.ts"])
 * - `testFiles`: file names in __test__/ (if hasTestDir)
 * - `setupFile`: setup file name at package root (e.g., "vitest.setup.ts")
 */
function setupWorkspace(
	packages: Array<{
		name: string;
		path: string;
		hasSrc?: boolean;
		hasTestDir?: boolean;
		srcFiles?: string[];
		testFiles?: string[];
		setupFile?: string;
	}>,
): void {
	mockGetPaths.mockReturnValue(packages.map((p) => p.path));

	mockReadFileSync.mockImplementation((filePath: string) => {
		for (const pkg of packages) {
			if (filePath === `${pkg.path}/package.json`) {
				return JSON.stringify({ name: pkg.name });
			}
		}
		throw new Error(`ENOENT: ${filePath}`);
	});

	mockStatSync.mockImplementation((filePath: string) => {
		for (const pkg of packages) {
			if (filePath === `${pkg.path}/src` && pkg.hasSrc !== false) {
				return { isDirectory: () => true, isFile: () => false } as Stats;
			}
			if (filePath === `${pkg.path}/__test__` && pkg.hasTestDir) {
				return { isDirectory: () => true, isFile: () => false } as Stats;
			}
			if (pkg.setupFile && filePath === `${pkg.path}/${pkg.setupFile}`) {
				return { isDirectory: () => false, isFile: () => true } as Stats;
			}
		}
		throw new Error(`ENOENT: ${filePath}`);
	});

	mockReaddirSync.mockImplementation((dirPath: string) => {
		for (const pkg of packages) {
			if (dirPath === `${pkg.path}/src`) {
				return (pkg.srcFiles ?? []).map((f) => dirent(f, "file"));
			}
			if (dirPath === `${pkg.path}/__test__`) {
				return (pkg.testFiles ?? []).map((f) => dirent(f, "file"));
			}
		}
		return [];
	});
}

describe("VitestProject", () => {
	describe("unit()", () => {
		it("should create a unit project with default environment", () => {
			const project = VitestProject.unit({
				name: "@savvy-web/my-lib",
				include: ["src/**/*.test.ts"],
			});

			expect(project.name).toBe("@savvy-web/my-lib");
			expect(project.kind).toBe("unit");

			const config = project.toConfig();
			expect(config.extends).toBe(true);
			expect(config.test).toMatchObject({
				name: "@savvy-web/my-lib",
				include: ["src/**/*.test.ts"],
				environment: "node",
			});
		});

		it("should merge overrides over defaults", () => {
			const project = VitestProject.unit({
				name: "@savvy-web/my-lib",
				include: ["src/**/*.test.ts"],
				overrides: {
					test: { environment: "jsdom" },
				},
			});

			const config = project.toConfig();
			expect(config.test).toMatchObject({
				name: "@savvy-web/my-lib",
				include: ["src/**/*.test.ts"],
				environment: "jsdom",
			});
		});

		it("should merge top-level overrides", () => {
			const project = VitestProject.unit({
				name: "@savvy-web/my-lib",
				include: ["src/**/*.test.ts"],
				overrides: {
					resolve: { alias: { "@": "/src" } },
				},
			});

			const config = project.toConfig();
			expect(config).toHaveProperty("resolve");
			expect((config as Record<string, unknown>).resolve).toEqual({ alias: { "@": "/src" } });
		});

		it("should ensure name and include always win over overrides", () => {
			const project = VitestProject.unit({
				name: "@savvy-web/my-lib",
				include: ["src/**/*.test.ts"],
				overrides: {
					test: {
						name: "should-be-overridden",
						include: ["should-be-overridden/**"],
					},
				},
			});

			const config = project.toConfig();
			expect(config.test?.name).toBe("@savvy-web/my-lib");
			expect(config.test?.include).toEqual(["src/**/*.test.ts"]);
		});
	});

	describe("e2e()", () => {
		it("should create an e2e project with timeout defaults", () => {
			const project = VitestProject.e2e({
				name: "@savvy-web/my-lib:e2e",
				include: ["test/e2e/**/*.test.ts"],
			});

			expect(project.name).toBe("@savvy-web/my-lib:e2e");
			expect(project.kind).toBe("e2e");

			const config = project.toConfig();
			expect(config.extends).toBe(true);
			expect(config.test).toMatchObject({
				name: "@savvy-web/my-lib:e2e",
				include: ["test/e2e/**/*.test.ts"],
				environment: "node",
				testTimeout: 120_000,
				hookTimeout: 60_000,
			});
		});

		it("should set maxConcurrency based on CPU count", () => {
			const config = VitestProject.e2e({
				name: "test",
				include: ["**/*.test.ts"],
			}).toConfig();

			const expected = Math.max(1, Math.min(8, Math.floor(cpus().length / 2)));
			expect(config.test?.maxConcurrency).toBe(expected);
		});

		it("should allow overriding e2e timeout defaults", () => {
			const config = VitestProject.e2e({
				name: "test",
				include: ["**/*.test.ts"],
				overrides: {
					test: { testTimeout: 60_000 },
				},
			}).toConfig();

			expect(config.test?.testTimeout).toBe(60_000);
			expect(config.test?.hookTimeout).toBe(60_000);
		});
	});

	describe("int()", () => {
		it("should create an integration project with timeout defaults", () => {
			const project = VitestProject.int({
				name: "@savvy-web/my-lib:int",
				include: ["__test__/integration/**/*.int.test.ts"],
			});

			expect(project.name).toBe("@savvy-web/my-lib:int");
			expect(project.kind).toBe("int");

			const config = project.toConfig();
			expect(config.extends).toBe(true);
			expect(config.test).toMatchObject({
				name: "@savvy-web/my-lib:int",
				include: ["__test__/integration/**/*.int.test.ts"],
				environment: "node",
				testTimeout: 60_000,
				hookTimeout: 30_000,
			});
		});

		it("should set maxConcurrency based on CPU count", () => {
			const config = VitestProject.int({
				name: "test",
				include: ["**/*.int.test.ts"],
			}).toConfig();

			const expected = Math.max(1, Math.min(8, Math.floor(cpus().length / 2)));
			expect(config.test?.maxConcurrency).toBe(expected);
		});

		it("should allow overriding int timeout defaults", () => {
			const config = VitestProject.int({
				name: "test",
				include: ["**/*.int.test.ts"],
				overrides: {
					test: { testTimeout: 30_000 },
				},
			}).toConfig();

			expect(config.test?.testTimeout).toBe(30_000);
			expect(config.test?.hookTimeout).toBe(30_000);
		});
	});

	describe("mutation methods", () => {
		it("should override config via override()", () => {
			const project = VitestProject.unit({
				name: "test",
				include: ["**/*.test.ts"],
			});

			const result = project.override({
				test: { environment: "jsdom" },
			});

			expect(result).toBe(project); // chainable
			const config = project.toConfig();
			expect(config.test?.environment).toBe("jsdom");
		});

		it("should add include patterns via addInclude()", () => {
			const project = VitestProject.unit({
				name: "test",
				include: ["src/**/*.test.ts"],
			});

			project.addInclude("lib/**/*.test.ts");

			const config = project.toConfig();
			expect(config.test?.include).toEqual(["src/**/*.test.ts", "lib/**/*.test.ts"]);
		});

		it("should add exclude patterns via addExclude()", () => {
			const project = VitestProject.unit({
				name: "test",
				include: ["**/*.test.ts"],
			});

			project.addExclude("**/legacy/**");

			const config = project.toConfig();
			expect(config.test?.exclude).toContain("**/legacy/**");
		});

		it("should add coverage exclude patterns via addCoverageExclude()", () => {
			const project = VitestProject.unit({
				name: "test",
				include: ["**/*.test.ts"],
			});

			project.addCoverageExclude("src/generated/**", "src/legacy/**");

			expect(project.coverageExcludes).toEqual(["src/generated/**", "src/legacy/**"]);
		});

		it("should chain multiple mutations", () => {
			const project = VitestProject.unit({
				name: "test",
				include: ["**/*.test.ts"],
			});

			project
				.override({ test: { environment: "jsdom" } })
				.addExclude("**/legacy/**")
				.addCoverageExclude("src/generated/**");

			const config = project.toConfig();
			expect(config.test?.environment).toBe("jsdom");
			expect(config.test?.exclude).toContain("**/legacy/**");
			expect(project.coverageExcludes).toEqual(["src/generated/**"]);
		});
	});

	describe("custom()", () => {
		it("should create a project with no preset defaults", () => {
			const project = VitestProject.custom("integration", {
				name: "my-integration",
				include: ["test/integration/**/*.test.ts"],
			});

			expect(project.name).toBe("my-integration");
			expect(project.kind).toBe("integration");

			const config = project.toConfig();
			expect(config.extends).toBe(true);
			expect(config.test).toMatchObject({
				name: "my-integration",
				include: ["test/integration/**/*.test.ts"],
			});
			expect(config.test?.environment).toBeUndefined();
		});
	});
});

describe("VitestConfig", () => {
	afterEach(() => {
		resetCache();
		vi.restoreAllMocks();
	});

	describe("create() declarative API", () => {
		beforeEach(() => {
			setupWorkspace([]);
			mockAgentPlugin.mockClear();
		});

		it("should work with no arguments", async () => {
			const result = await VitestConfig.create();
			expect(result).toBeDefined();
			expect(result.test).toBeDefined();
		});

		it("should always enable v8 coverage", async () => {
			const result = await VitestConfig.create();
			const test = result.test as Record<string, unknown>;
			const coverage = test.coverage as Record<string, unknown>;
			expect(coverage.provider).toBe("v8");
			expect(coverage.enabled).toBe(true);
		});

		it("should inject AgentPlugin by default", async () => {
			const result = await VitestConfig.create();
			expect(result.plugins).toHaveLength(1);
			expect(mockAgentPlugin).toHaveBeenCalledOnce();
			expect(mockAgentPlugin).toHaveBeenCalledWith(expect.objectContaining({ strategy: "own" }));
		});

		it("should pass full coverageThresholds object", async () => {
			await VitestConfig.create({ coverage: "standard" });
			expect(mockAgentPlugin).toHaveBeenCalledWith(
				expect.objectContaining({
					reporter: expect.objectContaining({
						coverageThresholds: { lines: 70, branches: 65, functions: 70, statements: 70 },
					}),
				}),
			);
		});

		it("should not inject plugin when agentReporter is false", async () => {
			const result = await VitestConfig.create({ agentReporter: false });
			expect(result.plugins ?? []).toHaveLength(0);
			expect(mockAgentPlugin).not.toHaveBeenCalled();
		});

		it("should pass custom agent reporter options", async () => {
			await VitestConfig.create({
				agentReporter: { strategy: "complement", reporter: { coverageConsoleLimit: 5 } },
			});
			expect(mockAgentPlugin).toHaveBeenCalledWith(
				expect.objectContaining({
					strategy: "complement",
					reporter: expect.objectContaining({ coverageConsoleLimit: 5 }),
				}),
			);
		});

		it("should set pool when specified", async () => {
			const result = await VitestConfig.create({ pool: "threads" });
			const test = result.test as Record<string, unknown>;
			expect(test.pool).toBe("threads");
		});

		it("should include default coverage excludes plus custom", async () => {
			const result = await VitestConfig.create({
				coverageExclude: ["src/legacy/**"],
			});
			const test = result.test as Record<string, unknown>;
			const coverage = test.coverage as Record<string, unknown>;
			const exclude = coverage.exclude as string[];
			expect(exclude).toContain("**/*.{test,spec}.{ts,tsx,js,jsx}");
			expect(exclude).toContain("**/__test__/**");
			expect(exclude).toContain("**/generated/**");
			expect(exclude).toContain("src/legacy/**");
		});

		it("should include default reporter", async () => {
			const result = await VitestConfig.create();
			const test = result.test as Record<string, unknown>;
			const reporters = test.reporters as string[];
			expect(reporters).toContain("default");
		});

		it("should include github-actions reporter when GITHUB_ACTIONS is set", async () => {
			const originalEnv = process.env.GITHUB_ACTIONS;
			process.env.GITHUB_ACTIONS = "true";

			try {
				const result = await VitestConfig.create();
				const test = result.test as Record<string, unknown>;
				const reporters = test.reporters as string[];
				expect(reporters).toEqual(["default", "github-actions"]);
			} finally {
				if (originalEnv === undefined) {
					delete process.env.GITHUB_ACTIONS;
				} else {
					process.env.GITHUB_ACTIONS = originalEnv;
				}
			}
		});
	});

	describe("coverage thresholds", () => {
		beforeEach(() => {
			setupWorkspace([]);
			mockAgentPlugin.mockClear();
		});

		it("should default all thresholds to strict level", async () => {
			const result = await VitestConfig.create();
			const test = result.test as Record<string, unknown>;
			const coverage = test.coverage as Record<string, unknown>;
			expect(coverage.thresholds).toEqual({
				lines: 80,
				functions: 80,
				branches: 75,
				statements: 80,
			});
		});

		it("should resolve named level to thresholds", async () => {
			const result = await VitestConfig.create({ coverage: "standard" });
			const test = result.test as Record<string, unknown>;
			const coverage = test.coverage as Record<string, unknown>;
			expect(coverage.thresholds).toEqual({
				lines: 70,
				branches: 65,
				functions: 70,
				statements: 70,
			});
		});

		it("should accept custom thresholds object", async () => {
			const result = await VitestConfig.create({
				coverage: { lines: 75, branches: 60, functions: 85, statements: 75 },
			});
			const test = result.test as Record<string, unknown>;
			const coverage = test.coverage as Record<string, unknown>;
			expect(coverage.thresholds).toEqual({
				lines: 75,
				branches: 60,
				functions: 85,
				statements: 75,
			});
		});
	});

	describe("workspace discovery", () => {
		beforeEach(() => {
			mockAgentPlugin.mockClear();
		});

		afterEach(() => {
			resetCache();
		});

		it("should discover a package with only unit tests", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					srcFiles: ["index.test.ts", "utils.spec.ts"],
				},
			]);

			const result = await VitestConfig.create();
			const projects = extractProjects(result);
			expect(projects).toHaveLength(1);
			expect(projects[0].test?.name).toBe("@savvy-web/my-lib");
			expect(projects[0].test?.include).toEqual(["pkgs/my-lib/src/**/*.{test,spec}.{ts,tsx,js,jsx}"]);
			expect(projects[0].test?.exclude).toEqual(["**/*.e2e.{test,spec}.*", "**/*.int.{test,spec}.*"]);

			const test = result.test as Record<string, unknown>;
			const coverage = test.coverage as Record<string, unknown>;
			const include = coverage.include as string[];
			expect(include).toEqual(["pkgs/my-lib/src/**/*.ts"]);
		});

		it("should discover a package with only e2e tests", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					srcFiles: ["setup.e2e.test.ts"],
				},
			]);

			const result = await VitestConfig.create();
			const projects = extractProjects(result);
			expect(projects).toHaveLength(1);
			expect(projects[0].test?.name).toBe("@savvy-web/my-lib");
			expect(projects[0].test?.include).toEqual(["pkgs/my-lib/src/**/*.e2e.{test,spec}.{ts,tsx,js,jsx}"]);
			expect(projects[0].test?.testTimeout).toBe(120_000);
		});

		it("should create both unit and e2e projects with suffixed names", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					srcFiles: ["index.test.ts", "auth.e2e.test.ts"],
				},
			]);

			const result = await VitestConfig.create();
			const projects = extractProjects(result);
			expect(projects).toHaveLength(2);

			const unit = projects.find((p) => p.test?.name === "@savvy-web/my-lib:unit");
			const e2e = projects.find((p) => p.test?.name === "@savvy-web/my-lib:e2e");

			expect(unit).toBeDefined();
			expect(e2e).toBeDefined();
		});

		it("should create a fallback unit project when no test files exist", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/empty-lib",
					path: "/mock/workspace/pkgs/empty-lib",
					srcFiles: [],
				},
			]);

			const result = await VitestConfig.create();
			const projects = extractProjects(result);
			expect(projects).toHaveLength(1);
			expect(projects[0].test?.name).toBe("@savvy-web/empty-lib");
		});

		it("should skip packages without a src/ directory", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/no-src",
					path: "/mock/workspace/pkgs/no-src",
					hasSrc: false,
				},
			]);

			const result = await VitestConfig.create();
			const projects = extractProjects(result);
			expect(projects).toHaveLength(0);
		});

		it("should include __test__/ patterns when the directory exists", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					hasTestDir: true,
					srcFiles: [],
					testFiles: ["integration.test.ts"],
				},
			]);

			const result = await VitestConfig.create();
			const projects = extractProjects(result);
			expect(projects).toHaveLength(1);
			expect(projects[0].test?.include).toEqual([
				"pkgs/my-lib/src/**/*.{test,spec}.{ts,tsx,js,jsx}",
				"pkgs/my-lib/__test__/**/*.{test,spec}.{ts,tsx,js,jsx}",
			]);
		});

		it("should handle root-package workspace (relative path is empty)", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/vitest",
					path: "/mock/workspace",
					srcFiles: ["index.test.ts"],
				},
			]);

			const result = await VitestConfig.create();
			const projects = extractProjects(result);
			expect(projects).toHaveLength(1);
			expect(projects[0].test?.include).toEqual(["src/**/*.{test,spec}.{ts,tsx,js,jsx}"]);

			const test = result.test as Record<string, unknown>;
			const coverage = test.coverage as Record<string, unknown>;
			const include = coverage.include as string[];
			expect(include).toEqual(["src/**/*.ts"]);
		});

		it("should discover multiple packages", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/lib-a",
					path: "/mock/workspace/pkgs/lib-a",
					srcFiles: ["index.test.ts"],
				},
				{
					name: "@savvy-web/lib-b",
					path: "/mock/workspace/pkgs/lib-b",
					srcFiles: ["main.spec.ts"],
				},
			]);

			const result = await VitestConfig.create();
			const projects = extractProjects(result);
			expect(projects).toHaveLength(2);
			expect(projects.map((p) => p.test?.name)).toEqual(["@savvy-web/lib-a", "@savvy-web/lib-b"]);

			const test = result.test as Record<string, unknown>;
			const coverage = test.coverage as Record<string, unknown>;
			const include = coverage.include as string[];
			expect(include).toEqual(["pkgs/lib-a/src/**/*.ts", "pkgs/lib-b/src/**/*.ts"]);
		});
	});

	describe("coverage config with --project filtering", () => {
		beforeEach(() => {
			mockAgentPlugin.mockClear();
		});

		afterEach(() => {
			resetCache();
		});

		it("should scope coverage to a specific project", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/lib-a",
					path: "/mock/workspace/pkgs/lib-a",
					srcFiles: ["index.test.ts"],
				},
				{
					name: "@savvy-web/lib-b",
					path: "/mock/workspace/pkgs/lib-b",
					srcFiles: ["main.test.ts"],
				},
			]);

			const origArgv = process.argv;
			process.argv = [...origArgv, "--project=@savvy-web/lib-a"];

			try {
				const result = await VitestConfig.create();
				const test = result.test as Record<string, unknown>;
				const coverage = test.coverage as Record<string, unknown>;
				const include = coverage.include as string[];
				expect(include).toEqual(["pkgs/lib-a/src/**/*.ts"]);
			} finally {
				process.argv = origArgv;
			}
		});

		it("should strip :unit suffix when filtering coverage", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					srcFiles: ["index.test.ts", "auth.e2e.test.ts"],
				},
			]);

			const origArgv = process.argv;
			process.argv = [...origArgv, "--project", "@savvy-web/my-lib:unit"];

			try {
				const result = await VitestConfig.create();
				const test = result.test as Record<string, unknown>;
				const coverage = test.coverage as Record<string, unknown>;
				const include = coverage.include as string[];
				expect(include).toEqual(["pkgs/my-lib/src/**/*.ts"]);
			} finally {
				process.argv = origArgv;
			}
		});

		it("should strip :e2e suffix when filtering coverage", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					srcFiles: ["index.test.ts", "auth.e2e.test.ts"],
				},
			]);

			const origArgv = process.argv;
			process.argv = [...origArgv, "--project=@savvy-web/my-lib:e2e"];

			try {
				const result = await VitestConfig.create();
				const test = result.test as Record<string, unknown>;
				const coverage = test.coverage as Record<string, unknown>;
				const include = coverage.include as string[];
				expect(include).toEqual(["pkgs/my-lib/src/**/*.ts"]);
			} finally {
				process.argv = origArgv;
			}
		});

		it("should fall back to all projects when --project does not match", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/lib-a",
					path: "/mock/workspace/pkgs/lib-a",
					srcFiles: ["index.test.ts"],
				},
			]);

			const origArgv = process.argv;
			process.argv = [...origArgv, "--project=nonexistent"];

			try {
				const result = await VitestConfig.create();
				const test = result.test as Record<string, unknown>;
				const coverage = test.coverage as Record<string, unknown>;
				const include = coverage.include as string[];
				expect(include).toEqual(["pkgs/lib-a/src/**/*.ts"]);
			} finally {
				process.argv = origArgv;
			}
		});
	});

	describe("scan file extensions and int detection", () => {
		beforeEach(() => {
			mockAgentPlugin.mockClear();
		});

		afterEach(() => {
			resetCache();
		});

		it("should detect .tsx unit test files", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					srcFiles: ["Component.test.tsx"],
				},
			]);

			const result = await VitestConfig.create();
			const projects = extractProjects(result);
			expect(projects).toHaveLength(1);
		});

		it("should detect .jsx unit test files", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					srcFiles: ["Component.test.jsx"],
				},
			]);

			const result = await VitestConfig.create();
			const projects = extractProjects(result);
			expect(projects).toHaveLength(1);
		});

		it("should detect .js test files", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					srcFiles: ["helper.spec.js"],
				},
			]);

			const result = await VitestConfig.create();
			const projects = extractProjects(result);
			expect(projects).toHaveLength(1);
		});

		it("should detect .int. test files as integration kind", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					srcFiles: ["db.int.test.ts"],
				},
			]);

			const result = await VitestConfig.create();
			const projects = extractProjects(result);
			expect(projects).toHaveLength(1);
			expect(projects[0].test?.name).toBe("@savvy-web/my-lib");
		});

		it("should create three projects when all kinds exist", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					srcFiles: ["index.test.ts", "auth.e2e.test.ts", "db.int.test.ts"],
				},
			]);

			const result = await VitestConfig.create();
			const projects = extractProjects(result);
			expect(projects).toHaveLength(3);
			const names = projects.map((p) => p.test?.name);
			expect(names).toContain("@savvy-web/my-lib:unit");
			expect(names).toContain("@savvy-web/my-lib:e2e");
			expect(names).toContain("@savvy-web/my-lib:int");
		});

		it("should not suffix when only one kind exists", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					srcFiles: ["db.int.test.ts"],
				},
			]);

			const result = await VitestConfig.create();
			const projects = extractProjects(result);
			expect(projects).toHaveLength(1);
			expect(projects[0].test?.name).toBe("@savvy-web/my-lib");
		});

		it("should suffix when exactly two kinds exist", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					srcFiles: ["index.test.ts", "db.int.test.ts"],
				},
			]);

			const result = await VitestConfig.create();
			const projects = extractProjects(result);
			expect(projects).toHaveLength(2);
			const names = projects.map((p) => p.test?.name);
			expect(names).toContain("@savvy-web/my-lib:unit");
			expect(names).toContain("@savvy-web/my-lib:int");
		});
	});

	describe("fixture and utils exclusion", () => {
		beforeEach(() => {
			mockAgentPlugin.mockClear();
		});

		afterEach(() => {
			resetCache();
		});

		it("should exclude fixture/utils dirs under __test__", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					hasTestDir: true,
					srcFiles: ["index.test.ts"],
					testFiles: ["helper.test.ts"],
				},
			]);

			const result = await VitestConfig.create();
			const projects = extractProjects(result);
			const exclude = projects[0].test?.exclude ?? [];

			expect(exclude).toEqual(
				expect.arrayContaining([
					"pkgs/my-lib/__test__/fixtures/**",
					"pkgs/my-lib/__test__/utils/**",
					"pkgs/my-lib/__test__/unit/fixtures/**",
					"pkgs/my-lib/__test__/unit/utils/**",
					"pkgs/my-lib/__test__/e2e/fixtures/**",
					"pkgs/my-lib/__test__/e2e/utils/**",
					"pkgs/my-lib/__test__/int/fixtures/**",
					"pkgs/my-lib/__test__/int/utils/**",
					"pkgs/my-lib/__test__/integration/fixtures/**",
					"pkgs/my-lib/__test__/integration/utils/**",
				]),
			);
		});

		it("should not add __test__ exclusions when no __test__ dir", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					hasTestDir: false,
					srcFiles: ["index.test.ts"],
				},
			]);

			const result = await VitestConfig.create();
			const projects = extractProjects(result);
			const exclude = projects[0].test?.exclude ?? [];
			const hasTestExclusion = exclude.some((e: string) => e.includes("__test__/fixtures"));
			expect(hasTestExclusion).toBe(false);
		});
	});

	describe("caching", () => {
		beforeEach(() => {
			mockAgentPlugin.mockClear();
		});

		it("should return cached results on subsequent calls", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					srcFiles: ["index.test.ts"],
				},
			]);

			const firstResult = await VitestConfig.create();
			const firstProjects = extractProjects(firstResult);

			// Clear call counts after first invocation
			mockGetPaths.mockClear();

			// Second call should return same cached project configs
			const secondResult = await VitestConfig.create();
			const secondProjects = extractProjects(secondResult);

			expect(secondProjects).toHaveLength(firstProjects.length);

			// workspace-tools should not have been called again
			expect(mockGetPaths).not.toHaveBeenCalled();
		});
	});

	describe("multiple --project flags", () => {
		beforeEach(() => {
			mockAgentPlugin.mockClear();
		});

		afterEach(() => {
			resetCache();
		});

		it("should scope coverage to multiple projects", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/lib-a",
					path: "/mock/workspace/pkgs/lib-a",
					srcFiles: ["index.test.ts"],
				},
				{
					name: "@savvy-web/lib-b",
					path: "/mock/workspace/pkgs/lib-b",
					srcFiles: ["main.test.ts"],
				},
				{
					name: "@savvy-web/lib-c",
					path: "/mock/workspace/pkgs/lib-c",
					srcFiles: ["other.test.ts"],
				},
			]);

			const origArgv = process.argv;
			process.argv = [...origArgv, "--project=@savvy-web/lib-a", "--project=@savvy-web/lib-b"];

			try {
				const result = await VitestConfig.create();
				const test = result.test as Record<string, unknown>;
				const coverage = test.coverage as Record<string, unknown>;
				const include = coverage.include as string[];
				expect(include).toContain("pkgs/lib-a/src/**/*.ts");
				expect(include).toContain("pkgs/lib-b/src/**/*.ts");
				expect(include).not.toContain("pkgs/lib-c/src/**/*.ts");
			} finally {
				process.argv = origArgv;
			}
		});

		it("should handle --project value format for multiple", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/lib-a",
					path: "/mock/workspace/pkgs/lib-a",
					srcFiles: ["index.test.ts"],
				},
				{
					name: "@savvy-web/lib-b",
					path: "/mock/workspace/pkgs/lib-b",
					srcFiles: ["main.test.ts"],
				},
			]);

			const origArgv = process.argv;
			process.argv = [...origArgv, "--project", "@savvy-web/lib-a", "--project", "@savvy-web/lib-b"];

			try {
				const result = await VitestConfig.create();
				const test = result.test as Record<string, unknown>;
				const coverage = test.coverage as Record<string, unknown>;
				const include = coverage.include as string[];
				expect(include).toHaveLength(2);
			} finally {
				process.argv = origArgv;
			}
		});
	});

	describe("vitest.setup file detection", () => {
		beforeEach(() => {
			mockAgentPlugin.mockClear();
		});

		afterEach(() => {
			resetCache();
		});

		it("should add setupFiles when vitest.setup.ts exists", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					srcFiles: ["index.test.ts"],
					setupFile: "vitest.setup.ts",
				},
			]);

			const result = await VitestConfig.create();
			const projects = extractProjects(result);
			expect(projects[0].test?.setupFiles).toContain("pkgs/my-lib/vitest.setup.ts");
		});

		it("should detect vitest.setup.tsx", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					srcFiles: ["index.test.ts"],
					setupFile: "vitest.setup.tsx",
				},
			]);

			const result = await VitestConfig.create();
			const projects = extractProjects(result);
			expect(projects[0].test?.setupFiles).toContain("pkgs/my-lib/vitest.setup.tsx");
		});

		it("should not add setupFiles when no setup file exists", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					srcFiles: ["index.test.ts"],
				},
			]);

			const result = await VitestConfig.create();
			const projects = extractProjects(result);
			expect(projects[0].test?.setupFiles).toBeUndefined();
		});

		it("should add setup file to all projects for same package", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					srcFiles: ["index.test.ts", "auth.e2e.test.ts"],
					setupFile: "vitest.setup.ts",
				},
			]);

			const result = await VitestConfig.create();
			const projects = extractProjects(result);
			for (const project of projects) {
				expect(project.test?.setupFiles).toContain("pkgs/my-lib/vitest.setup.ts");
			}
		});
	});

	describe("COVERAGE_LEVELS", () => {
		it("should expose named coverage presets", () => {
			expect(VitestConfig.COVERAGE_LEVELS.none).toEqual({
				lines: 0,
				branches: 0,
				functions: 0,
				statements: 0,
			});
			expect(VitestConfig.COVERAGE_LEVELS.basic).toEqual({
				lines: 50,
				branches: 50,
				functions: 50,
				statements: 50,
			});
			expect(VitestConfig.COVERAGE_LEVELS.standard).toEqual({
				lines: 70,
				branches: 65,
				functions: 70,
				statements: 70,
			});
			expect(VitestConfig.COVERAGE_LEVELS.strict).toEqual({
				lines: 80,
				branches: 75,
				functions: 80,
				statements: 80,
			});
			expect(VitestConfig.COVERAGE_LEVELS.full).toEqual({
				lines: 90,
				branches: 85,
				functions: 90,
				statements: 90,
			});
		});

		it("should be readonly", () => {
			expect(Object.isFrozen(VitestConfig.COVERAGE_LEVELS)).toBe(true);
		});
	});

	describe("create() with kind overrides", () => {
		beforeEach(() => {
			mockAgentPlugin.mockClear();
		});

		afterEach(() => {
			resetCache();
		});

		it("should apply object override to all projects of a kind", async () => {
			setupWorkspace([
				{ name: "@savvy-web/lib-a", path: "/mock/workspace/pkgs/lib-a", srcFiles: ["index.test.ts"] },
				{ name: "@savvy-web/lib-b", path: "/mock/workspace/pkgs/lib-b", srcFiles: ["main.test.ts"] },
			]);

			const result = await VitestConfig.create({ unit: { environment: "jsdom" } });
			const projects = extractProjects(result);
			for (const project of projects) {
				expect(project.test?.environment).toBe("jsdom");
			}
		});

		it("should apply callback override for per-project mutation", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/lib-a",
					path: "/mock/workspace/pkgs/lib-a",
					srcFiles: ["index.test.ts", "auth.e2e.test.ts"],
				},
			]);

			const result = await VitestConfig.create({
				e2e: (projects) => {
					const project = projects.get("@savvy-web/lib-a:e2e");
					project?.override({ test: { testTimeout: 300_000 } });
				},
			});

			const configs = extractProjects(result);
			const e2e = configs.find((c) => c.test?.name === "@savvy-web/lib-a:e2e");
			expect(e2e?.test?.testTimeout).toBe(300_000);
		});
	});

	describe("create() with postProcess", () => {
		beforeEach(() => {
			setupWorkspace([]);
			mockAgentPlugin.mockClear();
		});

		it("should apply postProcess callback (mutate)", async () => {
			const result = await VitestConfig.create({}, (config) => {
				(config as Record<string, unknown>).resolve = { alias: { "@": "/src" } };
			});
			expect(result).toHaveProperty("resolve");
		});

		it("should accept returned config from postProcess", async () => {
			const result = await VitestConfig.create({}, (config) => ({
				...config,
				resolve: { alias: { "@": "/src" } },
			}));
			expect(result).toHaveProperty("resolve");
		});
	});
});
