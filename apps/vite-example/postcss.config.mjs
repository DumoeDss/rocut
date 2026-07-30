/**
 * Deliberately the same plugin and version `apps/web` uses, rather than the
 * faster `@tailwindcss/vite`. Using an identical CSS pipeline in both hosts
 * removes a whole class of "the parity difference is a CSS engine difference"
 * ambiguity. Build speed is not an acceptance criterion here.
 */
const config = {
	plugins: {
		"@tailwindcss/postcss": {},
	},
};

export default config;
