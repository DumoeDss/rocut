import base from "../../eslint.config.mjs";

const files = [
	"script/fixtures/mv-flame-{source,source.test,cases,capture,controlled-replay,native-assets,native-browser,native-mutations,negatives,sensitivity}.ts",
];
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
									project: "./script/fixtures/mv-flame-native.tsconfig.json",
								},
							},
						}
					: {}),
			}
		: config,
);
