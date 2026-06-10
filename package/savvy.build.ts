import { defineBuild, runBuild } from "@savvy-web/bundler";

const config = defineBuild({
	devManifest: "preserve",
	meta: {},
});

export default config;

if (import.meta.main) {
	await runBuild(config, { cwd: import.meta.dirname, argv: process.argv.slice(2) });
}
