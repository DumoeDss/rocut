import base from "../../eslint.config.mjs";

// Apply the project's existing rules to backend paths absent from its default
// frontend globs. This is an explicit gate, not a replacement for those globs.
const files = [
	"apps/cli/src/programmatic/remotion-metadata-*.ts",
	"apps/cli/src/programmatic/remotion-inspection-*.ts",
	"apps/cli/src/programmatic/engines/{compile-project,remotion-compiler-child,remotion-driver,toolchain}.ts",
	"apps/cli/src/__tests__/remotion-{metadata,pinned-audio}*.ts",
];

export default base.map((config) =>
	config.files ? { ...config, files } : config,
);
