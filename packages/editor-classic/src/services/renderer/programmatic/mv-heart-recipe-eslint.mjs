import base from "./mv-heart-owner-provider-eslint.mjs";
const prefix = "packages/editor-classic/src/services/renderer/programmatic/";
export default base.map((config) =>
	config.files
		? {
				...config,
				files: [`${prefix}mv-heart-recipe*.ts`],
				...(config.languageOptions
					? {
							languageOptions: {
								...config.languageOptions,
								parserOptions: {
									...config.languageOptions.parserOptions,
									project: `./${prefix}mv-heart-recipe.tsconfig.json`,
								},
							},
						}
					: {}),
			}
		: config,
);
