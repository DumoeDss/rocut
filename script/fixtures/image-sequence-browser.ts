import {
	isProgrammaticResource,
	type ProgrammaticSource,
} from "@opencut/editor-contracts";
import type { ProgrammaticFrameProvider } from "@opencut/editor-ports/host";
import { resolveProgrammaticFrame } from "../../packages/editor-classic/src/services/renderer/programmatic/frame";
import { renderProgrammaticCanvas } from "../../packages/editor-classic/src/services/renderer/programmatic/canvas-runtime";
import {
	check,
	color,
	makeSequenceAssets,
	makeOpaqueSequenceAssets,
	WIDTH,
	HEIGHT,
} from "./image-sequence-browser-assets";

async function run() {
	const assets = await makeSequenceAssets();
	const { blobs, source, sequence } = assets;
	const reads: string[] = [],
		observations: unknown[] = [];
	let corrupt = false;
	const provider: ProgrammaticFrameProvider = {
		renderPng: async () => {
			throw Error("Unexpected HTML request");
		},
		loadResource: async ({ resource, signal }) => {
			signal.throwIfAborted();
			check(isProgrammaticResource(resource), "Invalid resource request");
			reads.push(resource.id);
			const blob = blobs.get(resource.attachmentKey);
			check(blob, "Unexpected archive resource");
			return corrupt
				? new Blob([new Uint8Array(blob.size)], { type: blob.type })
				: blob;
		},
	};
	async function picture(
		sampleTime: number,
		authored = source,
		manifest = sequence,
	) {
		const frame = resolveProgrammaticFrame({
			source: authored,
			clipStart: 50000,
			timelineTime: 50000,
			clipDuration: 1,
			trimStart: sampleTime,
		});
		check(
			frame && frame.sampleTime === sampleTime,
			"Lost fractional source time",
		);
		const bitmap = await renderProgrammaticCanvas({
			source: authored,
			frame,
			resources: [manifest],
			provider,
		});
		try {
			const canvas = new OffscreenCanvas(WIDTH, HEIGHT),
				ctx = canvas.getContext("2d")!;
			ctx.drawImage(bitmap, 0, 0);
			return ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
		} finally {
			bitmap.close();
		}
	}
	function pixels(actual: Uint8ClampedArray, ordinal: number) {
		const expected = color(ordinal);
		for (let y = 0; y < HEIGHT; y++)
			for (let x = 0; x < WIDTH; x++) {
				const at = (y * WIDTH + x) * 4;
				const rgba =
					x < 48
						? [...expected, 255]
						: y < 18
							? [255, 0, 0, 128]
							: [0, 0, 0, 0];
				for (let c = 0; c < 4; c++)
					check(
						Math.abs(actual[at + c] - rgba[c]) <= 1,
						`Pixel mismatch frame ${ordinal} at ${x},${y},${c}`,
					);
			}
	}
	for (const ticks of [0, 5004, 5005, 9009, 10010, 1106105, 1300000, 5005]) {
		const ordinal = Math.min(
			221,
			Number((BigInt(ticks) * 24000n) / (120000n * 1001n)),
		);
		const before = reads.length;
		pixels(await picture(ticks), ordinal);
		check(
			reads.length === before + 1 && reads.at(-1) === `frames/${ordinal}.png`,
			"Eager load or wrong selected resource",
		);
		observations.push({ ticks, ordinal });
	}
	check(source.recipe, "Missing recipe");
	const reverse: ProgrammaticSource = {
		...source,
		recipe: {
			...source.recipe,
			root: "reverse",
			nodes: [
				...source.recipe.nodes,
				{
					id: "reverse",
					scene: {
						kind: "ref",
						input: "frames",
						timeMap: [
							{ atFrame: 0, sourceFrame: 100 },
							{ atFrame: 100, sourceFrame: 0 },
						],
					},
				},
			],
		},
	};
	for (const frame of [2, 90, 0, 50, 2]) {
		const ordinal = Math.floor(((100 - frame) * 4) / 5);
		pixels(await picture(frame * 4004 + 1, reverse), ordinal);
		observations.push({ reverseFrame: frame, ordinal });
	}
	const opaqueEncodings = [];
	for (const mimeType of ["image/jpeg", "image/webp"] as const) {
		const opaque = await makeOpaqueSequenceAssets(assets, mimeType);
		for (const [key, blob] of opaque.blobs) blobs.set(key, blob);
		const before = reads.length;
		const actual = await picture(5005, opaque.source, opaque.sequence);
		let maxRgbError = 0,
			wrongPaletteRejectedPixels = 0;
		const wrongPalette =
			mimeType === "image/jpeg" ? [204, 92, 28] : [36, 156, 216];
		for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel++) {
			const at = pixel * 4;
			check(actual[at + 3] === 255, `${mimeType} lost opaque alpha`);
			let rejectsWrong = false;
			for (let channel = 0; channel < 3; channel++) {
				const error = Math.abs(actual[at + channel] - opaque.expected[channel]);
				maxRgbError = Math.max(maxRgbError, error);
				check(error <= 4, `${mimeType} pixel ${pixel}/${channel} differs`);
				rejectsWrong ||=
					Math.abs(actual[at + channel] - wrongPalette[channel]) > 4;
			}
			if (rejectsWrong) wrongPaletteRejectedPixels++;
		}
		check(
			wrongPaletteRejectedPixels === WIDTH * HEIGHT,
			"Lossy gate accepts wrong frame",
		);
		check(
			reads.length === before + 1 && reads.at(-1) === opaque.frame.id,
			`${mimeType} loaded an unexpected frame dependency`,
		);
		opaqueEncodings.push({
			mimeType,
			byteLength: opaque.frame.byteLength,
			sha256: opaque.frame.sha256,
			maxRgbError,
			wrongPaletteRejectedPixels,
		});
	}
	const cancellation = await checkRunningFrameCancellation();
	// A cancelled sandbox must not poison a subsequent genuine sequence render.
	pixels(await picture(5005), 1);
	corrupt = true;
	let rejected = false;
	try {
		await picture(5005);
	} catch (error) {
		rejected = /digest mismatch/.test(String(error));
	}
	check(rejected, "Corrupt selected bytes rendered successfully");
	check(
		document.querySelectorAll("iframe").length === 0,
		"Frame Worker iframe leaked",
	);
	return {
		passed: true,
		archiveFrames: 222,
		observations,
		opaqueEncodings,
		cancellation,
		resourceReads: reads.length,
		checks: [
			"real opaque-origin Worker/Canvas pixels against independent numbered RGBA oracle",
			"NTSC source/sequence mapping, fractional trim, nonzero file numbering, first/last hold",
			"reverse references and repeated random seeks",
			"only current frame body loaded, alpha preserved, corruption rejected before Worker",
			"Chromium-encoded JPEG/WebP pass actual Worker decoding and opaque pixel checks; PNG tolerances unchanged",
			"abort after sandbox iframe load rejects with the original reason and removes the iframe; subsequent PNG render passes",
		],
		installedElectronTested: false,
		hostImportTested: false,
		encodedExportTested: false,
	};
}

