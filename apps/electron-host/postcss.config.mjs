/**
 * Deliberately the same plugin and version the Vite example and `apps/web`
 * use, rather than the faster `@tailwindcss/vite`. An identical CSS pipeline
 * across all three hosts removes a whole class of "the parity difference is a
 * CSS engine difference" ambiguity. Build speed is not an acceptance criterion
 * here either.
 */
const config = {
	plugins: {
		"@tailwindcss/postcss": {},
	},
};

export default config;
