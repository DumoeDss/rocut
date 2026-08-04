import js from "@eslint/js";
import next from "@next/eslint-plugin-next";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import preferObjectParams from "./eslint/rules/prefer-object-params.mjs";

const webFiles = ["apps/web/src/**/*.{ts,tsx}"];
const frontendFiles = [webFiles[0], "apps/vite-example/src/**/*.{ts,tsx}"];

const opencutEslintPlugin = {
	meta: {
		name: "eslint-plugin-opencut",
		version: "0.0.0",
	},
	rules: {
		"prefer-object-params": preferObjectParams,
	},
};

function scopeToFiles(config, files) {
	return {
		...config,
		files,
	};
}

export default [
	{
		ignores: ["**/.next/**", "**/node_modules/**", "**/dist/**", "**/build/**"],
	},
	{
		files: frontendFiles,
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "module",
			globals: {
				...globals.browser,
				...globals.node,
			},
			parserOptions: {
				ecmaFeatures: {
					jsx: true,
				},
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		linterOptions: {
			reportUnusedDisableDirectives: "error",
		},
		settings: {
			react: {
				version: "detect",
			},
		},
	},
	scopeToFiles(js.configs.recommended, frontendFiles),
	...tseslint.configs.recommended.map((config) =>
		scopeToFiles(config, frontendFiles),
	),
	scopeToFiles(react.configs.flat.recommended, frontendFiles),
	scopeToFiles(react.configs.flat["jsx-runtime"], frontendFiles),
	scopeToFiles(reactHooks.configs.flat["recommended-latest"], frontendFiles),
	scopeToFiles(jsxA11y.flatConfigs.recommended, frontendFiles),
	scopeToFiles(next.configs["core-web-vitals"], webFiles),
	{
		files: frontendFiles,
		plugins: {
			opencut: opencutEslintPlugin,
		},
		rules: {
			// The web host is App Router-only, so there is no Pages directory for
			// this legacy rule to resolve.
			"@next/next/no-html-link-for-pages": "off",
			"@typescript-eslint/no-empty-object-type": "warn",
			"@typescript-eslint/no-unsafe-type-assertion": "error",
			"@typescript-eslint/no-unused-vars": [
				"warn",
				{
					argsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
					destructuredArrayIgnorePattern: "^_",
					varsIgnorePattern: "^_",
				},
			],
			"no-empty": "warn",
			"opencut/prefer-object-params": "error",

			// `react/prop-types` is for the JS-era React workflow where runtime
			// `propTypes` declarations are the prop contract. In this TS-only
			// scope the prop types already are the contract; the rule's only
			// effect is false positives when it can't trace destructured props
			// back to a `propTypes` definition that doesn't exist.
			"react/prop-types": "off",
		},
	},
	scopeToFiles(eslintConfigPrettier, frontendFiles),
];
