import { cpus } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VitestConfigCallback } from "./index.js";
import { VitestConfig, VitestProject } from "./index.js";

// Mock workspace-tools to avoid filesystem dependency
vi.mock("workspace-tools", () => ({
	getWorkspaceManagerRoot: vi.fn(() => "/mock/workspace"),
	getWorkspacePackagePaths: vi.fn(() => []),
}));

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
			// hookTimeout should still be the default since only testTimeout was overridden
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
			// kind is stored as-is but typed as VitestProjectKind
			expect(project.kind).toBe("integration");

			const config = project.toConfig();
			expect(config.extends).toBe(true);
			expect(config.test).toMatchObject({
				name: "my-integration",
				include: ["test/integration/**/*.test.ts"],
			});
			// No default environment
			expect(config.test?.environment).toBeUndefined();
		});
	});
});

describe("VitestConfig", () => {
	afterEach(() => {
		// Reset static cache between tests by casting to a record type
		const config = VitestConfig as unknown as Record<string, unknown>;
		config.cachedProjects = null;
		config.cachedVitestProjects = null;
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
					coverage: {
						provider: "v8" as const,
						...coverage,
					},
				},
			};
		};

		const result = await VitestConfig.create(callback);
		expect(result).toBeDefined();
		expect(result).toHaveProperty("test");
	});

	describe("coverage thresholds", () => {
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
});
