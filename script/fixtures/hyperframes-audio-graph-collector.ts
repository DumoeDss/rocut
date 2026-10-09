import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runCompilerChild } from "../../apps/cli/src/programmatic/engines/compiler-process";
import { probeCollectorBrowser } from "./hyperframes-audio-graph-collector-browser";
import { collectorPageDriver } from "./hyperframes-audio-graph-collector-page";
import { nativeAudioWav } from "./native-audio-fixture";

const [toolchainInput, stagingInput, previewMode] = process.argv.slice(2);
if (!toolchainInput || !stagingInput)
	throw Error(
		"Collector fixture requires isolated toolchain and staging paths",
	);
const toolchain = resolve(toolchainInput),
	staging = resolve(stagingInput);
const core = join(toolchain, "node_modules/@hyperframes/core");
const manifest = JSON.parse(await readFile(join(core, "package.json"), "utf8"));
assert.equal(
	manifest.version,
	"0.8.139",
	"collector acceptance requires the pinned native runtime",
);
const controller = new AbortController();
const timeout = setTimeout(
	() => controller.abort(Error("Collector acceptance exceeded 45 seconds")),
	45000,
);
async function runFixture(gains: boolean) {
	const project = join(staging, gains ? "gain" : "identity");
	await mkdir(project);
	await copyFile(
		new URL(
			gains
				? "./hyperframes-audio-graph-collector-gain.html"
				: "./hyperframes-audio-graph-collector.html",
			import.meta.url,
		),
		join(project, "source.html"),
	);
	await copyFile(
		join(toolchain, "node_modules/gsap/dist/gsap.min.js"),
		join(project, "gsap.js"),
	);
	const wav = nativeAudioWav({
		seconds: 0.16,
		sample: (i) => Math.sin((i * 440 * 2 * Math.PI) / 48000) * 0.125,
	});
	await writeFile(join(project, "tone.wav"), wav, { flag: "wx" });
	const resourceId = createHash("sha256").update(wav).digest("hex");
	const driver = collectorPageDriver(
		`data:audio/wav;base64,${wav.toString("base64")}`,
		resourceId,
	);
	const outputFile = join(project, "compiled.html");
	await runCompilerChild(
		{
			project,
			files: ["source.html", "gsap.js", "tone.wav"],
			entryFile: "source.html",
			outputFile,
			compilerEntry: pathToFileURL(join(core, "dist/compiler/index.js")).href,
			parserEntry: pathToFileURL(join(core, "dist/compiler/htmlDocument.js"))
				.href,
			width: 64,
			height: 64,
			durationFrames: 18,
			frameRate: { numerator: 25, denominator: 1 },
			nativeAudio: true,
			driver,
		},
		controller.signal,
	);
	return await probeCollectorBrowser(
		await readFile(outputFile, "utf8"),
		project,
		resourceId,
		controller.signal,
		gains,
		previewMode === "--routed-preview",
	);
}
try {
	const identity = await runFixture(false);
	const gain = await runFixture(true);
	const report = {
		stage: "collector-acceptance-only",
		nativeVersion: manifest.version,
		executionReady: false,
		identity,
		gain,
	};
	await writeFile(
		join(staging, "result.json"),
		JSON.stringify(report, null, 2),
		{ encoding: "utf8", flag: "wx" },
	);
	console.log(JSON.stringify(report));
} finally {
	clearTimeout(timeout);
	controller.abort();
}
