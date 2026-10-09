import base from "../../eslint.config.mjs";
const files = [
	"script/fixtures/mv-flame-export-{support,support.test,resource,resource.test,scene,render,browser}.ts",
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
									project: "./script/fixtures/mv-flame-export.tsconfig.json",
								},
							},
						}
					: {}),
			}
		: config,
);
