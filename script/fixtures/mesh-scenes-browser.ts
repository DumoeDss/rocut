import { generatorCapture } from "./generator-capture";
import { checkClothScenes } from "./cloth-scenes-checks";
import { exportGenerators } from "./generator-export-probe";
import { checkMeshRefraction } from "./mesh-refraction-checks";
import { checkBendScenes } from "./mesh-scenes-bend-checks.mjs";
import type { MeshPixelComparison } from "./mesh-scenes-contract";
import { checkGridScenes } from "./mesh-scenes-grid-checks.mjs";
import { checkHexScenes } from "./mesh-scenes-hex-checks.mjs";
import { checkShatterScenes } from "./shatter-scenes-checks";
import {
	assert,
	base64,
	comparePixels,
	makeMeshAssets,
	opaqueOracle,
} from "./mesh-scenes-support.mjs";

type ProbeResult = Awaited<
	ReturnType<
		| typeof checkBendScenes
		| typeof checkGridScenes
		| typeof checkHexScenes
		| typeof checkShatterScenes
		| typeof checkClothScenes
	>
>;
type ProbeMedia = {
	name: string;
	video: string;
	preview: string;
	oracle: string;
	mask: string;
	sheet: string;
	evidence: Awaited<ReturnType<typeof exportGenerators>> | undefined;
	oracleChecks: MeshPixelComparison[];
};

export async function runMeshRefractionProbe() {
	return { ok: true, refraction: await checkMeshRefraction() };
}

export async function runMeshScenesProbe() {
	return runSceneGroups(false);
}

export async function runClothScenesProbe() {
	return runSceneGroups(true);
}

async function runSceneGroups(clothOnly: boolean) {
	const refraction = clothOnly ? undefined : await checkMeshRefraction();
	const { resources, images, sourceChecks } = await makeMeshAssets();
	const { capture, count } = generatorCapture(resources);
	const context = { capture, resources, images, assert };
	const groups: { name: string; result: ProbeResult }[] = [];
	const checks = clothOnly
		? ([["cloth", checkClothScenes]] as const)
		: ([
				["cloth", checkClothScenes],
				["shatter", checkShatterScenes],
				["bend", checkBendScenes],
				["grid", checkGridScenes],
				["hex", checkHexScenes],
			] as const);
	for (const [name, check] of checks) {
		const result = await check(context);
		groups.push({ name, result });
		Reflect.set(globalThis, "__meshScenesProgress", {
			completed: groups.map((g) => g.name),
			captures: count(),
		});
	}
	const snapshots = groups.flatMap((g) => g.result.snapshots);
	const sheet = document.createElement("canvas");
	sheet.width = 4 * 192;
	sheet.height = Math.ceil(snapshots.length / 4) * 128;
	const ctx = sheet.getContext("2d")!;
	ctx.fillStyle = "#102030";
	ctx.fillRect(0, 0, sheet.width, sheet.height);
	snapshots.forEach((snapshot, index) => {
		const canvas = new OffscreenCanvas(snapshot.width, snapshot.height);
		canvas
			.getContext("2d")!
			.putImageData(
				new ImageData(
					new Uint8ClampedArray(snapshot.pixels),
					snapshot.width,
					snapshot.height,
				),
				0,
				0,
			);
		const x = (index % 4) * 192,
			y = Math.floor(index / 4) * 128;
		ctx.drawImage(canvas, x, y, 192, 108);
		ctx.fillStyle = "#ffffff";
		ctx.font = "10px monospace";
		ctx.fillText(snapshot.label, x + 3, y + 121);
	});
	document.body.append(sheet);
	const sheetData = sheet.toDataURL("image/png"),
		media: ProbeMedia[] = [];
	const exportNames = new Set<string>();
	for (const variant of groups.flatMap((g) => g.result.exports)) {
		assert(
			/^(bend|grid|hex|shatter|cloth)(-[a-z0-9]+)*$/.test(variant.name) &&
				!exportNames.has(variant.name),
			"Invalid/duplicate export name",
		);
		exportNames.add(variant.name);
		const width = 384,
			height = 216,
			stride = width * height * 4;
		const oracleBytes = new Uint8Array(stride * 6),
			masks = new Uint8Array(width * height * 6),
			oracleChecks: MeshPixelComparison[] = [];
		for (let index = 0; index < 6; index++) {
			const frame = 6 + index;
			const expected = await variant.oracle(frame, width, height);
			assert(
				expected.pixels.length === stride,
				`${variant.name}: oracle dimensions`,
			);
			const actual = await capture({ ...variant.source, width, height }, frame);
			oracleChecks.push(
				comparePixels(actual.pixels, expected.pixels, {
					label: `${variant.name} export-size oracle ${frame}`,
					mask: expected.mask,
					maxPremul: 5,
					maxAlpha: 3,
					meanPremul: 1.5,
					minPixels: width * height * 0.2,
				}),
			);
			oracleBytes.set(opaqueOracle(expected.pixels), index * stride);
			masks.set(
				expected.mask ?? new Uint8Array(width * height).fill(1),
				index * width * height,
			);
		}
		Reflect.deleteProperty(globalThis, "__stylizedVideoBase64");
		Reflect.deleteProperty(globalThis, "__stylizedExpectedBase64");
		let exported;
		try {
			exported = await exportGenerators([variant.source], resources, {
				startTime: 36000,
			});
		} finally {
			const video = Reflect.get(globalThis, "__stylizedVideoBase64"),
				preview = Reflect.get(globalThis, "__stylizedExpectedBase64");
			if (typeof video === "string" && typeof preview === "string") {
				media.push({
					name: variant.name,
					video,
					preview,
					oracle: base64(oracleBytes),
					mask: base64(masks),
					sheet: sheetData,
					evidence: exported,
					oracleChecks,
				});
				Reflect.set(globalThis, "__meshScenesMedia", media);
			}
		}
		assert(exported, `${variant.name}: export did not complete`);
	}
	return {
		ok: true,
		refraction,
		sourceChecks,
		captures: count(),
		groups: groups.map(({ name, result }) => ({
			name,
			evidence: result.evidence,
		})),
		exports: media.map(({ name, evidence, oracleChecks }) => ({
			name,
			evidence,
			oracleChecks,
		})),
		snapshotCount: snapshots.length,
		checks: [
			"real canvas-worker mesh raster path",
			"independent fixed-step Cloth XPBD physics, geometry, UV and alpha oracle",
			...(clothOnly
				? []
				: [
						"Shatter independent Voronoi intersection, ray-plane inverse, shadows and RGB-only refraction",
						"independent inverse Bend projection",
						"independent Grid and Hex geometry and perspective texture sampling",
					]),
			"source alpha and exact endpoints",
			"reverse seek, source time and resource binding",
			"native preview/export parity and independent oracle RGBA",
		],
	};
}
