import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import * as wasm from "opencut-wasm";
import { FileProjectStore } from "../../apps/cli/src/file-store";
import { compileProgrammaticProject } from "../../apps/cli/src/programmatic/engines/compile-project";
import { withHyperframesAudioGraphAnalyzer } from "../../apps/cli/src/programmatic/hyperframes-audio-analysis";
import type { HyperframesAudioGraphSnapshot } from "../../apps/cli/src/programmatic/hyperframes-audio-graph-types";
import { nativeAudioWav } from "./native-audio-fixture";
import {
	durationEditorFx,
	durationEditorRate,
	durationEditorSourceSample,
} from "./hyperframes-fractional-duration-editor-spec.mjs";
import {
	exportTimingEditorSpec as spec,
	type ExportTimingEditorCase,
} from "./hyperframes-export-timing-editor-spec.mjs";

export async function exportTimingEditorProject({
	root,
	toolchain,
	executable,
	signal,
	test,
}: {
	root: string;
	toolchain: string;
	executable: string;
	signal: AbortSignal;
	test: ExportTimingEditorCase;
}) {
	const authored = join(root, "author"),
		archived = join(root, "author-archived");
	await mkdir(authored);
	// Keep the existing graph-editor diagnostic palette, marker and GSAP motion.
	// This is an audio-only variation, not a new visual design or MV composition.
	const template = await readFile(
		new URL("./hyperframes-graph-editor-source.html", import.meta.url),
		"utf8",
	);
	const automation = {
		version: 1,
		lanes: [
			durationEditorRate,
			{
				target: "volume",
				points: [
					{ t: 0, v: 0.75 },
					{ t: spec.duration, v: 0.75 },
				],
			},
		],
	};
	const element = `<audio id="fractional" src="tone.wav" data-start="${test.start}" data-duration="${spec.duration}" data-media-start="${spec.mediaStart}" data-track-index="0" data-volume="0.75" data-automation='${JSON.stringify(automation)}' data-fx-chain='${JSON.stringify({ version: 1, nodes: durationEditorFx })}'></audio>`;
	let replaced = 0;
	const html = template
		.replace(/<audio\b[\s\S]*?<\/audio>/g, () =>
			replaced++ === 0 ? element : "",
		)
		.replace(/<hf-audio-group\b[\s\S]*?<\/hf-audio-group>/, "")
		.replace('data-duration="0.32"', 'data-duration="1.08"');
	assert.equal(replaced, 3, "Existing visual fixture media layout changed");
	assert.ok(!html.includes("data-audio-group="));
	await writeFile(join(authored, "index.html"), html, { flag: "wx" });
	await copyFile(
		join(toolchain, "node_modules/gsap/dist/gsap.min.js"),
		join(authored, "gsap.js"),
	);
	await writeFile(
		join(authored, "tone.wav"),
		nativeAudioWav({
			sampleRate: 44100,
			seconds: 2,
			sample: durationEditorSourceSample,
		}),
		{ flag: "wx" },
	);
	const context = {
		store: new FileProjectStore({
			root: join(root, "project"),
			schemaVersion: 1,
		}),
		projectId: `hf-export-timing-editor-${test.id}`,
	};
	const compiled = await compileProgrammaticProject({
		action: "compile",
		toolchainDirectory: toolchain,
		context,
		signal,
		enqueue: (task) => task(),
		input: {
			version: 1,
			engine: "hyperframes",
			sourceDirectory: authored,
			entryFile: "index.html",
			files: ["index.html", "gsap.js", "tone.wav"],
			width: 64,
			height: 64,
			frameRate: { numerator: 25, denominator: 1 },
			durationFrames: spec.sourceFrames,
			seed: 11,
			audio: {
				version: 1,
				mode: "native",
				profile: "hyperframes-graph-v1",
				...(test.timing ? { timing: test.timing } : {}),
				volumeDb: -6,
			},
		},
	});
	assert.equal(dirname(resolve(authored)), resolve(root));
	assert.equal(dirname(resolve(archived)), resolve(root));
	await rename(authored, archived);
	const rebuilt = await compileProgrammaticProject({
		action: "rebuild",
		input: JSON.parse(JSON.stringify(compiled.source)),
		toolchainDirectory: toolchain,
		context,
		signal,
		enqueue: (task) => task(),
	});
	assert.equal(rebuilt.reusedDocument, true);
	const source = rebuilt.source;
	assert.equal(source.audio?.timing, test.timing);
	assert.equal(compiled.source.audio?.timing, test.timing);
	await writeFile(join(root, "source.json"), JSON.stringify(source, null, 2), {
		flag: "wx",
	});
	const timing = {
		source,
		clipStart: 0,
		clipDuration: 86400,
		trimStart: 0,
		timelineTime: 0,
	};
	// This independent diagnostic never supplies facts to the actual HTTP render.
	// That request opens its own collection browser and must discover its own history.
	const collection = await withHyperframesAudioGraphAnalyzer(
		{ executable, resourceStore: context, signal, request: timing },
		async (analyzer) => {
			const { snapshot: initial } = await analyzer.frame(timing);
			const snapshot = initial as HyperframesAudioGraphSnapshot;
			assert.equal(snapshot.tracks.length, 1);
			const track = snapshot.tracks[0];
			assert.equal(track.authorId, "fractional");
			assert.equal(track.native.loop, false);
			assert.equal(track.native.start, test.start);
			assert.equal(track.native.duration, spec.duration);
			assert.equal(track.native.mediaStart, spec.mediaStart);
			assert.equal(typeof track.native.rate, "object");
			const graph = {
				version: 1,
				...(test.timing ? { timing: test.timing } : {}),
				semanticsProfile: "rocut-hyperframes-0.8.139-audio-graph-v1",
				frameRate: source.frameRate,
				durationFrames: spec.sourceFrames,
				firstFrame: 0,
				frameCount: spec.sourceFrames,
				sampleRate: 44100,
				sources: analyzer.sources.map(({ id, mimeType, body }) => ({
					id,
					mimeType,
					byteLength: body.length,
				})),
				snapshot,
			};
			const discovery = JSON.parse(
				wasm.resolveHyperframesAudioDiscoveryJson(JSON.stringify(graph)),
			);
			assert.equal(discovery.error, undefined);
			const observations: unknown[] = [];
			for (const seek of discovery.plan.seeks)
				observations.push((await analyzer.seek(graph, seek)).snapshot);
			const result = JSON.parse(
				wasm.resolveHyperframesAudioObservationsJson(
					JSON.stringify({ version: 1, graph, observations }),
				),
			);
			assert.equal(result.error, undefined);
			assert.ok(
				result.faderObservations.length > 0,
				"Must collect a real complete author gain history",
			);
			return {
				graph,
				observations,
				faderObservations: result.faderObservations,
				diagnosticOnly: true,
			};
		},
	);
	await writeFile(
		join(root, "author-collection.json"),
		JSON.stringify(collection, null, 2),
		{ flag: "wx" },
	);
	return { context, source, original: join(archived, "tone.wav") };
}
