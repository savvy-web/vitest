import { NodeLibraryBuilder } from "@savvy-web/rslib-builder";

export default NodeLibraryBuilder.create({
	transform({ pkg }) {
		delete pkg.devDependencies;
		delete pkg.bundleDependencies;
		delete pkg.publishConfig;
		delete pkg.packageManager;
		delete pkg.devEngines;
		delete pkg.config;
		delete pkg.scripts;
		return pkg;
	},
});
