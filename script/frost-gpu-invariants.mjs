// Offline artifact QA only. Caller receipts cannot independently prove GPU execution.
import { createHash } from "node:crypto";
const SOURCE_PIN =
	"577662c959e5969630dc4cda0bb0d9f0edfe284caffa1e717a18338bbe4f11a0";
const EXPECTED_PINS = Object.freeze({
	"static-ice":
		"55cffdc06c01e67c639ffffee99ac501e7435521974aac7fa97d99170baecbdf",
	"before-stamp":
		"55cffdc06c01e67c639ffffee99ac501e7435521974aac7fa97d99170baecbdf",
	recovered: "55cffdc06c01e67c639ffffee99ac501e7435521974aac7fa97d99170baecbdf",
	"stamp-full":
		"414fe4af5de5f8b2463895fc814cfaac40f255fb4bb44b7b1e002a168f884ecc",
	"hold-end":
		"414fe4af5de5f8b2463895fc814cfaac40f255fb4bb44b7b1e002a168f884ecc",
	"recover-half":
		"e12506b2bd728845053e60ad979344b692e231be92f16a9cb00bcae103361527",
	restamped: "9f208a443a4f6a3466145e41f145c9b4c806666e087ae3cebcc5e9273bd6b627",
	"seed-variant":
		"b376bd1599822ab9f1eed532f3864871c5fcb02388db6a68c26a536b50e1ec49",
	"negative-handle": SOURCE_PIN,
	neutral: SOURCE_PIN,
});
export const ACTIVE_IDS = Object.freeze([
	"static-ice",
	"before-stamp",
	"stamp-full",
	"hold-end",
	"recover-half",
	"recovered",
	"restamped",
	"seed-variant",
]);
export const BYPASS_IDS = Object.freeze(["negative-handle", "neutral"]);
export const DEFAULT_GATES = Object.freeze({
	native: Object.freeze({
		maxRgbError: 2,
		meanRgbError: 0.15,
		maxAlphaError: 0,
	}),
	presentation: Object.freeze({
		maxRgbError: 5,
		meanRgbError: 0.5,
		maxAlphaError: 0,
	}),
	source: Object.freeze({
		maxRgbError: 1,
		meanRgbError: 0.1,
		maxAlphaError: 0,
	}),
	fidelity: Object.freeze({
		maxRgbError: 1,
		meanRgbError: 0.1,
		maxAlphaError: 0,
	}),
});
const fail = (message) => {
	throw new Error(message);
};
function shape(value, keys, label) {
	if (
		!value ||
		(Object.getPrototypeOf(value) !== Object.prototype &&
			Object.getPrototypeOf(value) !== null)
	)
		fail(`${label}: plain own-field DTO required`);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (
		Reflect.ownKeys(descriptors).length !== keys.length ||
		keys.some(
			(key) =>
				!Object.hasOwn(descriptors, key) ||
				!Object.hasOwn(descriptors[key], "value"),
		)
	)
		fail(`${label}: exact own data fields required`);
	// Consume descriptor values once. Shape validation must not authorize later
	// reads through caller getters or Proxy get traps.
	return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const internalLength = Object.getOwnPropertyDescriptor(
	typedArrayPrototype,
	"length",
).get;
const internalTag = Object.getOwnPropertyDescriptor(
	typedArrayPrototype,
	Symbol.toStringTag,
).get;
const internalSet = Uint8Array.prototype.set;
function bytes(value, label) {
	// Built-ins read typed-array internal slots, never caller length/buffer getters,
	// instance methods, iterators, constructors, or Symbol.species. Proxies fail closed.
	if (
		internalTag.call(value) !== "Uint8Array" ||
		internalLength.call(value) !== 12288
	)
		fail(`${label}: 12288 RGBA8 bytes required`);
	const trusted = new Uint8Array(12288);
	internalSet.call(trusted, value);
	return trusted;
}
function pinned(value, pin, label) {
	if (createHash("sha256").update(value).digest("hex") !== pin)
		fail(`${label}: frozen SHA256 mismatch`);
}
function equal(a, b, label) {
	if (a.length !== b.length || a.some((value, i) => value !== b[i]))
		fail(`${label}: byte mismatch`);
}
function alpha(a, source, label) {
	for (let i = 3; i < a.length; i += 4)
		if (a[i] !== source[i]) fail(`${label}: alpha mismatch at ${(i / 4) | 0}`);
}
export function compareRgba(a, b, premultiplied = false) {
	a = bytes(a, "actual");
	b = bytes(b, "expected");
	if (typeof premultiplied !== "boolean")
		fail("premultiplied: boolean required");
	let maxRgbError = 0,
		sum = 0,
		maxAlphaError = 0;
	for (let i = 0; i < a.length; i += 4) {
		for (let c = 0; c < 3; c++) {
			const d = Math.abs(
				premultiplied
					? (a[i + c] * a[i + 3]) / 255 - (b[i + c] * b[i + 3]) / 255
					: a[i + c] - b[i + c],
			);
			maxRgbError = Math.max(maxRgbError, d);
			sum += d;
		}
		maxAlphaError = Math.max(maxAlphaError, Math.abs(a[i + 3] - b[i + 3]));
	}
	return { maxRgbError, meanRgbError: sum / 9216, maxAlphaError };
}
// Independent fixed fixture geometry, not production optical/time code.
export function independentPlateauMask() {
	const mask = new Uint8Array(3072);
	for (let y = 0; y < 48; y++)
		for (let x = 0; x < 64; x++) {
			const px = x + 0.5,
				py = y + 0.5;
			const nearestX = Math.max(12.8, Math.min(51.2, px));
			if (Math.hypot(px - nearestX, py - 24) < 5.76 - 1e-6)
				mask[y * 64 + x] = 1;
		}
	return mask;
}
function validateGates(gates) {
	gates = shape(
		gates,
		["native", "presentation", "source", "fidelity"],
		"gates",
	);
	const trusted = {};
	for (const [name, gate] of Object.entries(gates)) {
		const snapshot = shape(
			gate,
			["maxRgbError", "meanRgbError", "maxAlphaError"],
			name,
		);
		for (const value of Object.values(snapshot))
			if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
				fail(`${name}: finite nonnegative gate required`);
		if (snapshot.maxAlphaError !== 0) fail(`${name}: alpha gate must be zero`);
		for (const key of Object.keys(snapshot))
			if (snapshot[key] > DEFAULT_GATES[name][key])
				fail(`${name}: pre-output policy cannot be loosened`);
		trusted[name] = Object.freeze(snapshot);
	}
	return Object.freeze(trusted);
}
function validateIdentity(identity) {
	const names = [
		"source",
		"expected",
		"shader",
		"uniforms",
		"runner",
		"build",
		"wasm",
		"backend",
	];
	identity = shape(identity, names, "identity");
	for (const name of names) {
		const receipt = shape(
			identity[name],
			["expected", "actual", "verified"],
			`identity.${name}`,
		);
		if (
			receipt.verified !== true ||
			typeof receipt.expected !== "string" ||
			!receipt.expected.trim() ||
			receipt.actual !== receipt.expected
		)
			fail(`identity.${name}: verified matching nonempty identity required`);
	}
}
export function checkFrostGpuArtifacts(input) {
	let stage = "shape";
	try {
		input = shape(
			input,
			[
				"width",
				"height",
				"source",
				"canonicalSource",
				"records",
				"identity",
				"gates",
			],
			"input",
		);
		if (input.width !== 64 || input.height !== 48)
			fail("dimensions: fixed 64x48 required");
		const gates = validateGates(input.gates);
		stage = "identity";
		validateIdentity(input.identity);
		stage = "hard-invariants";
		input = {
			...input,
			gates,
			source: bytes(input.source, "source"),
			canonicalSource: bytes(input.canonicalSource, "canonicalSource"),
		};
		pinned(input.source, SOURCE_PIN, "source");
		alpha(input.canonicalSource, input.source, "canonicalSource");
		if (!Array.isArray(input.records) || input.records.length !== 10)
			fail("exactly 8 active and 2 bypass records required");
		const byId = new Map(),
			mask = independentPlateauMask();
		let holes = 0,
			plateau = 0,
			positive = 0;
		const histogram = new Map();
		for (let p = 0; p < 3072; p++) {
			const a = input.source[p * 4 + 3];
			histogram.set(a, (histogram.get(a) || 0) + 1);
			if (a === 255)
				equal(
					input.canonicalSource.subarray(p * 4, p * 4 + 4),
					input.source.subarray(p * 4, p * 4 + 4),
					"canonicalSource opaque",
				);
			if (input.source[p * 4 + 3] === 0) holes++;
			if (mask[p]) {
				plateau++;
				if (input.source[p * 4 + 3]) positive++;
			}
		}
		if (
			histogram.size !== 3 ||
			histogram.get(0) !== 109 ||
			histogram.get(96) !== 424 ||
			histogram.get(255) !== 2539
		)
			fail("source alpha histogram mismatch");
		if (holes !== 109 || plateau !== 568 || positive !== 459)
			fail("fixture mask/count mismatch");
		for (let record of input.records) {
			const descriptor =
				record && Object.getOwnPropertyDescriptor(record, "id");
			if (
				!descriptor ||
				!Object.hasOwn(descriptor, "value") ||
				typeof descriptor.value !== "string" ||
				byId.has(descriptor.value)
			)
				fail("record ID must be unique own data field");
			const id = descriptor.value;
			const active = ACTIVE_IDS.includes(id);
			if (!active && !BYPASS_IDS.includes(id)) fail("unknown case ID");
			record = shape(
				record,
				active
					? [
							"id",
							"kind",
							"passCount",
							"expected",
							"nativeRgba",
							"canonicalNativeRgba",
							"canvasRgba",
							"diagnosticCanvasRgba",
							"rawCanvasRgba",
						]
					: ["id", "kind", "passCount", "expected", "fixtureRgba"],
				id,
			);
			if (
				record.id !== id ||
				record.kind !== (active ? "active" : "resolver-fixture") ||
				record.passCount !== (active ? 1 : 0)
			)
				fail(`${record.id}: classification/pass count mismatch`);
			for (const [key, value] of Object.entries(record))
				if (key === "expected" || key.endsWith("Rgba")) {
					record[key] = bytes(value, `${record.id}.${key}`);
					alpha(record[key], input.source, `${record.id}.${key}`);
				}
			pinned(record.expected, EXPECTED_PINS[id], `${id}.expected`);
			if (!active) {
				equal(record.expected, input.source, `${record.id}.expected`);
				equal(record.fixtureRgba, input.source, `${record.id}.fixture`);
			} else {
				for (let p = 0; p < 3072; p++) {
					const offset = p * 4;
					if (input.source[offset + 3] === 0)
						for (const key of ["nativeRgba", "canonicalNativeRgba"])
							if (record[key].subarray(offset, offset + 4).some((v) => v !== 0))
								fail(`${record.id}.${key}: hidden RGB leak`);
					if (
						mask[p] &&
						input.source[offset + 3] &&
						["stamp-full", "hold-end"].includes(record.id)
					)
						equal(
							record.nativeRgba.subarray(offset, offset + 4),
							input.source.subarray(offset, offset + 4),
							`${record.id}: plateau`,
						);
				}
				equal(
					record.canvasRgba,
					record.diagnosticCanvasRgba,
					`${record.id}: default/diagnostic canonical Canvas`,
				);
			}
			byId.set(record.id, record);
		}
		for (const group of [
			["static-ice", "before-stamp", "recovered"],
			["stamp-full", "hold-end"],
		])
			for (const id of group.slice(1))
				equal(
					byId.get(group[0]).nativeRgba,
					byId.get(id).nativeRgba,
					`equivalence ${id}`,
				);
		const metrics = {};
		const assess = (label, a, b, premul, gate) => {
			const result = compareRgba(a, b, premul);
			metrics[label] = result;
			if (Object.keys(result).some((key) => result[key] > gate[key]))
				fail(`${label}: scalar gate exceeded`);
		};
		stage = "fidelity";
		for (const id of ACTIVE_IDS) {
			const r = byId.get(id);
			assess(
				`${id}.raw-fidelity`,
				r.rawCanvasRgba,
				r.nativeRgba,
				true,
				input.gates.fidelity,
			);
			assess(
				`${id}.canonical-fidelity`,
				r.canvasRgba,
				r.canonicalNativeRgba,
				true,
				input.gates.fidelity,
			);
		}
		stage = "scalar";
		assess(
			"source",
			input.canonicalSource,
			input.source,
			true,
			input.gates.source,
		);
		for (const id of ACTIVE_IDS) {
			const r = byId.get(id);
			assess(
				`${id}.native`,
				r.nativeRgba,
				r.expected,
				false,
				input.gates.native,
			);
			assess(
				`${id}.canonical`,
				r.canvasRgba,
				r.expected,
				true,
				input.gates.presentation,
			);
			assess(
				`${id}.raw-canvas`,
				r.rawCanvasRgba,
				r.expected,
				true,
				input.gates.presentation,
			);
		}
		return {
			status: "partial",
			artifactChecksPassed: true,
			runtimeAccepted: false,
			runtimeAuthorized: false,
			activeNativeFrames: 8,
			resolverFixtures: 2,
			metrics,
			reason:
				"Caller identity receipts are not independent GPU execution proof; actual runner binding remains required.",
		};
	} catch (error) {
		return {
			status: "failed",
			artifactChecksPassed: false,
			runtimeAccepted: false,
			runtimeAuthorized: false,
			stage,
			reason: error.message,
		};
	}
}
