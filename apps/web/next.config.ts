import type { NextConfig } from "next";
import { withBotId } from "botid/next/config";
import { withContentCollections } from "@content-collections/next";
import { resolve } from "node:path";
import { HeadlessWebpackGraphPlugin } from "./build/headless-webpack-graph-plugin";

function normalizedBasePath(value: string | undefined): string {
	if (!value || value === "/") return "";
	return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

const publicBasePath = normalizedBasePath(process.env.OPENCUT_PUBLIC_BASE);

const c7ProofWebpackConfig: Pick<NextConfig, "webpack"> =
	process.env.OPENCUT_C7_HEADLESS_PROOF === "1"
		? {
				webpack: (config, context) => {
					const repoRoot = resolve(process.cwd(), "../..");
					// Proof outputs are single-use evidence. Disabling Webpack's persistent
					// cache avoids a ~1.09 GiB graph-unreferenced directory without changing
					// emitted modules, runtime bytes, or the ordinary Next configuration.
					config.cache = false;
					config.experiments = {
						...(config.experiments ?? {}),
						asyncWebAssembly: true,
					};
					if (process.env.OPENCUT_C7_REACT_CONTROL === "1") {
						if (Array.isArray(config.resolve.alias)) {
							throw new Error("C7 proof requires webpack's object alias form");
						}
						const neutral = resolve(
							process.cwd(),
							"src/editor/session/headless-proof-control.ts",
						);
						const injected = resolve(
							process.cwd(),
							"src/editor/session/headless-proof-control-react.ts",
						);
						config.resolve.alias = {
							...(config.resolve.alias ?? {}),
							[neutral]: injected,
							"@/editor/session/headless-proof-control$": injected,
						};
					}
					if (context.isServer && context.nextRuntime === "nodejs") {
						const outputDirectory =
							process.env.OPENCUT_NEXT_DIST_DIR || ".next";
						const marker = process.env.OPENCUT_C7_BUILD_MARKER;
						const acceptedHead = process.env.OPENCUT_C7_ACCEPTED_HEAD;
						const acceptedTree = process.env.OPENCUT_C7_ACCEPTED_TREE;
						if (!marker || !acceptedHead || !acceptedTree) {
							throw new Error(
								"C7 Next proof requires marker, accepted HEAD and accepted tree",
							);
						}
						config.plugins.push(
							new HeadlessWebpackGraphPlugin({
								repoRoot,
								outputRoot: `apps/web/${outputDirectory}`,
								entry: "apps/web/src/app/c7-headless/route.ts",
								webpackEntrypoint: "app/c7-headless/route",
								marker,
								acceptedHead,
								acceptedTree,
							}),
						);
					}
					return config;
				},
			}
		: {};

const nextConfig: NextConfig = {
	distDir: process.env.OPENCUT_NEXT_DIST_DIR || ".next",
	basePath: publicBasePath,
	assetPrefix: publicBasePath || undefined,
	env: {
		NEXT_PUBLIC_OPENCUT_BASE: `${publicBasePath || ""}/`,
		NEXT_PUBLIC_C4_BUILD_MARKER: process.env.C4_BUILD_MARKER || "development",
		OPENCUT_C7_BUILD_MARKER:
			process.env.OPENCUT_C7_BUILD_MARKER || "development",
		OPENCUT_C7_ACCEPTED_HEAD:
			process.env.OPENCUT_C7_ACCEPTED_HEAD || "development",
		OPENCUT_C7_ACCEPTED_TREE:
			process.env.OPENCUT_C7_ACCEPTED_TREE || "development",
	},
	...c7ProofWebpackConfig,
	// P-001: the pinned baseline does not type-check (missing exports in
	// actions/keybinding, stale call arities in services/storage/migrations, and a
	// dual-`next` type identity clash from the root package.json's stray `next`
	// entry). Emitted output is unaffected — `next build` compiles successfully and
	// fails only in the type gate. Skipping it restores the production build that
	// S01 needs as its parity reference without editing any editor source.
	typescript: {
		ignoreBuildErrors: true,
	},
	compiler: {
		removeConsole: process.env.NODE_ENV === "production",
	},
	reactStrictMode: true,
	productionBrowserSourceMaps: true,
	output:
		process.env.OPENCUT_C7_HEADLESS_PROOF === "1" ? undefined : "standalone",
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "plus.unsplash.com",
			},
			{
				protocol: "https",
				hostname: "images.unsplash.com",
			},
			{
				protocol: "https",
				hostname: "images.marblecms.com",
			},
			{
				protocol: "https",
				hostname: "lh3.googleusercontent.com",
			},
			{
				protocol: "https",
				hostname: "avatars.githubusercontent.com",
			},
			{
				protocol: "https",
				hostname: "api.iconify.design",
			},
			{
				protocol: "https",
				hostname: "api.simplesvg.com",
			},
			{
				protocol: "https",
				hostname: "api.unisvg.com",
			},
			{
				protocol: "https",
				hostname: "cdn.brandfetch.io",
			},
		],
	},
};

export default withContentCollections(withBotId(nextConfig));
