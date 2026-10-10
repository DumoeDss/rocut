import base from "../../eslint.config.mjs";

export default base.map((config) =>
	config.files
		? {
				...config,
				files: ["script/fixtures/remotion-pinned-build-probe{,.test}.ts"],
				...(config.languageOptions
					? {
							languageOptions: {
								...config.languageOptions,
								parserOptions: {
									...config.languageOptions.parserOptions,
									projectService: false,
									project:
										"./script/fixtures/remotion-pinned-probe.tsconfig.json",
								},
							},
						}
					: {}),
			}
		: config,
);
