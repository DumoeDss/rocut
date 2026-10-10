import base from "../../eslint.config.mjs";
export default base.map((config) =>
	config.files
		? {
				...config,
				files: ["script/fixtures/mv-tunnel-*.ts"],
				...(config.languageOptions
					? {
							languageOptions: {
								...config.languageOptions,
								parserOptions: {
									...config.languageOptions.parserOptions,
									projectService: false,
									project: "./script/fixtures/mv-tunnel-tsconfig.json",
								},
							},
						}
					: {}),
			}
		: config,
);
