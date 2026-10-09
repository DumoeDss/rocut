import { createEmberReference } from "./mv-ember-reference-browser";
import { convergeReferenceDigest } from "./mv-converge-reference-realm";
import type {
	EmberAudioFacts,
	EmberReference,
	EmberReferenceAsset,
	EmberReferenceFrame,
} from "./mv-ember-reference-contract";

const scope = globalThis as typeof globalThis & {
	__emberReference: EmberReference;
	__emberOracleResult?: unknown;
	__emberOracleProgress?: string;
};
const assert = (value: unknown, message: string) => {
	if (!value) throw Error(message);
};
async function imageAsset(): Promise<EmberReferenceAsset> {
	const canvas = new OffscreenCanvas(320, 180),
		ctx = canvas.getContext("2d")!;
	ctx.fillStyle = "#123456";
	ctx.fillRect(0, 0, 320, 180);
	for (let row = 0; row < 6; row++)
		for (let col = 0; col < 8; col++) {
			ctx.fillStyle = `rgb(${20 + col * 30},${20 + row * 40},${((row + col) % 2) * 180})`;
			ctx.fillRect(col * 40 + 3, row * 30 + 3, 34, 24);
		}
	const body = await (
		await canvas.convertToBlob({ type: "image/png" })
	).arrayBuffer();
	canvas.width = canvas.height = 1;
	return {
		id: "fixture-marker.png",
		mimeType: "image/png",
		body,
		sha256: await convergeReferenceDigest(body),
	};
}
async function main() {
	scope.__emberOracleProgress = "font-fetch";
	const body = await (
		await fetch("/apps/web/public/motion-text/fonts/dot-gothic-16-regular.ttf")
	).arrayBuffer();
	const font = {
		id: "dotgothic16.ttf",
		mimeType: "font/ttf",
		body,
		sha256: await convergeReferenceDigest(body),
	};
	const image = await imageAsset();
	const samples = (gain: number) =>
		Array.from(
			{ length: 601 },
			(_, i) => gain * (0.5 + 0.5 * Math.sin(i * 0.17)),
		);
	const audio: EmberAudioFacts = {
		beats: Array.from({ length: 43 }, (_, i) => i * 0.46),
		strongOnsets: [
			{ t: 18.25, strength: 0.85 },
			{ t: 18.45, strength: 0.9 },
			{ t: 18.65, strength: 1 },
		],
		envelopes: {
			fps: 30,
			rms: samples(0.8),
			low: samples(0.4),
			mid: samples(0.6),
			high: samples(0.2),
		},
	};
	scope.__emberOracleProgress = "original-realm-init";
	const oracle = await createEmberReference({
		reference: scope.__emberReference,
		audio,
		font,
		images: [image],
	});
	const hashes: Record<string, string> = {},
		provenance: unknown[] = [];
	let missingAssetsRejected = 0;
	const capture = async (
		label: string,
		frame: EmberReferenceFrame,
		show = false,
	) => {
		scope.__emberOracleProgress = label;
		const result = await oracle.render(frame);
		try {
			const ctx = result.canvas.getContext("2d")!;
			const rgba = ctx.getImageData(0, 0, 1920, 1080).data;
			const hash = await convergeReferenceDigest(rgba.buffer as ArrayBuffer);
			if (hashes[label])
				assert(hashes[label] === hash, `${label} nonmonotonic repeat differs`);
			hashes[label] = hash;
			if (show) {
				const heading = document.createElement("h2"),
					thumbnail = document.createElement("canvas");
				heading.textContent = label;
				thumbnail.width = 480;
				thumbnail.height = 270;
				thumbnail.getContext("2d")!.drawImage(result.bitmap, 0, 0, 480, 270);
				document.body.append(heading, thumbnail);
				provenance.push(result.provenance);
			}
			return {
				hash,
				rgbNonzero: rgba.some((value, index) => index % 4 !== 3 && value !== 0),
			};
		} finally {
			result.bitmap.close();
			result.canvas.width = result.canvas.height = 1;
		}
	};
	try {
		const breathe = (time: number): EmberReferenceFrame => ({
			time,
			shotStart: 0,
			duration: 6,
			args: {
				mode: "breathe",
				grain: 0.07,
				stops: [[1.75, 1.9]],
				flares: [
					[2.4, 2.73],
					[4.57, 5.6],
				],
				thumps: [2.83],
			},
		});
		for (const time of [
			2.45, 0, 0.3, 0.62, 0.75, 1, 1.001, 1.75, 1.89999, 1.9, 2.73, 4.58, 2.45,
		]) {
			const result = await capture(
				`breathe-${time}`,
				breathe(time),
				time === 2.45 && !hashes["breathe-2.45"],
			);
			if (time === 1.75 || time === 1.89999)
				assert(!result.rgbNonzero, "Half-open stop interval must be black");
			if (time === 1.9) assert(result.rgbNonzero, "Stop end must relight");
		}
		const ignite = (time: number): EmberReferenceFrame => ({
			time,
			shotStart: 6.1,
			duration: 5,
			args: {
				mode: "ignite",
				grain: 0.07,
				stops: [],
				blackFrom: 10.9,
				crackAt: 8.44,
				ring: 176,
				seed: 5,
			},
		});
		for (const time of [9, 6.1, 6.3, 7, 8.44, 8.46, 10.9, 9]) {
			const result = await capture(
				`ignite-${time}`,
				ignite(time),
				time === 9 && !hashes["ignite-9"],
			);
			if (time === 10.9)
				assert(!result.rgbNonzero, "Ignite blackFrom must be black");
		}
		const collapse = (time: number): EmberReferenceFrame => ({
			time,
			shotStart: 16,
			duration: 4,
			args: {
				mode: "collapse",
				grain: 0.06,
				bg: image.id,
				focus: [200, 40],
				end: 20,
			},
		});
		for (const time of [18.5, 16, 16.5, 17, 18, 19.5, 19.83, 20, 18.5])
			await capture(
				`collapse-${time}`,
				collapse(time),
				time === 18.5 && !hashes["collapse-18.5"],
			);
		try {
			await oracle.render({
				...collapse(17),
				args: {
					...collapse(17).args,
					mode: "collapse",
					bg: "missing.png",
					focus: [0, 0],
					end: 20,
				},
			});
		} catch {
			missingAssetsRejected++;
		}
		const noFont = await createEmberReference({
			reference: scope.__emberReference,
			audio,
		});
		try {
			await noFont.render(breathe(1));
		} catch {
			missingAssetsRejected++;
		} finally {
			noFont.dispose();
		}
		assert(
			missingAssetsRejected === 2,
			"Missing images/fonts must fail instead of silent fallback",
		);
		assert(
			new Set(Object.values(hashes)).size > 20,
			"Original scene samples must not all be blank/static",
		);
		return {
			passed: true,
			originalOracleOnly: true,
			rocutSceneParityTested: false,
			exportTested: false,
			samples: Object.keys(hashes).length,
			nonmonotonicRepeatModes: 3,
			missingAssetsRejected,
			hashes,
			provenance,
		};
	} finally {
		oracle.dispose();
	}
}
main()
	.then((result) => {
		scope.__emberOracleResult = result;
	})
	.catch((error) => {
		scope.__emberOracleResult = {
			passed: false,
			error: String(error),
			stack: error.stack,
		};
	});
