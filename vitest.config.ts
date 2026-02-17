import { VitestConfig } from "./src/index.js";

export default VitestConfig.create(({ projects, coverage, reporters }) => ({
	test: {
		reporters,
		projects: projects.map((p) => p.toConfig()),
		coverage: { provider: "v8", ...coverage },
	},
}));
