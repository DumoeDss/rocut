import base from "../../../../../../eslint.config.mjs";
const prefix = "packages/editor-classic/src/services/renderer/programmatic/";
export default base.map((config) =>
	config.files
		? {
				...config,
				files: [`${prefix}mv-memories-owner*.ts`],
				...(config.languageOptions
					? {
							languageOptions: {
								...config.languageOptions,
								parserOptions: {
									...config.languageOptions.parserOptions,
									projectService: false,
									project: `./${prefix}mv-memories-owner.tsconfig.json`,
								},
							},
						}
					: {}),
			}
		: config,
);
