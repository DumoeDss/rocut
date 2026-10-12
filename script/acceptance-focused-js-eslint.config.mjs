import js from "@eslint/js";
import globals from "globals";

// The main configuration scopes its rules to frontend TS/TSX. Acceptance
// scripts need an explicit JS gate; a zero-rule ESLint exit is not evidence.
export default [
	{
		...js.configs.recommended,
		files: ["script/**/*.{js,mjs,cjs}"],
		linterOptions: { reportUnusedDisableDirectives: "error" },
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "module",
			globals: globals.node,
		},
	},
];
