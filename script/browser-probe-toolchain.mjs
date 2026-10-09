import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// These tools belong to the Vite example workspace, not the repository root.
const require = createRequire(
	new URL("../apps/vite-example/package.json", import.meta.url),
);
const load = (name) => import(pathToFileURL(require.resolve(name)).href);
const playwright = await load("@playwright/test");
export const { chromium } = playwright.default ?? playwright;
export const { createServer, build } = await load("vite");
export const { default: wasm } = await load("vite-plugin-wasm");
export const { default: topLevelAwait } = await load(
	"vite-plugin-top-level-await",
);
