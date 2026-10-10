import base from "../../eslint.config.mjs";
export default base.map((config) =>
	config.files
		? {
				...config,
				files: ["script/fixtures/mv-heart-owner-provider*.ts"],
				...(config.languageOptions
					? {
							languageOptions: {
								...config.languageOptions,
								parserOptions: {
									...config.languageOptions.parserOptions,
									projectService: false,
									project:
										"./script/fixtures/mv-heart-owner-provider.tsconfig.json",
								},
							},
						}
					: {}),
			}
		: config,
);
