import type { ProgrammaticSource } from "@opencut/editor-contracts";
import type { MvEmberPlan } from "../../packages/editor-contracts/src/mv-ember-plan";
import type {
	EmberAudioFacts,
	EmberReference,
	EmberReferenceAsset,
	EmberReferenceFrame,
} from "./mv-ember-reference-contract";
import { convergeReferenceDigest } from "./mv-converge-reference-realm";

export interface ClipRecord {
	frame: number;
	source: ProgrammaticSource;
	plan: MvEmberPlan;
	provenance: {
		frame: EmberReferenceFrame;
		audioIdentity: string;
		scripts: readonly { id: string; sha256: string }[];
		images: readonly { id: string; sha256: string }[];
	};
}
export interface ClipInput {
	reference: EmberReference;
	records: ClipRecord[];
}
export function check(value: unknown, message: string): asserts value {
	if (!value) throw Error(message);
}

/** Reconstruct the OLD archived fixture, then require its saved hash.
 * Its beats use i * 0.46, deliberately not the newer i * 55200 / 120000
 * acceptance input. No WASM dependency: consume an already evaluated plan. */
export function clipAudio(): EmberAudioFacts {
	const samples = (gain: number, offset: number) =>
		Array.from(
			{ length: 901 },
			(_, i) => gain * (0.5 + 0.5 * Math.sin(i * 0.17 + offset)),
		);
	return {
		beats: Array.from({ length: 65 }, (_, i) => i * 0.46),
		strongOnsets: [
			{ t: 18.05, strength: 0.49 },
			{ t: 18.25, strength: 0.5 },
			{ t: 18.45, strength: 0.9 },
			{ t: 18.65, strength: 1 },
			{ t: 19.0, strength: 0.95 },
		],
		envelopes: {
			fps: 30,
			rms: samples(0.8, 0),
			low: samples(0.4, 0.7),
			mid: samples(0.6, 1.7),
			high: samples(0.2, 2.1),
		},
	};
}

export async function clipAsset(): Promise<EmberReferenceAsset> {
	// Same actual PNG encoder/input as mv-ember-assets.ts, not a stub image.
	const canvas = new OffscreenCanvas(360, 140),
		ctx = canvas.getContext("2d")!;
	try {
		ctx.fillStyle = "#123456";
		ctx.fillRect(0, 0, 360, 140);
		for (let row = 0; row < 7; row++)
			for (let col = 0; col < 9; col++) {
				ctx.fillStyle = `rgb(${20 + col * 25},${20 + row * 32},${((row + col) % 2) * 180})`;
				ctx.fillRect(col * 40 + 3, row * 20 + 3, 34, 14);
			}
		const body = await (
			await canvas.convertToBlob({ type: "image/png", quality: 0.95 })
		).arrayBuffer();
		return {
			id: "wide.png",
			mimeType: "image/png",
			body,
			sha256: await convergeReferenceDigest(body),
		};
	} finally {
		canvas.width = canvas.height = 1;
	}
}

export async function verifyClipInput(
	input: ClipInput,
	audio: EmberAudioFacts,
	asset: EmberReferenceAsset,
) {
	const audioIdentity = await convergeReferenceDigest(
		new TextEncoder().encode(JSON.stringify(audio)).buffer,
	);
	for (const record of input.records) {
		check(
			record.provenance.audioIdentity === audioIdentity,
			"Saved audio identity differs; do not compare different inputs",
		);
		check(
			record.provenance.frame.args.mode === "collapse" &&
				record.provenance.frame.args.bg === asset.id,
			"Only saved wide.png collapse cases are supported",
		);
		check(
			record.provenance.images.find((image) => image.id === asset.id)
				?.sha256 === asset.sha256,
			"Regenerated fixture PNG differs from saved original asset bytes",
		);
		check(
			record.source.resources?.find((resource) => resource.id === asset.id)
				?.sha256 === asset.sha256,
			"Saved production image identity differs",
		);
		check(
			JSON.stringify(record.provenance.scripts) ===
				JSON.stringify(
					input.reference.scripts.map(({ id, sha256 }) => ({ id, sha256 })),
				),
			"Original script bytes changed since baseline",
		);
	}
}

export function clipPixels(image: CanvasImageSource) {
	const canvas = new OffscreenCanvas(1920, 1080),
		ctx = canvas.getContext("2d")!;
	try {
		ctx.drawImage(image, 0, 0);
		return ctx.getImageData(0, 0, 1920, 1080).data;
	} finally {
		canvas.width = canvas.height = 1;
	}
}
export function clipDifference(a: Uint8ClampedArray, b: Uint8ClampedArray) {
	check(a.length === b.length, "Pixel sizes differ");
	let max = 0,
		total = 0,
		changedChannels = 0,
		changedPixels = 0;
	for (let i = 0; i < a.length; i += 4) {
		let changed = false;
		for (let c = 0; c < 4; c++) {
			const delta = Math.abs(a[i + c] - b[i + c]);
			max = Math.max(max, delta);
			total += delta;
			if (delta) {
				changed = true;
				changedChannels++;
			}
		}
		if (changed) changedPixels++;
	}
	return { max, mae: total / a.length, changedChannels, changedPixels };
}
