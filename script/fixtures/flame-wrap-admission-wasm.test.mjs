import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

assert.ok(
	process.env.FLAME_WRAP_WASM_PKG,
	"Set FLAME_WRAP_WASM_PKG to the root-approved fresh private package; no old-package fallback.",
);
const packageRoot = resolve(process.env.FLAME_WRAP_WASM_PKG);
const wasmPath = resolve(packageRoot, "opencut_wasm_bg.wasm");
const gluePath = resolve(packageRoot, "opencut_wasm_bg.js");
const wasmBytes = readFileSync(wasmPath);
const glue = await import(pathToFileURL(gluePath).href);
const module = await WebAssembly.compile(wasmBytes);
const imports = Object.fromEntries(
	WebAssembly.Module.imports(module).map(({ module: name }) => [name, glue]),
);
const instance = await WebAssembly.instantiate(module, imports);
glue.__wbg_set_wasm(instance.exports);
instance.exports.__wbindgen_start();
assert.equal(typeof glue.validateClipEditingJson, "function");
assert.equal(typeof glue.stylizedEffectCatalogJson, "function");
const fields = JSON.parse(glue.stylizedEffectCatalogJson()).find(
	(entry) => entry.id === "flame-wrap",
)?.fields;
assert.ok(fields, "Fresh package must contain FlameWrap catalog");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function request(attached, enabled, forged) {
	const params = Object.fromEntries(
		fields.map((field) => [field.key, field.default]),
	);
	const definitions = fields.map((field) => ({
		...field,
		type: "number",
		...(forged
			? {
					min: -1e20,
					max: 1e20,
					step: 0.0001,
					required: false,
					keyframable: true,
				}
			: {}),
	}));
	const editing = attached
		? {
				type: "text",
				params: {},
				effects: [{ id: "fire", type: "flame-wrap", enabled, params }],
			}
		: { type: "effect", effectType: "flame-wrap", params };
	return {
		editing,
		duration: 240000,
		trackKind: attached ? "text" : "effect",
		hasMotionText: false,
		hasAdjustment: false,
		catalog: {
			elements: {},
			graphics: {},
			masks: {},
			effects: { "flame-wrap": definitions },
		},
	};
}
const params = (input, attached) =>
	attached ? input.editing.effects[0].params : input.editing.params;
const issues = (input) =>
	JSON.parse(glue.validateClipEditingJson(JSON.stringify(input)));
const animate = (input, attached, key, value) => {
	const property = attached ? `effects.fire.params.${key}` : `params.${key}`;
	input.editing.animations = {
		[property]: {
			keys: [
				{
					id: "k0",
					time: 0,
					value,
					segmentToNext: "linear",
					tangentMode: "auto",
				},
			],
		},
	};
};

test("real fresh WASM public API identity and integer seed endpoints", (context) => {
	context.diagnostic(
		JSON.stringify({
			wasmPath,
			wasmSha256: hash(wasmBytes),
			gluePath,
			glueSha256: hash(readFileSync(gluePath)),
			scope:
				"Actual fresh WASM validateClipEditingJson, no GPU initialization or Host HTTP execution",
		}),
	);
	for (const attached of [false, true])
		for (const enabled of [false, true])
			for (const forged of [false, true])
				for (const seed of [0, 65535]) {
					const input = request(attached, enabled, forged);
					params(input, attached).seed = seed;
					assert.deepEqual(
						issues(input),
						[],
						`${attached}/${enabled}/${forged}/${seed}`,
					);
				}
});

test("real WASM fractional seed cannot bypass disabled, neutral or forged catalog admission", () => {
	for (const attached of [false, true])
		for (const enabled of [false, true])
			for (const forged of [false, true])
				for (const neutral of [false, true]) {
					const input = request(attached, enabled, forged);
					params(input, attached).seed = 0.5;
					if (neutral) params(input, attached).amount = 0;
					const result = issues(input);
					assert.ok(
						result.some(
							(issue) =>
								issue.path.endsWith(".seed") &&
								issue.message.includes("integer"),
						),
						JSON.stringify({ attached, enabled, forged, neutral, result }),
					);
				}
});

test("real WASM native animation flags keep seed/speed static and admit amount", () => {
	for (const attached of [false, true])
		for (const enabled of [false, true]) {
			for (const [key, value] of [
				["seed", 1],
				["speed", 0.5],
			]) {
				const input = request(attached, enabled, true);
				animate(input, attached, key, value);
				const result = issues(input);
				assert.ok(
					result.some((issue) => issue.message.includes("keyframable")),
					JSON.stringify({ attached, enabled, key, result }),
				);
			}
			const optical = request(attached, enabled, true);
			animate(optical, attached, "amount", 0.5);
			assert.deepEqual(issues(optical), []);
		}
});
