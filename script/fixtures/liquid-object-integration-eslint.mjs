import base from "../../eslint.config.mjs";

const files = [
	"apps/cli/src/programmatic/three-capability.ts",
	"apps/cli/src/programmatic/three-liquid-object-*.ts",
	"apps/cli/src/programmatic/liquid-object-*.ts",
	"apps/cli/src/programmatic/engines/three-liquid-object-*.ts",
	"apps/cli/src/programmatic/engines/three-build-profile.ts",
	"apps/cli/src/programmatic/engines/three-toolchain-profile.ts",
	"apps/cli/src/programmatic/engines/compile-project.ts",
	"apps/cli/src/programmatic/engines/remotion-compiler-child.ts",
	"apps/cli/src/programmatic/engines/toolchain.ts",
	"apps/cli/src/programmatic/three-particle-provenance.ts",
	"apps/cli/src/programmatic/html-document.ts",
	"apps/cli/src/programmatic/html-rasterizer.ts",
	"apps/cli/src/__tests__/three-liquid-object-*.ts",
	"apps/cli/src/__tests__/liquid-object-broker*.ts",
	"packages/editor-contracts/src/programmatic-build.ts",
	"packages/editor-contracts/src/__tests__/programmatic-build-capabilities.test.ts",
];
export default base.map((config) =>
	config.files
		? {
				...config,
				files,
				...(config.languageOptions
					? {
							languageOptions: {
								...config.languageOptions,
								parserOptions: {
									...config.languageOptions.parserOptions,
									projectService: false,
									project:
										"./script/fixtures/liquid-object-integration.tsconfig.json",
								},
							},
						}
					: {}),
			}
		: config,
);
