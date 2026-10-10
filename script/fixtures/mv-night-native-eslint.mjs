import base from "../../eslint.config.mjs";
export default base.map((config) =>
	config.files
		? {
				...config,
				files: ["script/fixtures/mv-night-native-browser.ts", "packages/editor-classic/src/services/renderer/programmatic/mv-night-native.ts"],
				...(config.languageOptions
					? {
							languageOptions: {
								...config.languageOptions,
								parserOptions: {
									...config.languageOptions.parserOptions,
									projectService: false,
									project: "./script/fixtures/mv-night-native.tsconfig.json",
								},
							},
						}
					: {}),
			}
		: config,
);
