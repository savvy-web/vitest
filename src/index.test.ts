import type { Dirent, Stats } from "node:fs";
import { cpus } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VitestConfigCallback } from "./index.js";
import { VitestConfig, VitestProject } from "./index.js";

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
 */
function setupWorkspace(
	packages: Array<{
		name: string;
		path: string;
		hasSrc?: boolean;
		hasTestDir?: boolean;
		srcFiles?: string[];
		testFiles?: string[];
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

	mockStatSync.mockImplementation((dirPath: string) => {
		for (const pkg of packages) {
			if (dirPath === `${pkg.path}/src` && pkg.hasSrc !== false) {
				return { isDirectory: () => true } as Stats;
			}
			if (dirPath === `${pkg.path}/__test__` && pkg.hasTestDir) {
				return { isDirectory: () => true } as Stats;
			}
		}
		throw new Error(`ENOENT: ${dirPath}`);
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

	describe("create() callback shape", () => {
		beforeEach(() => {
			setupWorkspace([]);
		});

		it("should call the callback with projects, coverage, reporters, and isCI", async () => {
			const callback: VitestConfigCallback = ({ projects, coverage, reporters, isCI }) => {
				expect(projects).toBeInstanceOf(Array);
				expect(coverage).toHaveProperty("include");
				expect(coverage).toHaveProperty("exclude");
				expect(coverage).toHaveProperty("thresholds");
				expect(reporters).toBeInstanceOf(Array);
				expect(reporters).toContain("default");
				expect(typeof isCI).toBe("boolean");
				return {
					test: {
						reporters,
						projects: projects.map((p) => p.toConfig()),
						coverage: { provider: "v8" as const, ...coverage },
					},
				};
			};

			const result = await VitestConfig.create(callback);
			expect(result).toBeDefined();
			expect(result).toHaveProperty("test");
		});
	});

	describe("coverage thresholds", () => {
		beforeEach(() => {
			setupWorkspace([]);
		});

		it("should default all thresholds to 80", async () => {
			const callback: VitestConfigCallback = ({ coverage }) => {
				expect(coverage.thresholds).toEqual({
					lines: 80,
					functions: 80,
					branches: 80,
					statements: 80,
				});
				return { test: {} };
			};

			await VitestConfig.create(callback);
		});

		it("should use custom thresholds when provided", async () => {
			const callback: VitestConfigCallback = ({ coverage }) => {
				expect(coverage.thresholds).toEqual({
					lines: 90,
					functions: 90,
					branches: 85,
					statements: 90,
				});
				return { test: {} };
			};

			await VitestConfig.create(callback, {
				thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
			});
		});

		it("should fill in missing thresholds with default of 80", async () => {
			const callback: VitestConfigCallback = ({ coverage }) => {
				expect(coverage.thresholds).toEqual({
					lines: 95,
					functions: 80,
					branches: 80,
					statements: 80,
				});
				return { test: {} };
			};

			await VitestConfig.create(callback, {
				thresholds: { lines: 95 },
			});
		});
	});

	describe("reporters", () => {
		beforeEach(() => {
			setupWorkspace([]);
		});

		it("should include default reporter", async () => {
			const callback: VitestConfigCallback = ({ reporters }) => {
				expect(reporters).toContain("default");
				return { test: {} };
			};

			await VitestConfig.create(callback);
		});

		it("should include github-actions reporter when GITHUB_ACTIONS is set", async () => {
			const originalEnv = process.env.GITHUB_ACTIONS;
			process.env.GITHUB_ACTIONS = "true";

			try {
				const callback: VitestConfigCallback = ({ reporters, isCI }) => {
					expect(reporters).toEqual(["default", "github-actions"]);
					expect(isCI).toBe(true);
					return { test: {} };
				};

				await VitestConfig.create(callback);
			} finally {
				if (originalEnv === undefined) {
					delete process.env.GITHUB_ACTIONS;
				} else {
					process.env.GITHUB_ACTIONS = originalEnv;
				}
			}
		});
	});

	describe("workspace discovery", () => {
		it("should discover a package with only unit tests", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					srcFiles: ["index.test.ts", "utils.spec.ts"],
				},
			]);

			const callback: VitestConfigCallback = ({ projects, coverage }) => {
				expect(projects).toHaveLength(1);
				expect(projects[0].name).toBe("@savvy-web/my-lib");
				expect(projects[0].kind).toBe("unit");

				const config = projects[0].toConfig();
				expect(config.test?.include).toEqual(["pkgs/my-lib/src/**/*.{test,spec}.ts"]);
				expect(config.test?.exclude).toEqual(["**/*.e2e.{test,spec}.ts"]);

				expect(coverage.include).toEqual(["pkgs/my-lib/src/**/*.ts"]);
				return { test: {} };
			};

			await VitestConfig.create(callback);
		});

		it("should discover a package with only e2e tests", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					srcFiles: ["setup.e2e.test.ts"],
				},
			]);

			const callback: VitestConfigCallback = ({ projects }) => {
				expect(projects).toHaveLength(1);
				expect(projects[0].name).toBe("@savvy-web/my-lib");
				expect(projects[0].kind).toBe("e2e");

				const config = projects[0].toConfig();
				expect(config.test?.include).toEqual(["pkgs/my-lib/src/**/*.e2e.{test,spec}.ts"]);
				expect(config.test?.testTimeout).toBe(120_000);
				return { test: {} };
			};

			await VitestConfig.create(callback);
		});

		it("should create both unit and e2e projects with suffixed names", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					srcFiles: ["index.test.ts", "auth.e2e.test.ts"],
				},
			]);

			const callback: VitestConfigCallback = ({ projects }) => {
				expect(projects).toHaveLength(2);

				const unit = projects.find((p) => p.kind === "unit");
				const e2e = projects.find((p) => p.kind === "e2e");

				expect(unit).toBeDefined();
				expect(unit?.name).toBe("@savvy-web/my-lib:unit");

				expect(e2e).toBeDefined();
				expect(e2e?.name).toBe("@savvy-web/my-lib:e2e");
				return { test: {} };
			};

			await VitestConfig.create(callback);
		});

		it("should create a fallback unit project when no test files exist", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/empty-lib",
					path: "/mock/workspace/pkgs/empty-lib",
					srcFiles: [],
				},
			]);

			const callback: VitestConfigCallback = ({ projects }) => {
				expect(projects).toHaveLength(1);
				expect(projects[0].name).toBe("@savvy-web/empty-lib");
				expect(projects[0].kind).toBe("unit");
				return { test: {} };
			};

			await VitestConfig.create(callback);
		});

		it("should skip packages without a src/ directory", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/no-src",
					path: "/mock/workspace/pkgs/no-src",
					hasSrc: false,
				},
			]);

			const callback: VitestConfigCallback = ({ projects }) => {
				expect(projects).toHaveLength(0);
				return { test: {} };
			};

			await VitestConfig.create(callback);
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

			const callback: VitestConfigCallback = ({ projects }) => {
				expect(projects).toHaveLength(1);
				const config = projects[0].toConfig();
				expect(config.test?.include).toEqual([
					"pkgs/my-lib/src/**/*.{test,spec}.ts",
					"pkgs/my-lib/__test__/**/*.{test,spec}.ts",
				]);
				return { test: {} };
			};

			await VitestConfig.create(callback);
		});

		it("should handle root-package workspace (relative path is empty)", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/vitest",
					path: "/mock/workspace",
					srcFiles: ["index.test.ts"],
				},
			]);

			const callback: VitestConfigCallback = ({ projects, coverage }) => {
				expect(projects).toHaveLength(1);

				const config = projects[0].toConfig();
				// Should NOT have a leading slash
				expect(config.test?.include).toEqual(["src/**/*.{test,spec}.ts"]);

				// Coverage should also not have a leading slash
				expect(coverage.include).toEqual(["src/**/*.ts"]);
				return { test: {} };
			};

			await VitestConfig.create(callback);
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

			const callback: VitestConfigCallback = ({ projects, coverage }) => {
				expect(projects).toHaveLength(2);
				expect(projects.map((p) => p.name)).toEqual(["@savvy-web/lib-a", "@savvy-web/lib-b"]);
				expect(coverage.include).toEqual(["pkgs/lib-a/src/**/*.ts", "pkgs/lib-b/src/**/*.ts"]);
				return { test: {} };
			};

			await VitestConfig.create(callback);
		});
	});

	describe("coverage config with --project filtering", () => {
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

			// Simulate --project=@savvy-web/lib-a
			const origArgv = process.argv;
			process.argv = [...origArgv, "--project=@savvy-web/lib-a"];

			try {
				const callback: VitestConfigCallback = ({ coverage }) => {
					expect(coverage.include).toEqual(["pkgs/lib-a/src/**/*.ts"]);
					return { test: {} };
				};

				await VitestConfig.create(callback);
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
				const callback: VitestConfigCallback = ({ coverage }) => {
					expect(coverage.include).toEqual(["pkgs/my-lib/src/**/*.ts"]);
					return { test: {} };
				};

				await VitestConfig.create(callback);
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
				const callback: VitestConfigCallback = ({ coverage }) => {
					expect(coverage.include).toEqual(["pkgs/my-lib/src/**/*.ts"]);
					return { test: {} };
				};

				await VitestConfig.create(callback);
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
				const callback: VitestConfigCallback = ({ coverage }) => {
					expect(coverage.include).toEqual(["pkgs/lib-a/src/**/*.ts"]);
					return { test: {} };
				};

				await VitestConfig.create(callback);
			} finally {
				process.argv = origArgv;
			}
		});
	});

	describe("caching", () => {
		it("should return cached results on subsequent calls", async () => {
			setupWorkspace([
				{
					name: "@savvy-web/my-lib",
					path: "/mock/workspace/pkgs/my-lib",
					srcFiles: ["index.test.ts"],
				},
			]);

			let firstProjects: unknown[];

			await VitestConfig.create(({ projects }) => {
				firstProjects = projects;
				return { test: {} };
			});

			// Clear call counts after first invocation
			mockGetPaths.mockClear();

			// Second call should return same cached instances
			await VitestConfig.create(({ projects }) => {
				expect(projects).toBe(firstProjects);
				return { test: {} };
			});

			// workspace-tools should not have been called again
			expect(mockGetPaths).not.toHaveBeenCalled();
		});
	});
});
