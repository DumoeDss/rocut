import base from "../../../../../../eslint.config.mjs";
const prefix = "packages/editor-classic/src/services/renderer/programmatic/";
export default base.map((config) =>
	config.files
		? {
				...config,
				files: [`${prefix}mv-heart-owner-provider*.ts`],
				...(config.languageOptions
					? {
							languageOptions: {
								...config.languageOptions,
								parserOptions: {
									...config.languageOptions.parserOptions,
									projectService: false,
									project: `./${prefix}mv-heart-owner-provider.tsconfig.json`,
								},
							},
						}
					: {}),
			}
		: config,
);