/** Exercise real in-flight sandbox cancellation, not a pre-aborted signal or
 * a mocked decoder delay. The authored wait is intentional and bounded by
 * the production watchdog if cancellation were to fail.
 */
async function checkRunningFrameCancellation() {
	check(
		document.querySelectorAll("iframe").length === 0,
		"Prior iframe leaked",
	);
	const source: ProgrammaticSource = {
		version: 1,
		runtime: "canvas-worker",
		code: "await new Promise(() => {});",
		width: WIDTH,
		height: HEIGHT,
		frameRate: { numerator: 30, denominator: 1 },
		durationFrames: 1,
		seed: 1,
	};
	const frame = resolveProgrammaticFrame({
		source,
		clipStart: 0,
		clipDuration: 1,
		trimStart: 0,
		timelineTime: 0,
	});
	check(frame, "Cancellation fixture has no frame");
	const controller = new AbortController();
	const reason = new DOMException("Cancel running fixture frame", "AbortError");
	let detach = () => {};
	const loaded = new Promise<HTMLIFrameElement>((resolve, reject) => {
		let iframe: HTMLIFrameElement | null = null;
		const onload = () => resolve(iframe!);
		const observer = new MutationObserver(() => {
			iframe = document.querySelector("iframe");
			if (iframe) {
				observer.disconnect();
				iframe.addEventListener("load", onload, { once: true });
			}
		});
		const timeout = setTimeout(
			() => reject(Error("Sandbox iframe did not load")),
			4000,
		);
		detach = () => {
			clearTimeout(timeout);
			observer.disconnect();
			iframe?.removeEventListener("load", onload);
		};
		observer.observe(document.body, { childList: true });
	});
	let settled = false;
	const outcome = renderProgrammaticCanvas({
		source,
		frame,
		signal: controller.signal,
	}).then(
		(bitmap) => {
			settled = true;
			bitmap.close();
			return { error: undefined };
		},
		(error: unknown) => {
			settled = true;
			return { error };
		},
	);
	try {
		const iframe = await Promise.race([
			loaded,
			outcome.then(() => {
				throw Error("Frame settled before cancellation");
			}),
		]);
		check(iframe.isConnected && !settled, "No running frame to cancel");
		controller.abort(reason);
		check((await outcome).error === reason, "Cancellation reason was replaced");
		check(
			document.querySelectorAll("iframe").length === 0,
			"Cancelled iframe leaked",
		);
		return {
			phase: "sandbox-iframe-loaded",
			originalReason: true,
			iframeRemoved: true,
			physicalDecodeCancellationTested: false,
		};
	} finally {
		detach();
		controller.abort(reason);
		await outcome;
	}
}

void run().then(
	(value) => Reflect.set(globalThis, "__imageSequenceResult", value),
	(error) =>
		Reflect.set(globalThis, "__imageSequenceResult", {
			error: String(error?.stack ?? error),
		}),
);
