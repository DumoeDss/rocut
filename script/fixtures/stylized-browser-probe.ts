import { disposeGpu, initializeGpu } from "opencut-wasm";
import { registerDefaultEffects } from "../../packages/editor-classic/src/effects";
import { CanvasRenderer } from "../../packages/editor-classic/src/services/renderer/canvas-renderer";
import {
	assert,
	effect,
	hash,
	makeParams,
	pixels,
	scene,
} from "./stylized-probe-scene";
import { exportStylized } from "./stylized-export-probe";

export async function runStylizedProbe() {
	registerDefaultEffects();
	await initializeGpu();
	const params = makeParams(),
		renderer = new CanvasRenderer(params);
	const capture = (node: ReturnType<typeof scene>, local = 0) =>
		renderer.renderAndCapture({ node, time: local + 12000, capture: pixels });
	const sheet = document.createElement("canvas");
	sheet.width = 512;
	sheet.height = 216;
	const ctx = sheet.getContext("2d")!;
	const stamp = (data: Uint8ClampedArray, col: number, row: number) =>
		ctx.putImageData(
			new ImageData(new Uint8ClampedArray(data), 128, 72),
			col * 128,
			row * 72,
		);
	document.body.append(sheet);
	try {
		const baseline = await capture(scene([])),
			baseHash = await hash(baseline);
		const results: unknown[] = [];
		for (const [row, kind] of ["vhs", "glitch", "retro-dither"].entries()) {
			const root = scene([effect(kind)]);
			const a = await capture(root, 60000),
				b = await capture(root, 0),
				repeat = await capture(root, 60000);
			const aHash = await hash(a),
				bHash = await hash(b);
			assert(
				aHash !== baseHash && aHash === (await hash(repeat)),
				`${kind}: no-op or seek history`,
			);
			assert(
				kind === "retro-dither" ? aHash === bHash : aHash !== bHash,
				`${kind}: wrong clock`,
			);
			assert(
				(await hash(await capture(scene([effect(kind, { amount: 0 })])))) ===
					baseHash,
				`${kind}: zero identity`,
			);
			assert(
				(await hash(
					await capture(scene([{ ...effect(kind), enabled: false }])),
				)) === baseHash,
				`${kind}: disabled effect`,
			);
			assert(
				(await hash(
					await capture(scene([effect(kind)], { preview: true }), 60000),
				)) === aHash,
				`${kind}: preview/export mismatch`,
			);
			assert(
				(await hash(
					await capture(
						scene([effect(kind)], { trim: 0, restored: true }),
						60000,
					),
				)) === aHash,
				`${kind}: source trim leaked into effect clock`,
			);
			assert(
				(await hash(
					await capture(scene([effect(kind, { seed: 27 })]), 60000),
				)) !== aHash,
				`${kind}: seed ignored`,
			);
			const layered = await capture(scene([], { layer: kind }), 60000);
			assert(
				[...layered.slice((5 * 128 + 5) * 4, (5 * 128 + 5) * 4 + 4)].join() ===
					"0,255,0,255",
				`${kind}: effect touched upper foreground`,
			);
			assert(
				(await hash(layered)) !== baseHash,
				`${kind}: missing scene effect`,
			);
			stamp(baseline, 0, row);
			stamp(b, 1, row);
			stamp(a, 2, row);
			stamp(layered, 3, row);
			results.push({ kind, frame0: bHash, frame15: aHash });
		}
		const orderA = await capture(
			scene([effect("vhs"), effect("retro-dither")]),
		);
		const orderB = await capture(
			scene([effect("retro-dither"), effect("vhs")]),
		);
		assert(
			(await hash(orderA)) !== (await hash(orderB)),
			"Effect chain order ignored",
		);
		const expected = await capture(scene([effect("vhs")]));
		const video = await exportStylized(params, expected);
		Reflect.set(globalThis, "__stylizedSheet", sheet.toDataURL("image/png"));
		assert(
			document.querySelectorAll("iframe").length === 0,
			"Frame sandbox leaked",
		);
		return {
			ok: true,
			results,
			video,
			checks: [
				"three native registry filters",
				"repeat/reverse seek",
				"zero/disabled identity",
				"seed",
				"preview/export",
				"trim-independent clip-local time",
				"JSON roundtrip",
				"layer order protects upper foreground",
				"real encode/decode",
			],
		};
	} finally {
		params.compositor.dispose();
		disposeGpu();
	}
}
