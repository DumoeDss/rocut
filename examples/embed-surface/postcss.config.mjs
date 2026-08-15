/**
 * The same Tailwind 4 PostCSS pipeline the in-repo Vite host uses. The
 * editor's stylesheet (`@opencut/editor-classic/surface.css`) is Tailwind 4
 * CSS carrying its own `@plugin` directives; this plugin is what processes it.
 */
const config = {
	plugins: {
		"@tailwindcss/postcss": {},
	},
};

export default config;
