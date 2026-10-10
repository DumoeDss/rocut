import base from "../../eslint.config.mjs";

const files = [
	"apps/cli/src/programmatic/engines/three-liquid-object-compiler-plugin.ts",
	"apps/cli/src/__tests__/three-liquid-object-compiler.test.ts",
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
										"./script/fixtures/three-liquid-object-compiler.tsconfig.json",
								},
							},
						}
					: {}),
			}
		: config,
);
