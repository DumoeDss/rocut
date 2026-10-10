import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
	ACTIVE_IDS,
	BYPASS_IDS,
	DEFAULT_GATES,
	checkFrostGpuArtifacts,
	compareRgba,
	independentPlateauMask,
} from "./frost-gpu-invariants.mjs";

// Read-only independent frozen evidence. No production-output artifact is created.
const root =
	process.env.FROST_INDEPENDENT_FIXTURE_ROOT ||
	"C:/tmps/frost-independent-sol-v7Y8dV";
const pins = {
	source: "577662c959e5969630dc4cda0bb0d9f0edfe284caffa1e717a18338bbe4f11a0",
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
};
function readPinned(name) {
	const path = `${root}/${name === "source" ? "source-poison-holes" : `expected-${name}`}.rgba`;
	const value = readFileSync(path);
	assert.equal(value.length, 12288);
	assert.equal(
		createHash("sha256").update(value).digest("hex"),
		pins[name] || pins.source,
	);
	return new Uint8Array(value);
}
const source = readPinned("source");
const expected = new Map(
	[...ACTIVE_IDS, ...BYPASS_IDS].map((id) => [id, readPinned(id)]),
);
test("permanent policy matches fixed comparator modes, gates and independent mask", () => {
	const policy = JSON.parse(
		readFileSync(
			new URL(
				"../docs/evidence/frost-gpu-preoutput-gates.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	for (const [qa, spec] of [
		["native", "native"],
		["presentation", "presentation"],
		["source", "source"],
		["fidelity", "presentationFidelity"],
	]) {
		const { mode, ...numeric } = policy.gates[spec];
		assert.deepEqual(DEFAULT_GATES[qa], numeric);
		if (qa === "source" || qa === "fidelity")
			assert.equal(mode, "premultiplied");
	}
	assert.equal(
		policy.hardInvariantsBeforeScalarGates.plateau.interiorMarginPixels,
		1e-6,
	);
	assert.deepEqual(policy.fixture.alphaHistogram, {
		0: 109,
		96: 424,
		255: 2539,
	});
});
function dto() {
	const canonicalSource = source.slice();
	for (let i = 0; i < canonicalSource.length; i += 4)
		if (!canonicalSource[i + 3]) canonicalSource.fill(0, i, i + 4);
	return {
		width: 64,
		height: 48,
		source: source.slice(),
		canonicalSource,
		gates: structuredClone(DEFAULT_GATES),
		identity: Object.fromEntries(
			[
				"source",
				"expected",
				"shader",
				"uniforms",
				"runner",
				"build",
				"wasm",
				"backend",
			].map((name) => [
				name,
				{
					expected: `synthetic-test-receipt:${name}`,
					actual: `synthetic-test-receipt:${name}`,
					verified: true,
				},
			]),
		),
		records: [
			...ACTIVE_IDS.map((id) => ({
				id,
				kind: "active",
				passCount: 1,
				expected: expected.get(id).slice(),
				nativeRgba: expected.get(id).slice(),
				canonicalNativeRgba: expected.get(id).slice(),
				canvasRgba: expected.get(id).slice(),
				diagnosticCanvasRgba: expected.get(id).slice(),
				rawCanvasRgba: expected.get(id).slice(),
			})),
			...BYPASS_IDS.map((id) => ({
				id,
				kind: "resolver-fixture",
				passCount: 0,
				expected: expected.get(id).slice(),
				fixtureRgba: source.slice(),
			})),
		],
	};
}
function rejected(mutate, stage, pattern) {
	const input = dto();
	mutate(input);
	const result = checkFrostGpuArtifacts(input);
	assert.equal(result.status, "failed", JSON.stringify(result));
	assert.equal(result.runtimeAccepted, false);
	if (stage) assert.equal(result.stage, stage);
	if (pattern) assert.match(result.reason, pattern);
}
test("frozen expected test DTO passes offline checks but can only be partial", () => {
	const result = checkFrostGpuArtifacts(dto());
	assert.equal(result.status, "partial", JSON.stringify(result));
	assert.equal(result.artifactChecksPassed, true);
	assert.equal(result.runtimeAccepted, false);
	assert.equal(result.runtimeAuthorized, false);
	assert.equal(result.activeNativeFrames, 8);
	assert.equal(result.resolverFixtures, 2);
});
test("descriptor snapshots prevent gate Proxy reads from loosening scalar policy", () => {
	let reads = 0;
	const hostile = (gate) =>
		new Proxy(gate, {
			get(target, key) {
				if (key === "maxRgbError" || key === "meanRgbError") {
					reads++;
					return reads <= 4 ? target[key] : 1_000_000;
				}
				return target[key];
			},
		});
	const d = dto();
	for (const name of ["native", "presentation"])
		d.gates[name] = hostile(d.gates[name]);
	for (const key of [
		"nativeRgba",
		"canonicalNativeRgba",
		"canvasRgba",
		"diagnosticCanvasRgba",
		"rawCanvasRgba",
	])
		for (let i = 0; i < d.records[7][key].length; i += 4)
			if (d.records[7][key][i + 3])
				d.records[7][key][i] = Math.min(255, d.records[7][key][i] + 32);
	const result = checkFrostGpuArtifacts(d);
	assert.equal(result.status, "failed", JSON.stringify(result));
	assert.equal(result.stage, "scalar");
	assert.match(result.reason, /scalar gate exceeded/);
	assert.equal(result.runtimeAccepted, false);
	assert.equal(reads, 0);
});
test("top-level and nested DTO get traps cannot replace descriptor data", () => {
	let reads = 0;
	const hostile = (value) =>
		new Proxy(value, {
			get() {
				reads++;
				throw Error("caller get trap must not execute");
			},
		});
	const d = dto();
	for (const name of Object.keys(d.gates))
		d.gates[name] = hostile(d.gates[name]);
	d.gates = hostile(d.gates);
	for (const name of Object.keys(d.identity))
		d.identity[name] = hostile(d.identity[name]);
	d.identity = hostile(d.identity);
	d.records = d.records.map(hostile);
	assert.equal(checkFrostGpuArtifacts(hostile(d)).status, "partial");
	assert.equal(reads, 0);
	const changed = dto();
	changed.gates.native.maxRgbError = 3;
	changed.gates.native = new Proxy(changed.gates.native, {
		get: (_, key) => DEFAULT_GATES.native[key],
	});
	const result = checkFrostGpuArtifacts(changed);
	assert.equal(result.status, "failed");
	assert.equal(result.stage, "shape");
	assert.match(result.reason, /cannot be loosened/);
	const strict = dto();
	for (const gate of Object.values(strict.gates))
		for (const key of Object.keys(gate)) gate[key] = 0;
	assert.equal(checkFrostGpuArtifacts(strict).status, "partial");
});
test("independent geometric mask and all frozen file pins", () => {
	const mask = independentPlateauMask();
	assert.equal(
		mask.reduce((a, b) => a + b, 0),
		568,
	);
	assert.equal(
		mask.reduce((a, b, p) => a + (b && source[p * 4 + 3] ? 1 : 0), 0),
		459,
	);
});
test("strict shape, lengths, format, classifications and identity", () => {
	rejected(
		(d) => {
			d.records[0].nativeRgba = new Uint8Array(4);
		},
		"hard-invariants",
		/12288/,
	);
	rejected((d) => {
		d.records[0].nativeRgba = Array.from(d.records[0].nativeRgba);
	}, "hard-invariants");
	rejected((d) => {
		d.width = 48;
	}, "shape");
	rejected((d) => {
		d.format = "BGRA";
	}, "shape");
	rejected((d) => {
		d.records[8].passCount = 1;
	}, "hard-invariants");
	rejected((d) => {
		d.records[8].kind = "active";
	}, "hard-invariants");
	rejected((d) => {
		d.records[1].id = d.records[0].id;
	}, "hard-invariants");
	rejected((d) => {
		d.identity.wasm.actual = "wrong-build";
	}, "identity");
	rejected((d) => {
		delete d.identity.backend;
	}, "identity");
	rejected((d) => {
		d.identity.backend.verified = false;
	}, "identity");
	rejected((d) => {
		d.identity.backend.expected = d.identity.backend.actual = "";
	}, "identity");
	rejected((d) => {
		d.identity.backend = Object.create(d.identity.backend);
	}, "identity");
	rejected((d) => {
		d.gates.native.meanRgbError = NaN;
	}, "shape");
	rejected((d) => {
		d.gates.native.maxRgbError = Infinity;
	}, "shape");
	rejected((d) => {
		delete d.gates.source.maxRgbError;
	}, "shape");
	rejected((d) => {
		d.gates.fidelity = Object.create(d.gates.fidelity);
	}, "shape");
	rejected((d) => {
		d.gates.source.maxAlphaError = 1;
	}, "shape");
	rejected((d) => {
		d.gates.native.maxRgbError = 3;
	}, "shape");
	let getterCalls = 0;
	rejected((d) => {
		Object.defineProperty(d.records[0], "id", {
			get() {
				getterCalls++;
				return "static-ice";
			},
		});
	}, "hard-invariants");
	assert.equal(getterCalls, 0);
	rejected((d) => {
		const id = d.records[0].id;
		delete d.records[0].id;
		Object.setPrototypeOf(d.records[0], { id });
	}, "hard-invariants");
});
test("actual source and expected hashes cannot be replaced by caller receipts", () => {
	rejected(
		(d) => {
			d.source[0] ^= 1;
		},
		"hard-invariants",
		/source: frozen SHA256/,
	);
	rejected(
		(d) => {
			d.records[7].expected[0] ^= 1;
		},
		"hard-invariants",
		/expected: frozen SHA256/,
	);
	const opaque = source.findIndex((v, i) => i % 4 === 3 && v === 255) - 3;
	rejected(
		(d) => {
			d.canonicalSource[opaque] ^= 1;
		},
		"hard-invariants",
		/opaque/,
	);
	rejected(
		(d) => {
			d.source[3] = 95;
		},
		"hard-invariants",
		/source: frozen SHA256/,
	);
});
test("hidden RGB and alpha fail before scalar gates", () => {
	const hole = source.findIndex((v, i) => i % 4 === 3 && v === 0) - 3;
	rejected(
		(d) => {
			d.records[0].nativeRgba[hole] = 1;
		},
		"hard-invariants",
		/hidden RGB/,
	);
	rejected(
		(d) => {
			d.records[0].canonicalNativeRgba[hole] = 1;
		},
		"hard-invariants",
		/hidden RGB/,
	);
	rejected(
		(d) => {
			d.records[0].nativeRgba[3]++;
		},
		"hard-invariants",
		/alpha/,
	);
	rejected(
		(d) => {
			d.canonicalSource[3]++;
		},
		"hard-invariants",
		/alpha/,
	);
});
test("plateau and exact relationships reject otherwise tiny changes", () => {
	const mask = independentPlateauMask();
	const p = mask.findIndex((v, i) => v && source[i * 4 + 3]);
	rejected(
		(d) => {
			d.records[2].nativeRgba[p * 4] ^= 1;
		},
		"hard-invariants",
		/plateau/,
	);
	rejected(
		(d) => {
			d.records[1].nativeRgba[0] ^= 1;
		},
		"hard-invariants",
		/equivalence/,
	);
	rejected(
		(d) => {
			d.records[0].diagnosticCanvasRgba[0] ^= 1;
		},
		"hard-invariants",
		/default\/diagnostic/,
	);
	rejected(
		(d) => {
			d.records[8].fixtureRgba[0] ^= 1;
		},
		"hard-invariants",
		/fixture/,
	);
});
test("correct fidelity pairs, not swapped raw/canonical ingress", () => {
	rejected(
		(d) => {
			d.records[7].rawCanvasRgba[0] ^= 32;
		},
		"fidelity",
		/raw-fidelity/,
	);
	rejected(
		(d) => {
			d.records[7].canonicalNativeRgba[0] ^= 32;
		},
		"fidelity",
		/canonical-fidelity/,
	);
	const d = dto();
	// Canonical ingress may differ from raw ingress without violating fidelity.
	for (const key of [
		"canonicalNativeRgba",
		"canvasRgba",
		"diagnosticCanvasRgba",
	])
		for (let i = 0; i < d.records[7][key].length; i += 4)
			if (d.records[7][key][i + 3])
				d.records[7][key][i] = Math.min(255, d.records[7][key][i] + 1);
	assert.equal(checkFrostGpuArtifacts(d).status, "partial");
});
test("wrong-time, R/B swap, ignored effect, premultiplied-native and global +1 negatives", () => {
	const update = (d, transform) => {
		const r = d.records[7];
		for (const key of [
			"nativeRgba",
			"canonicalNativeRgba",
			"canvasRgba",
			"diagnosticCanvasRgba",
			"rawCanvasRgba",
		])
			r[key] = transform(r[key]);
	};
	rejected(
		(d) => update(d, () => expected.get("static-ice").slice()),
		"scalar",
	);
	rejected(
		(d) =>
			update(d, (a) => {
				for (let i = 0; i < a.length; i += 4)
					[a[i], a[i + 2]] = [a[i + 2], a[i]];
				return a;
			}),
		"scalar",
	);
	rejected((d) => update(d, () => d.canonicalSource.slice()), "scalar");
	rejected(
		(d) =>
			update(d, (a) => {
				for (let i = 0; i < a.length; i += 4)
					for (let c = 0; c < 3; c++)
						a[i + c] = Math.round((a[i + c] * a[i + 3]) / 255);
				return a;
			}),
		"scalar",
	);
	rejected(
		(d) =>
			update(d, (a) => {
				for (let i = 0; i < a.length; i += 4)
					if (a[i + 3]) a[i] = Math.min(255, a[i] + 1);
				return a;
			}),
		"scalar",
	);
});
test("hostile typed-array methods cannot conceal the independent red hole", () => {
	const hole = source.findIndex((v, i) => i % 4 === 3 && v === 0) - 3;
	rejected(
		(d) => {
			for (const r of d.records
				.slice(0, 6)
				.filter((r) =>
					["static-ice", "before-stamp", "recovered"].includes(r.id),
				))
				for (const key of ["nativeRgba", "canonicalNativeRgba"]) {
					r[key][hole] = 1;
					r[key].subarray = () => new Uint8Array(4);
					r[key].some = () => false;
				}
		},
		"hard-invariants",
		/hidden RGB/,
	);
});
test("normalization ignores hostile getters, iterator and species, preserving real bytes", () => {
	let calls = 0;
	const sabotage = (value) => {
		for (const key of [
			"length",
			"buffer",
			"byteOffset",
			"byteLength",
			"constructor",
		])
			Object.defineProperty(value, key, {
				get() {
					calls++;
					throw Error("hostile getter");
				},
			});
		value.some = () => {
			calls++;
			return false;
		};
		value.subarray = () => {
			calls++;
			return new Uint8Array(4);
		};
		value[Symbol.iterator] = () => {
			calls++;
			throw Error("hostile iterator");
		};
		return value;
	};
	const d = dto();
	d.source = sabotage(d.source);
	d.canonicalSource = sabotage(d.canonicalSource);
	for (const r of d.records)
		for (const key of Object.keys(r))
			if (key === "expected" || key.endsWith("Rgba")) r[key] = sabotage(r[key]);
	assert.equal(checkFrostGpuArtifacts(d).status, "partial");
	assert.equal(calls, 0);
	const a = sabotage(expected.get("seed-variant").slice());
	a[0] ^= 32;
	assert.equal(compareRgba(a, expected.get("seed-variant")).maxRgbError, 32);
	assert.equal(calls, 0);
	rejected((d) => {
		d.records[7].nativeRgba = new Proxy(d.records[7].nativeRgba, {});
	}, "hard-invariants");
	class Hostile extends Uint8Array {
		static get [Symbol.species]() {
			calls++;
			throw Error("species");
		}
	}
	const subclass = new Hostile(expected.get("seed-variant"));
	assert.equal(
		compareRgba(subclass, expected.get("seed-variant")).maxRgbError,
		0,
	);
	assert.equal(calls, 0);
	assert.equal(
		compareRgba(Buffer.from(subclass), new Uint8Array(Buffer.from(subclass)))
			.maxRgbError,
		0,
	);
	const short = new Uint8Array(4);
	Object.defineProperty(short, "length", {
		get() {
			calls++;
			return 12288;
		},
	});
	assert.throws(
		() => compareRgba(short, expected.get("seed-variant")),
		/12288/,
	);
	assert.equal(calls, 0);
});
test("overridden some cannot hide bypass or plateau byte mismatches", () => {
	rejected(
		(d) => {
			d.records[8].fixtureRgba[0] ^= 1;
			d.records[8].fixtureRgba.some = () => false;
		},
		"hard-invariants",
		/fixture/,
	);
	const p = independentPlateauMask().findIndex(
		(v, i) => v && source[i * 4 + 3],
	);
	rejected(
		(d) => {
			d.records[2].nativeRgba[p * 4] ^= 1;
			d.records[2].nativeRgba.subarray = () =>
				source.subarray(p * 4, p * 4 + 4);
		},
		"hard-invariants",
		/plateau/,
	);
});
test("metric includes holes, uses both own alphas and denominator 9216", () => {
	const a = new Uint8Array(12288),
		b = a.slice();
	a[0] = 255;
	a[3] = 96;
	b[0] = 100;
	b[3] = 255;
	const m = compareRgba(a, b, true);
	assert.equal(m.maxRgbError, 4);
	assert.equal(m.meanRgbError, 4 / 9216);
	assert.equal(m.maxAlphaError, 159);
	a[3] = b[3] = 0;
	assert.equal(compareRgba(a, b, true).maxRgbError, 0);
	assert.equal(compareRgba(a, b, false).meanRgbError, 155 / 9216);
});
