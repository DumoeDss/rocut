import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import type { VariableRateCase } from "./hyperframes-variable-rate-cases";
import type { RateLane } from "./hyperframes-variable-rate-native";
import { RATE_TEST_FX } from "./hyperframes-variable-rate-production-case";
import type { RateProductionMedia } from "./hyperframes-variable-rate-production-media";

/** Instrument the existing pink-marker diagnostic composition, retaining its
 * visual identity and timeline. Only replace the audio graph under test. */
export async function rateHostProject(
	directory: string,
	toolchainDirectory: string,
	media: RateProductionMedia,
	test: VariableRateCase,
	rate: RateLane,
	signal: AbortSignal,
	options: { loop?: boolean; fxNodes?: unknown[] } = {},
) {
	const sourceDirectory = join(directory, `${media.name}-author`);
	await mkdir(sourceDirectory);
	const template = await readFile(
		new URL("./hyperframes-graph-host.html", import.meta.url),
		"utf8",
	);
	const automation = JSON.stringify({
		version: 1,
		lanes: [
			rate,
			{
				target: "volume",
				points: [
					{ t: 0, v: 0.75 },
					{ t: test.duration, v: 0.75 },
				],
			},
		],
	});
	const tag = media.kind === "wav" ? "audio" : "video";
	const mediaFile =
		media.kind === "wav"
			? "source.wav"
			: media.mimeType === "video/mp4"
				? "source.mp4"
				: "source.webm";
	// Intentionally declare video audio even for the silent fixture: real probing
	// must return no audio instead of trusting the declaration or fabricating PCM.
	const element = `<${tag} id="rate" src="${mediaFile}" data-start="0.1" data-duration="${test.duration}" data-media-start="${test.mediaStart}" data-track-index="0" data-volume="0.75" data-automation='${automation}' data-fx-chain='${JSON.stringify({ version: 1, nodes: options.fxNodes ?? RATE_TEST_FX })}' ${options.loop ? "loop " : ""}${tag === "video" ? 'playsinline data-has-audio="true"' : ""}></${tag}>`;
	let removed = 0;
	const html = template
		.replace(/<audio\b[\s\S]*?<\/audio>/g, () =>
			removed++ === 0 ? element : "",
		)
		.replace(/<hf-audio-group\b[\s\S]*?<\/hf-audio-group>/, "")
		.replace('data-duration="0.32"', `data-duration="${test.duration + 0.2}"`);
	assert.equal(removed, 3, "Existing host fixture media shape changed");
	assert.ok(!html.includes("data-audio-group="));
	await writeFile(join(sourceDirectory, "source.html"), html, { flag: "wx" });
	await copyFile(
		join(toolchainDirectory, "node_modules/gsap/dist/gsap.min.js"),
		join(sourceDirectory, "gsap.js"),
	);
	await copyFile(media.path, join(sourceDirectory, mediaFile));
	const resourceStore = {
		store: new FileProjectStore({
			root: join(directory, `${media.name}-store`),
			schemaVersion: 1,
		}),
		projectId: "rate-host",
	};
	const { source } = await compileProgrammaticProject({
		action: "compile",
		toolchainDirectory,
		context: resourceStore,
		signal,
		enqueue: (task) => task(),
		input: {
			version: 1,
			engine: "hyperframes",
			sourceDirectory,
			entryFile: "source.html",
			files: ["source.html", "gsap.js", mediaFile],
			width: 64,
			height: 64,
			frameRate: { numerator: 100, denominator: 1 },
			durationFrames: Math.round(test.duration * 100) + 20,
			seed: 7,
			audio: { version: 1, mode: "native", profile: "hyperframes-graph-v1" },
		},
	});
	const require = createRequire(
		new URL("../../apps/vite-example/package.json", import.meta.url),
	);
	const { chromium } = await import(
		pathToFileURL(require.resolve("@playwright/test")).href
	);
	return {
		source,
		resourceStore,
		executable: chromium.executablePath() as string,
	};
}
