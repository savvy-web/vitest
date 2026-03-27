import { VitestConfig } from "./src/index.js";

export default VitestConfig.create({
	coverageTargets: VitestConfig.COVERAGE_LEVELS.standard,
});
