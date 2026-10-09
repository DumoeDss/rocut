import {
	BufferTarget,
	CanvasSource,
	Output,
	WebMOutputFormat,
} from "mediabunny";

// Independent diagnostic only: no renderer, SceneExporter, Rust/WASM, sequence
// resolver, or production/reference fixture imports are used to author pixels.
const WIDTH = 64;
const HEIGHT = 36;
const FRAMES = 6;
const FPS = 30000 / 1001;
const FRAME_DURATION = 1001 / 30000;
const BITRATE = 21000;
const CORRECT_TRIM = 5005;
const WRONG_TRIM = 10010;
const calculatedBitrate =
	Math.ceil((WIDTH * HEIGHT * FPS * 0.5 * 0.6) / 1000) * 1000;

const config = {
	width: WIDTH,
	height: HEIGHT,
	frames: FRAMES,
	frameRate: { numerator: 30000, denominator: 1001 },
	frameDuration: FRAME_DURATION,
	timestamps: Array.from(
		{ length: FRAMES },
		(_, frame) => (frame * 1001) / 30000,
	),
	codec: "vp9",
	hardwareAcceleration: "prefer-software",
	bitrate: BITRATE,
	calculatedBitrate,
	bitrateFormula: "ceil(64 * 36 * (30000 / 1001) * 0.5 * 0.6 / 1000) * 1000",
	correctTrimTicks: CORRECT_TRIM,
	wrongTrimTicks: WRONG_TRIM,
	clipStartFrame: 1,
	clipDurationFrames: 4,
	ticksPerSecond: 120000,
	ticksPerTimelineFrame: 4004,
	sequenceFrameRate: { numerator: 24000, denominator: 1001 },
	alphaInEncodedTrack: false,
} as const;

function authorFrame(frame: number, trim: number) {
	const active = frame >= 1 && frame < 5;
	const ordinal = active
		? Math.min(
				221,
				Number(
					((BigInt(trim) + BigInt(frame - 1) * 4004n) * 24000n) /
						(120000n * 1001n),
				),
			)
		: null;
	const color =
		ordinal === null
			? [0, 0, 0]
			: [ordinal, ((ordinal * 7) % 200) + 20, ((ordinal * 13) % 200) + 20];
	const rgba = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
	for (let y = 0; y < HEIGHT; y++) {
		for (let x = 0; x < WIDTH; x++) {
			const pixel = !active
				? [0, 0, 0]
				: x < 48
					? color
					: y < 18
						? [128, 0, 0]
						: [0, 0, 0];
			const offset = (y * WIDTH + x) * 4;
			rgba[offset] = pixel[0];
			rgba[offset + 1] = pixel[1];
			rgba[offset + 2] = pixel[2];
			rgba[offset + 3] = 255;
		}
	}
	return { image: new ImageData(rgba, WIDTH, HEIGHT), ordinal };
}

async function encode(trim: number) {
	const canvas = document.createElement("canvas");
	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Diagnostic canvas has no 2D context");
	const target = new BufferTarget();
	const output = new Output({ format: new WebMOutputFormat(), target });
	const source = new CanvasSource(canvas, {
		codec: "vp9",
		bitrate: BITRATE,
		hardwareAcceleration: "prefer-software",
	});
	output.addVideoTrack(source, { frameRate: FPS });
	const ordinals: (number | null)[] = [];
	let started = false;
	let settled = false;
	try {
		await output.start();
		started = true;
		for (let frame = 0; frame < FRAMES; frame++) {
			const authored = authorFrame(frame, trim);
			context.putImageData(authored.image, 0, 0);
			ordinals.push(authored.ordinal);
			await source.add((frame * 1001) / 30000, FRAME_DURATION);
		}
		source.close();
		await output.finalize();
		settled = true;
		if (!target.buffer) throw new Error("Diagnostic encoder returned no bytes");
		return { bytes: Array.from(new Uint8Array(target.buffer)), ordinals };
	} catch (error) {
		if (started && !settled) {
			try {
				await output.cancel();
			} catch (cancelError) {
				throw new AggregateError(
					[error, cancelError],
					"Diagnostic encode and cancellation failed",
				);
			}
		}
		throw error;
	}
}

async function run() {
	if (calculatedBitrate !== BITRATE)
		throw new Error(`Diagnostic bitrate formula differs: ${calculatedBitrate}`);
	const correct = await encode(CORRECT_TRIM);
	const wrong = await encode(WRONG_TRIM);
	return {
		// passed means only that this independent diagnostic produced two movies.
		// It neither applies nor replaces the original encoded acceptance gates.
		passed: true,
		bytes: correct.bytes,
		wrongTrimBytes: wrong.bytes,
		config,
		ordinals: correct.ordinals,
		wrongTrimOrdinals: wrong.ordinals,
		scope: {
			directMathematicalRgbaToCanvasSource: true,
			productionRendererTested: false,
			ffmpegDecodeTested: false,
			encodedAcceptanceTested: false,
			alphaInEncodedTrackTested: false,
		},
	};
}

void run().then(
	(result) => Reflect.set(globalThis, "__imageSequenceCodecDiagnostic", result),
	(error) =>
		Reflect.set(globalThis, "__imageSequenceCodecDiagnostic", {
			error: String(
				error instanceof Error ? (error.stack ?? error.message) : error,
			),
			config,
		}),
);
