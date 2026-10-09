import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ProgrammaticSource } from "@opencut/editor-contracts";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { nativeAudioWav } from "./native-audio-fixture";

export const lifecycleTiming = (source: ProgrammaticSource, index: number) => ({
	source,
	clipStart: 0,
	clipDuration: source.durationFrames * 4800,
	trimStart: 0,
	timelineTime: index * 4800,
});

export async function withLifecycleProject<T>(
	toolchainDirectory: string,
	consume: (
		fixture: Awaited<ReturnType<typeof prepare>>,
		controller: AbortController,
	) => Promise<T>,
	htmlFixture = new URL(
		"./hyperframes-audio-analysis-lifecycle.html",
		import.meta.url,
	),
	audio: NonNullable<ProgrammaticSource["audio"]> = {
		version: 1,
		mode: "native",
	},
) {
	const parent = resolve(tmpdir());
	const staging = await mkdtemp(join(parent, "rocut-hf-audio-lifecycle-"));
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(Error("Lifecycle fixture timed out")),
		35000,
	);
	let passed = false;
	try {
		const result = await consume(
			await prepare(
				toolchainDirectory,
				staging,
				controller.signal,
				htmlFixture,
				audio,
			),
			controller,
		);
		passed = true;
		return result;
	} finally {
		clearTimeout(timeout);
		controller.abort();
		if (passed) {
			if (
				dirname(staging) !== parent ||
				!basename(staging).startsWith("rocut-hf-audio-lifecycle-")
			)
				throw Error("Unsafe lifecycle fixture cleanup");
			await rm(staging, { recursive: true, force: true });
		} else console.error(`Lifecycle failure artifacts retained: ${staging}`);
	}
}

async function prepare(
	toolchainDirectory: string,
	staging: string,
	signal: AbortSignal,
	htmlFixture: URL,
	audio: NonNullable<ProgrammaticSource["audio"]>,
) {
	const sourceDirectory = join(staging, "author");
	await mkdir(sourceDirectory);
	await copyFile(
		fileURLToPath(htmlFixture),
		join(sourceDirectory, "source.html"),
	);
	await copyFile(
		join(toolchainDirectory, "node_modules/gsap/dist/gsap.min.js"),
		join(sourceDirectory, "gsap.js"),
	);
	await writeFile(
		join(sourceDirectory, "tone.wav"),
		nativeAudioWav({ seconds: 0.16, sample: () => 0.125 }),
		{ flag: "wx" },
	);
	const resourceStore = {
		store: new FileProjectStore({
			root: join(staging, "store"),
			schemaVersion: 1,
		}),
		projectId: "lifecycle",
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
			files: ["source.html", "gsap.js", "tone.wav"],
			width: 64,
			height: 64,
			frameRate: { numerator: 25, denominator: 1 },
			durationFrames: 8,
			seed: 7,
			audio,
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
		options: {
			executable: chromium.executablePath(),
			request: lifecycleTiming(source, 0),
			resourceStore,
			signal,
		},
	};
}
