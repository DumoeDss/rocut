/** Executes shipped native helper and fixed lexical replay together. Recording
 * Canvas/FontFace doubles verify native calls and lifetimes, not pixel parity. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";

const root = resolve(
	"packages/editor-classic/src/services/renderer/programmatic",
);
function platformRealm(extra) {
	const modules = new Map();
	const globals = {
		crypto: webcrypto,
		Uint8Array,
		Uint8ClampedArray,
		ArrayBuffer,
		Blob,
		Map,
		Set,
		Object,
		JSON,
		Number,
		String,
		Error,
		...extra,
	};
	function load(file) {
		if (modules.has(file)) return modules.get(file).exports;
		const module = { exports: {} };
		modules.set(file, module);
		const code = ts.transpileModule(readFileSync(file, "utf8"), {
			compilerOptions: {
				module: ts.ModuleKind.CommonJS,
				target: ts.ScriptTarget.ES2022,
			},
		}).outputText;
		runInNewContext(
			code,
			{
				...globals,
				module,
				exports: module.exports,
				require: (id) => load(resolve(dirname(file), `${id}.ts`)),
			},
			{ filename: file },
		);
		return module.exports;
	}
	const { MV_MEMORIES_NATIVE_REPLAY_SOURCE } = load(
		resolve(root, "mv-memories-owner-native-source.ts"),
	);
	const replay = runInNewContext(
		`${MV_MEMORIES_NATIVE_REPLAY_SOURCE};createMvMemoriesReplay()`,
		globals,
	);
	assert.equal(Object.isFrozen(replay), true);
	const { createMemoriesNativePlatform } = load(
		resolve(root, "mv-memories-owner-native.ts"),
	);
	return (options) => createMemoriesNativePlatform({ ...options, replay });
}
function surfaces(log) {
	return (width, height) => {
		const s = { width, height };
		const ctx = new Proxy(
			{
				canvas: s,
				measureText(text) {
					log.push(["measureText", text, this.font]);
					return { width: text === "😀" ? 40 : 22 };
				},
				getImageData(x, y, w, h) {
					log.push(["readback", w, h]);
					return { data: new Uint8ClampedArray(w * h * 4) };
				},
				createLinearGradient(...args) {
					log.push(["linear", ...args]);
					return {
						addColorStop(...stop) {
							log.push(["stop", ...stop]);
						},
					};
				},
			},
			{
				get(t, k) {
					return k in t ? t[k] : (...args) => log.push([k, ...args]);
				},
				set(t, k, v) {
					t[k] = v;
					log.push([k, v]);
					return true;
				},
			},
		);
		s.getContext = () => ctx;
		return s;
	};
}
test("fixed lexical production replay uses admitted image, fonts and original 256x1 Canvas gradient", async () => {
	const log = [],
		faces = new Set();
	let closes = 0;
	const create = platformRealm({
		FontFace: class {
			constructor(family, body, options) {
				this.family = family;
				log.push(["face", family, options]);
			}
			async load() {
				return this;
			}
		},
		createImageBitmap: async (input, options) => {
			log.push(["decode", input instanceof Blob, options]);
			return {
				width: 2,
				height: 1,
				close() {
					closes++;
				},
			};
		},
	});
	const native = create({
		makeSurface: surfaces(log),
		fontSet: { add: (f) => faces.add(f), delete: (f) => faces.delete(f) },
	});
	const image = { id: "photo", kind: "image", mimeType: "image/png" };
	assert.equal(
		(
			await native.image({
				resource: image,
				bytes: new Uint8Array([1]),
				width: 2,
				height: 1,
			})
		).length,
		8,
	);
	for (const [id, weight] of [
		["caption", 600],
		["date", 400],
	])
		await native.font({
			resource: {
				id,
				kind: "font",
				sha256: id,
				font: { family: "Handwritten", weight, style: "normal" },
			},
			bytes: new Uint8Array([1]),
		});
	const metrics = native.measure([
		{ font: "caption", fontSize: 40, weight: 600, texts: ["猫", "😀"] },
		{ font: "date", fontSize: 22, weight: 400, texts: ["4.17"] },
	]);
	assert.equal(metrics[0].widths["😀"], 40);
	assert.equal(metrics[1].widths["4.17"], 22);
	assert.ok(
		log.some(
			(v) =>
				v[0] === "font" &&
				v[1].includes("600 40px") &&
				v[1].includes("mv-memories-caption-600"),
		),
	);
	assert.ok(
		log.some(
			(v) =>
				v[0] === "font" &&
				v[1].includes("400 22px") &&
				v[1].includes("mv-memories-date-400"),
		),
	);
	const stops = [
		[0, [36, 28, 26]],
		[0.2, [74, 59, 53]],
		[0.45, [125, 106, 94]],
		[0.68, [183, 156, 139]],
		[0.85, [216, 199, 174]],
		[1, [239, 230, 214]],
	];
	const plan = {
		commands: [
			{
				kind: "rect",
				transform: [1, 0, 0, 1, 0, 0],
				operations: [],
				rect: [0, 0, 256, 1],
				paint: {
					kind: "fill",
					opacity: 1,
					composite: "source-over",
					style: {
						kind: "linear",
						from: [0, 0],
						to: [256, 0],
						stops: stops.map(([offset, rgb]) => ({
							offset,
							color: [...rgb.map((v) => v / 255), 1],
						})),
					},
				},
			},
		],
		rasterBudgetBytes: 1024,
	};
	const rgba = native.readback({ plan, size: [256, 1] });
	assert.equal(rgba.length, 1024);
	assert.ok(log.some((v) => JSON.stringify(v) === '["linear",0,0,256,0]'));
	assert.deepEqual(
		log.filter((v) => v[0] === "stop").map((v) => v[1]),
		[0, 0.2, 0.45, 0.68, 0.85, 1],
	);
	assert.ok(log.some((v) => JSON.stringify(v) === '["fillRect",0,0,256,1]'));
	native.dispose();
	assert.equal(faces.size, 0);
	assert.equal(closes, 1);
	assert.throws(() => native.measure([]), /disposed/);
});
test("late asynchronous upload bitmap closes after native disposal", async () => {
	let finish, started;
	const ready = new Promise((r) => (started = r));
	let closes = 0;
	const create = platformRealm({
		ImageData: class {
			constructor(data, width, height) {
				Object.assign(this, { data, width, height });
			}
		},
		createImageBitmap: (input) =>
			new Promise((resolve) => {
				finish = () =>
					resolve({
						width: input.width,
						height: input.height,
						close() {
							closes++;
						},
					});
				started();
			}),
	});
	const native = create({
		makeSurface: surfaces([]),
		fontSet: { delete() {} },
	});
	const bytes = new Uint8Array([1, 2, 3, 4]),
		sha = Buffer.from(await webcrypto.subtle.digest("SHA-256", bytes)).toString(
			"hex",
		);
	const uploading = native.upload({
		r: {
			part: "opaque",
			width: 1,
			height: 1,
			bindingSha256: "a".repeat(64),
			rgbaSha256: sha,
		},
		bytes,
	});
	await ready;
	native.dispose();
	finish();
	await assert.rejects(uploading, /disposed/);
	assert.equal(closes, 1);
});
