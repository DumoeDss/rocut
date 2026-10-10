import base from "../../eslint.config.mjs";
export default base.map((config) =>
	config.files
		? {
				...config,
				files: ["script/fixtures/mv-ink-*.ts"],
				...(config.languageOptions
					? {
							languageOptions: {
								...config.languageOptions,
								parserOptions: {
									...config.languageOptions.parserOptions,
									projectService: false,
									project: "./script/fixtures/mv-ink-native.tsconfig.json",
								},
							},
						}
					: {}),
			}
		: config,
);
