import { openConvergeRealm } from "./mv-converge-reference-realm";
import { loadEmberAssets } from "./mv-ember-reference-assets";
import type { EmberOriginalEngine } from "./mv-ember-reference-contract";
import {
	check,
	clipAsset,
	clipAudio,
	clipDifference,
	clipPixels,
	verifyClipInput,
	type ClipInput,
} from "./mv-ember-clip-input";
import {
	replayMain,
	replayWorker,
	type ClipVariant,
} from "./mv-ember-clip-replay";
import {
	CLIP_CONTEXT_CASES,
	replayContextWorker,
} from "./mv-ember-clip-context";
import { diagnoseClipPrimitives } from "./mv-ember-clip-primitives";

async function savedPixels(frame: number, kind: "expected" | "actual") {
	const response = await fetch(`/saved/collapse-${frame}-${kind}.png`);
	check(response.ok, "Missing saved PNG baseline");
	const bitmap = await createImageBitmap(await response.blob());
	try {
		return clipPixels(bitmap);
	} finally {
		bitmap.close();
	}
}

async function run() {
	const input = Reflect.get(globalThis, "__emberClipInput") as ClipInput;
	check(input?.records?.length === 2, "Missing saved diagnostic input");
	const asset = await clipAsset(),
		audio = clipAudio();
	await verifyClipInput(input, audio, asset);
	const original = await openConvergeRealm(input.reference);
	const engine = original.engine as EmberOriginalEngine;
	const owned = new Set<ImageBitmap>();
	const observations: Record<string, unknown>[] = [];
	const baselineChecks: Record<string, unknown>[] = [];
	const primitiveCoverage: Record<string, unknown>[] = [];
	Reflect.set(globalThis, "__emberClipProgress", {
		observations,
		baselineChecks,
	});
	try {
		engine.audio = {
			beats: [...audio.beats],
			onsets_strong: audio.strongOnsets,
		};
		const clock = engine.makeClock(audio.beats, 120, 0),
			env = engine.makeEnv(audio.envelopes);
		engine.clock = clock;
		await loadEmberAssets({
			realm: original.realm,
			engine,
			images: [asset],
			owned,
		});
		await engine.SCENES.ember.init();
		const defaultImage = await createImageBitmap(
			new Blob([asset.body], { type: asset.mimeType }),
		);
		owned.add(defaultImage);
		const referenceImage = engine.loaded.get(asset.id)!;
		for (const record of input.records) {
			const frame = record.provenance.frame;
			primitiveCoverage.push({
				frame: record.frame,
				observations: diagnoseClipPrimitives(record.plan, referenceImage),
			});
			const originalPixels = async (offscreen: boolean) => {
				const canvas = offscreen
					? new original.realm.OffscreenCanvas(1920, 1080)
					: engine.canvas(1920, 1080);
				try {
					await engine.SCENES.ember.draw(
						canvas.getContext("2d") as CanvasRenderingContext2D,
						{
							args: frame.args,
							t: frame.time,
							lt: frame.time - frame.shotStart,
							dur: frame.duration,
							p: (frame.time - frame.shotStart) / frame.duration,
							clock,
							env,
							shot: {
								t0: frame.shotStart,
								t1: frame.shotStart + frame.duration,
							},
						},
					);
					// Match the original oracle's bitmap snapshot before pixel readback.
					const bitmap = await original.realm.createImageBitmap(canvas);
					try {
						return clipPixels(bitmap);
					} finally {
						bitmap.close();
					}
				} finally {
					canvas.width = canvas.height = 1;
				}
			};
			const expected = await savedPixels(record.frame, "expected");
			const actual = await savedPixels(record.frame, "actual");
			const htmlOriginal = await originalPixels(false);
			const offscreenOriginal = await originalPixels(true);
			const workerBaseline = await replayWorker(record.plan, asset, "baseline");
			baselineChecks.push({
				frame: record.frame,
				originalHtmlVsSavedExpected: clipDifference(htmlOriginal, expected),
				workerReplayVsSavedActual: clipDifference(workerBaseline, actual),
			});
			const recordPixels = (
				label: string,
				pixels: Uint8ClampedArray,
				details?: unknown,
			) => {
				observations.push({
					frame: record.frame,
					label,
					...(details ? { details } : {}),
					vsOriginalHtml: clipDifference(pixels, htmlOriginal),
					vsOriginalOffscreen: clipDifference(pixels, offscreenOriginal),
					vsWorkerBaseline: clipDifference(pixels, workerBaseline),
					vsSavedExpected: clipDifference(pixels, expected),
				});
			};
			recordPixels("original-html-unmodified", htmlOriginal);
			recordPixels("original-offscreen-target-only", offscreenOriginal);
			recordPixels("production-worker-layered", workerBaseline);
			recordPixels(
				"production-html-same-reference-bitmap",
				replayMain(record.plan, referenceImage, "html"),
			);
			recordPixels(
				"production-html-default-decode",
				replayMain(record.plan, defaultImage, "html"),
			);
			recordPixels(
				"production-offscreen-same-reference-bitmap",
				replayMain(record.plan, referenceImage, "offscreen"),
			);
			recordPixels(
				"production-offscreen-layered",
				replayMain(record.plan, defaultImage, "offscreen", true),
			);
			recordPixels(
				"production-worker-direct",
				await replayWorker(record.plan, asset, "baseline", false),
			);
			for (const variant of [
				"cover-save",
				"clip-default",
				"keep-clip-ctm",
				"all-state",
				"decode-none",
				"image-mask",
				"image-and-rect-mask",
				"html-coverage-mask",
				"image-mask-source-in",
				"image-pattern",
			] satisfies ClipVariant[])
				recordPixels(
					`production-worker-${variant}`,
					await replayWorker(record.plan, asset, variant),
				);
			for (const test of CLIP_CONTEXT_CASES) {
				const result = await replayContextWorker(record.plan, asset, test);
				if (result.pixels)
					recordPixels(test.label, result.pixels, {
						requested: test,
						attributes: result.attributes,
					});
				else
					observations.push({
						frame: record.frame,
						label: test.label,
						error: result.error,
						details: { requested: test, attributes: result.attributes },
					});
			}
		}
		return {
			completed: true,
			diagnosticOnly: true,
			acceptanceClaim: false,
			archivedInput: {
				beats:
					"OLD saved fixture: i * 0.46; not current integer-tick acceptance input",
				audioIdentity: input.records[0].provenance.audioIdentity,
				frames: input.records.map((record) => ({
					frame: record.frame,
					originalFrame: record.provenance.frame,
					commands: record.plan.commands.length,
				})),
			},
			scope:
				"Unmodified original HTMLCanvas remains baseline. Offscreen target and replay state toggles are diagnostic controls only.",
			image: {
				id: asset.id,
				sha256: asset.sha256,
				byteLength: asset.body.byteLength,
			},
			scripts: input.reference.scripts.map(({ id, sha256 }) => ({
				id,
				sha256,
			})),
			baselineChecks,
			primitiveCoverage,
			observations,
		};
	} finally {
		for (const bitmap of owned) bitmap.close();
		original.iframe.remove();
	}
}

try {
	const result = await run();
	Reflect.set(globalThis, "__emberClipResult", result);
	document.querySelector("#report")!.textContent = JSON.stringify(
		result,
		null,
		2,
	);
} catch (error) {
	const result = {
		completed: false,
		diagnosticOnly: true,
		acceptanceClaim: false,
		error: String(error),
		progress: Reflect.get(globalThis, "__emberClipProgress"),
	};
	Reflect.set(globalThis, "__emberClipResult", result);
	document.querySelector("#report")!.textContent = JSON.stringify(
		result,
		null,
		2,
	);
}
