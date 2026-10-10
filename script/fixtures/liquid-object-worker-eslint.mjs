import base from "../../eslint.config.mjs";
const files = ["apps/cli/src/programmatic/liquid-object-worker*.ts"];
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
										"./script/fixtures/liquid-object-worker.tsconfig.json",
								},
							},
						}
					: {}),
			}
		: config,
);
