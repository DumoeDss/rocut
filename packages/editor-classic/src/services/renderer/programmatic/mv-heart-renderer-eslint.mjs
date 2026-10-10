import base from "../../../../../../eslint.config.mjs";
const prefix = "packages/editor-classic/src/services/renderer/programmatic/";
export default base.map((config) =>
	config.files
		? {
				...config,
				files: [
					`${prefix}mv-heart-renderer*.ts`,
					"packages/editor-contracts/src/mv-heart.ts",
					"packages/editor-contracts/src/mv-heart-plan.ts",
				],
				...(config.languageOptions
					? {
							languageOptions: {
								...config.languageOptions,
								parserOptions: {
									...config.languageOptions.parserOptions,
									projectService: false,
									project: `./${prefix}mv-heart-renderer.tsconfig.json`,
								},
							},
						}
					: {}),
			}
		: config,
);
