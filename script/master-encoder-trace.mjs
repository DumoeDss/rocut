import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	WIDTH,
	HEIGHT,
	FPS,
	FIRST_FRAME,
	FRAME_COUNT,
	temporalColor,
} from "./fixtures/master-effects-browser-oracle.ts";

/** Browser-only observer: it never awaits, changes arguments, or closes caller frames. */
export function installMasterEncoderTrace() {
	const configure = VideoEncoder.prototype.configure;
	const encode = VideoEncoder.prototype.encode;
	const records = [],
		pending = [],
		ids = new WeakMap();
	let nextId = 0;
	const encoderId = (encoder) => {
		if (!ids.has(encoder)) ids.set(encoder, ++nextId);
		return ids.get(encoder);
	};
	VideoEncoder.prototype.configure = function (config) {
		const result = Reflect.apply(configure, this, [config]);
		records.push({
			kind: "configure",
			encoderId: encoderId(this),
			config: structuredClone(config),
		});
		return result;
	};
	VideoEncoder.prototype.encode = function (frame, options) {
		// Submit the unmodified original before doing any diagnostic readback.
		const result = Reflect.apply(encode, this, [frame, options]);
		const record = {
			kind: "encode",
			encoderId: encoderId(this),
			options: structuredClone(options),
		};
		records.push(record);
		let copy;
		try {
			Object.assign(record, {
				timestamp: frame.timestamp,
				duration: frame.duration,
				format: frame.format,
				codedWidth: frame.codedWidth,
				codedHeight: frame.codedHeight,
				displayWidth: frame.displayWidth,
				displayHeight: frame.displayHeight,
				colorSpace: frame.colorSpace.toJSON(),
			});
			copy = frame.clone();
			const bytes = new Uint8Array(copy.allocationSize());
			pending.push(
				copy
					.copyTo(bytes)
					.then(
						(layout) => {
							record.layout = layout;
							record.bytes = [...bytes];
						},
						(error) => {
							record.error = String(error?.stack ?? error);
						},
					)
					.finally(() => copy.close()),
			);
		} catch (error) {
			copy?.close();
			record.error = String(error?.stack ?? error);
		}
		return result;
	};
	globalThis.__masterEncoderTrace = async () => {
		await Promise.all(pending);
		return {
			observer:
				"Native encode called first with original arguments; clone/copy starts afterward without awaiting in the encode call. The extra cloned reference is retained until copy settles.",
			records,
		};
	};
}

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function unpack(record) {
	assert.equal(record.codedWidth, WIDTH);
	assert.equal(record.codedHeight, HEIGHT);
	assert.ok(
		["RGBA", "RGBX", "BGRA", "BGRX"].includes(record.format),
		`Unsupported raw input format ${record.format}; do not infer RGB parity`,
	);
	assert.equal(record.layout.length, 1);
	const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
	const { offset, stride } = record.layout[0];
	const order = record.format.startsWith("BG") ? [2, 1, 0] : [0, 1, 2];
	for (let y = 0; y < HEIGHT; y++)
		for (let x = 0; x < WIDTH; x++) {
			const from = offset + y * stride + x * 4,
				to = (y * WIDTH + x) * 4;
			for (let c = 0; c < 3; c++) rgba[to + c] = record.bytes[from + order[c]];
			rgba[to + 3] = record.format.endsWith("X") ? 255 : record.bytes[from + 3];
		}
	return rgba;
}
function compare(actual, expected) {
	let sum = 0,
		max = 0,
		different = 0;
	for (let i = 0; i < actual.length; i++) {
		const error = Math.abs(actual[i] - expected[i]);
		sum += error;
		max = Math.max(max, error);
		if (error) different++;
	}
	return {
		meanAbsoluteRgbaError: sum / actual.length,
		maxError: max,
		differingChannels: different,
	};
}

export async function saveMasterEncoderTrace({
	trace,
	artifacts,
	gpuByFrame,
	decoded,
	baseline,
	exportSettings,
	wasmSha256,
}) {
	const frames = trace.records.filter((record) => record.kind === "encode");
	assert.equal(
		frames.length,
		FRAME_COUNT,
		"Unexpected actual native encode count",
	);
	const observations = [];
	for (const [index, record] of frames.entries()) {
		assert.ok(!record.error, record.error);
		const sceneFrame = FIRST_FRAME + index;
		assert.equal(record.timestamp, Math.trunc((index / FPS) * 1e6));
		const rgba = unpack(record);
		await writeFile(join(artifacts, `encoder-${index}.rgba`), rgba, {
			flag: "wx",
		});
		const matrix = [];
		for (
			let target = FIRST_FRAME;
			target < FIRST_FRAME + FRAME_COUNT;
			target++
		) {
			const oracle = Buffer.alloc(WIDTH * HEIGHT * 4);
			for (let y = 0; y < HEIGHT; y++)
				for (let x = 0; x < WIDTH; x++)
					oracle.set(
						[...temporalColor(x, y, target), 255],
						(y * WIDTH + x) * 4,
					);
			matrix.push({
				sceneFrame: target,
				gpu: compare(rgba, gpuByFrame.get(target)),
				oracle: compare(rgba, oracle),
			});
		}
		const { bytes, ...metadata } = record;
		observations.push({
			...metadata,
			sceneFrame,
			rawSha256: hash(Buffer.from(bytes)),
			rgbaSha256: hash(rgba),
			matrix,
		});
	}
	const baselineVerification = JSON.parse(
		await readFile(join(baseline, "verification.json"), "utf8"),
	);
	assert.deepEqual(
		baselineVerification.exportSettings,
		exportSettings,
		"Unobserved baseline export settings differ",
	);
	assert.equal(
		baselineVerification.wasmSha256,
		wasmSha256,
		"Unobserved baseline WASM differs",
	);
	const baselineDecodedSha256 = baselineVerification.decodedRgbSha256;
	assert.match(baselineDecodedSha256, /^[a-f0-9]{64}$/);
	const result = {
		observer: trace.observer,
		configurations: trace.records.filter(
			(record) => record.kind === "configure",
		),
		baseline,
		baselineVerificationSha256: hash(
			await readFile(join(baseline, "verification.json")),
		),
		baselineDecodedSha256,
		observedDecodedSha256: hash(decoded),
		decodedOutputUnchanged: hash(decoded) === baselineDecodedSha256,
		outputComparison:
			"SHA256 of all six independently FFmpeg-decoded RGB frames; no tolerance or selected samples",
		baselineRunKind:
			baselineVerification.runKind ??
			(baselineVerification.reusedVideo
				? "existing-export-gpu-diagnostic"
				: "unknown"),
		observations,
		allActualInputsExact: observations.every((entry) => {
			const own = entry.matrix.find(
				(candidate) => candidate.sceneFrame === entry.sceneFrame,
			);
			return own.gpu.maxError === 0 && own.oracle.maxError === 0;
		}),
	};
	await writeFile(
		join(artifacts, "encoder-inputs.json"),
		JSON.stringify(result, null, 2),
		{ flag: "wx" },
	);
	return {
		allActualInputsExact: result.allActualInputsExact,
		decodedOutputUnchanged: result.decodedOutputUnchanged,
		configurations: result.configurations,
	};
}
