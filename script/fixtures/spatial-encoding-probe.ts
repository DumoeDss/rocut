import {
	ALL_FORMATS,
	BufferSource,
	BufferTarget,
	CanvasSink,
	CanvasSource,
	Input,
	Output,
	QUALITY_VERY_HIGH,
	WebMOutputFormat,
	type VideoEncodingConfig,
} from "mediabunny";
import { assert, hash } from "./stylized-probe-scene";

// Re-encode identical retained RGBA frames. This diagnostic does not render a
// scene or change its timing, content, parameters or quality acceptance limits.
export async function runSpatialEncodingProbe() {
	const artifact = new URLSearchParams(location.search).get("artifact");
	assert(
		artifact &&
			/^\.artifacts\/spatial-effects\/run-[a-zA-Z0-9]+$/.test(artifact),
		"Invalid replay artifact",
	);
	const reference = new Uint8ClampedArray(
		await (await fetch(`/${artifact}/expected.rgba`)).arrayBuffer(),
	);
	const stride = 640 * 360 * 4;
	assert(
		reference.length === stride * 6,
		"Expected exactly six retained RGBA frames",
	);
	const canvas = new OffscreenCanvas(640, 360),
		ctx = canvas.getContext("2d")!;
	const image = await createImageBitmap(
		await (await fetch(`/${artifact}/contact-sheet.png`)).blob(),
	);
	ctx.drawImage(image, 0, 0);
	image.close();
	const baseline = ctx.getImageData(0, 0, 640, 360).data;
	const variants = [],
		media = [];
	for (const [name, bitrate] of [
		["legacy", QUALITY_VERY_HIGH],
		["1500k", 1_500_000],
		["2000k", 2_000_000],
		["4000k", 4_000_000],
	] as const) {
		const configs: VideoEncoderConfig[] = [];
		const config: VideoEncodingConfig = {
			codec: "vp9",
			bitrate,
			hardwareAcceleration: "prefer-software",
			onEncoderConfig: (value) => {
				configs.push(value);
			},
		};
		const target = new BufferTarget();
		const output = new Output({ format: new WebMOutputFormat(), target });
		const source = new CanvasSource(canvas, config);
		output.addVideoTrack(source, { frameRate: 30 });
		await output.start();
		for (let frame = 0; frame < 6; frame++) {
			const pixels = reference.slice(frame * stride, (frame + 1) * stride);
			ctx.putImageData(new ImageData(pixels, 640, 360), 0, 0);
			assert(
				(await hash(ctx.getImageData(0, 0, 640, 360).data)) ===
					(await hash(pixels)),
				"Replay changed source pixels",
			);
			await source.add(frame / 30, 1 / 30);
		}
		source.close();
		await output.finalize();
		assert(target.buffer, "Missing replay export");
		const input = new Input({
			source: new BufferSource(target.buffer),
			formats: ALL_FORMATS,
		});
		const metrics: {
			frame: number;
			timestamp: number;
			meanError: number;
			activeError: number;
			activePixels: number;
		}[] = [];
		try {
			const track = await input.getPrimaryVideoTrack();
			assert(track, "Missing replay track");
			for await (const sample of new CanvasSink(track).canvases()) {
				ctx.clearRect(0, 0, 640, 360);
				ctx.drawImage(sample.canvas, 0, 0);
				const actual = ctx.getImageData(0, 0, 640, 360).data;
				const frame = metrics.length;
				assert(
					frame < 6 && Math.abs(sample.timestamp - frame / 30) < 0.002,
					"Replay timestamp mismatch",
				);
				let error = 0,
					activeError = 0,
					activePixels = 0;
				for (let i = 0; i < stride; i += 4) {
					const j = frame * stride + i;
					for (let c = 0; c < 4; c++)
						error += Math.abs(actual[i + c] - reference[j + c]);
					if (
						[0, 1, 2].some(
							(c) => Math.abs(reference[j + c] - baseline[i + c]) > 15,
						)
					) {
						activePixels++;
						for (let c = 0; c < 3; c++)
							activeError += Math.abs(actual[i + c] - reference[j + c]);
					}
				}
				metrics.push({
					frame,
					timestamp: sample.timestamp,
					meanError: error / stride,
					activeError: activeError / (activePixels * 3),
					activePixels,
				});
			}
		} finally {
			input.dispose();
		}
		assert(metrics.length === 6, "Replay frame count");
		const passed = metrics.every(
			(m) => m.meanError < 10 && m.activeError < 15 && m.activePixels > 2000,
		);
		variants.push({
			name,
			configs,
			metrics,
			passed,
			bytes: target.buffer.byteLength,
		});
		let binary = "";
		for (const byte of new Uint8Array(target.buffer))
			binary += String.fromCharCode(byte);
		media.push({ name, video: btoa(binary) });
	}
	Reflect.set(globalThis, "__stylizedEncodingVariants", media);
	return {
		ok: true,
		diagnosticOnly: true,
		referenceSha256: await hash(reference),
		variants,
	};
}
