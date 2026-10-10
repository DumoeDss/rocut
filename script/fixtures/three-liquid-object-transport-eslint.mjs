import base from "../../eslint.config.mjs";

const files = [
	"apps/cli/src/programmatic/engines/three-liquid-object-transport.ts",
	"apps/cli/src/programmatic/engines/three-liquid-object-transport-codec.ts",
	"apps/cli/src/programmatic/engines/three-liquid-object-transport-publication.ts",
	"apps/cli/src/programmatic/engines/three-liquid-object-transport-wire.ts",
	"apps/cli/src/programmatic/engines/three-liquid-object-transport-termination.ts",
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
										"./script/fixtures/three-liquid-object-transport.tsconfig.json",
								},
							},
						}
					: {}),
			}
		: config,
);
