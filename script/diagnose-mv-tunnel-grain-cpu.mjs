import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import vm from "node:vm";

// Read-only command/input observation. No browser, raster substitute or writes.
const [referenceRoot, pairedArtifact, oracleArtifact, authorityRoot] = process.argv.slice(2);
assert.ok(referenceRoot && pairedArtifact && oracleArtifact && authorityRoot,
	"reference, paired artifact, oracle artifact and authority directories required");
const root = process.cwd();
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const bytes = path => readFileSync(path);
const text = path => new TextDecoder("utf-8", { fatal: true }).decode(bytes(path));
const json = path => JSON.parse(text(path));
const identity = path => ({ path: resolve(path), bytes: bytes(path).length, sha256: digest(bytes(path)) });
const pairedReport = json(join(pairedArtifact, "verification.json"));
const planPath = join(pairedArtifact, "native-production-root-plan.json");
const plan = json(planPath);
const grain = plan.data.commands.find(command => command.kind === "grain");
assert.equal(plan.kind, "tunnel");
assert.ok(grain);
assert.equal(pairedReport.sourceIdentityStable, true);
assert.equal(pairedReport.result.metadata.index, 15);
assert.equal(pairedReport.result.metadata.frame.time * 120000, 1500000);
const packageDirectory = join(authorityRoot, "browser-pkg-v2-sntQBC");
const binary = identity(join(packageDirectory, "opencut_wasm_bg.wasm"));
assert.equal(binary.sha256, pairedReport.wasmIdentity.files["opencut_wasm_bg.wasm"].sha256);
const packageReport = json(join(packageDirectory, "verification.json"));
assert.equal(packageReport.sourceManifestSha256, pairedReport.rustIdentity.manifestSha256);

const engineDirectory = join(referenceRoot, "skills/vocaloid-style-mv/template/engine");
const utilPath = join(engineDirectory, "core/util.js");
const typoPath = join(engineDirectory, "scenes/typo.js");
const util = text(utilPath), typo = text(typoPath);
for (const [id, path] of [["core/util.js", utilPath], ["scenes/typo.js", typoPath]])
	assert.equal(identity(path).sha256, pairedReport.referenceSources.find(source => source.id === id).sha256);
const extracted = [
	typo.match(/^  const W = .*$/m)?.[0],
	typo.match(/^  const fq = .*$/m)?.[0],
	typo.match(/^  const resetCtx = .*$/m)?.[0],
	typo.slice(typo.indexOf("  let grainTile = null;"), typo.indexOf("  // tileable value-noise")),
];
assert.ok(extracted.every(Boolean));
const rasterPath = join(root, "packages/editor-classic/src/services/renderer/programmatic/mv-ember-raster.ts");
assert.equal(identity(rasterPath).sha256,
	pairedReport.sourceInputs.find(source => source.path.endsWith("mv-ember-raster.ts")).sha256);
const raster = text(rasterPath).match(/String\.raw`([\s\S]*)`;\s*$/)?.[1];
assert.ok(raster);

function fakeContext(initialFill = "#000000") {
	const calls = [], stack = [];
	let matrix = [1, 0, 0, 1, 0, 0];
	const state = { globalAlpha: 1, globalCompositeOperation: "source-over", filter: "none", fillStyle: initialFill };
	const snapshot = () => ({ transform: [...matrix], ...state });
	const record = (method, args) => calls.push({ method, args, before: snapshot() });
	const methods = {
		save() { record("save", []); stack.push({ matrix: [...matrix], state: { ...state } }); },
		restore() { record("restore", []); const old = stack.pop(); assert.ok(old); matrix = old.matrix; Object.assign(state, old.state); },
		setTransform(...args) {
			record("setTransform", args);
			matrix = args.length === 1 ? [args[0].a, args[0].b, args[0].c, args[0].d, args[0].e, args[0].f] : args;
		},
		getTransform() { record("getTransform", []); return Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((k, i) => [k, matrix[i]])); },
		translate(x, y) { record("translate", [x, y]); matrix[4] += x; matrix[5] += y; },
		createRadialGradient(...args) {
			record("createRadialGradient", args);
			const gradient = { kind: "radial", args, transform: [...matrix], stops: [], addColorStop(offset, color) { gradient.stops.push({ offset, color }); } };
			return gradient;
		},
		createPattern(tile, repeat) { record("createPattern", [{ size: [tile.width, tile.height], rgbaSha256: digest(tile.rgba) }, repeat]); return { kind: "pattern", repeat }; },
		fillRect(...args) { record("fillRect", args); },
	};
	const ctx = new Proxy(methods, {
		get(target, key) { return key in target ? target[key] : state[key]; },
		set(_target, key, value) { calls.push({ set: String(key), value }); state[key] = value; return true; },
	});
	return { ctx, calls };
}
function surfaces() {
	const allocated = [];
	const make = (width, height) => {
		const canvas = { width, height, rgba: undefined, getContext() {
			return { createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
				putImageData(image) { canvas.rgba = image.data.slice(); } };
		} };
		allocated.push(canvas); return canvas;
	};
	return { make, allocated };
}
const originalSurface = surfaces(), originalContext = fakeContext({ kind: "reference-vignette" });
const realm = vm.createContext({ window: {}, Uint8ClampedArray });
new vm.Script(util, { filename: utilPath }).runInContext(realm);
realm.Z = realm.window.Z;
realm.Z.canvas = originalSurface.make;
new vm.Script(extracted.join("\n"), { filename: typoPath + ":extracted-filmGrain" }).runInContext(realm);
realm.ctx = originalContext.ctx;
new vm.Script("filmGrain(ctx,12.5,0.07,'overlay')").runInContext(realm);
const nativeSurface = surfaces(), nativeContext = fakeContext();
const nativeRealm = vm.createContext({ Uint8ClampedArray, ctx: nativeContext.ctx, command: grain, make: size => nativeSurface.make(...size) });
new vm.Script(raster, { filename: rasterPath + ":raw-production-functions" }).runInContext(nativeRealm);
new vm.Script("mvEmberTransform(ctx,command); mvEmberGrain(ctx,command,make)").runInContext(nativeRealm);
const originalRgba = originalSurface.allocated[0].rgba, nativeRgba = nativeSurface.allocated[0].rgba;
assert.deepEqual(originalRgba, nativeRgba, "All actual reference-generated and captured Rust-plan grain bytes must agree");
const oracleCommands = json(join(oracleArtifact, "oracle-repeat-diagnostic.json")).metadata.baselineCommands;
assert.equal(json(join(oracleArtifact, "verification.json")).sourceIdentityStable, true);
const realPattern = oracleCommands.find(command => command.method === "createPattern" && command.before.composite === "overlay");
const realDraw = oracleCommands.find(command => command.method === "fillRect" && command.before.composite === "overlay");
const fakePattern = originalContext.calls.find(command => command.method === "createPattern");
assert.deepEqual(fakePattern.before.transform, realPattern.before.transform);
assert.equal(fakePattern.before.globalAlpha, realPattern.before.alpha);
assert.deepEqual(originalContext.calls.find(command => command.method === "fillRect").args, realDraw.args);
assert.deepEqual(grain.transform, realDraw.before.transform);

const sceneNames = ["originalOmitted", "nativeOmitted", "original", "production"];
const scenes = Object.fromEntries(sceneNames.map(name => [name, bytes(join(pairedArtifact, name + "-scene.rgba"))]));
const neighborhood = [];
for (let y = 747; y <= 749; y++) for (let x = 102; x <= 104; x++) {
	const tileX = (x - grain.transform[4]) % 256, tileY = (y - grain.transform[5]) % 256;
	neighborhood.push({ x, y, tile: [tileX, tileY], gray: grain.gray[tileY * 256 + tileX],
		rgba: Object.fromEntries(sceneNames.map(name => [name, [...scenes[name].subarray((y * 1920 + x) * 4, (y * 1920 + x) * 4 + 4)]])) });
}
const rustPins = ["tunnel_layers.rs", "converge_math.rs"].map(file => {
	const relative = "rust/crates/editor-api/src/mv_recipe/" + file;
	const snapshot = identity(join(authorityRoot, "source", relative)), current = identity(join(root, relative));
	assert.equal(snapshot.sha256, current.sha256);
	const admitted = pairedReport.rustIdentity.currentMatchingSources.find(item => item.path === relative);
	assert.equal(snapshot.sha256, admitted.sha256);
	return { relative, snapshot, current };
});
const targetPixel = neighborhood.find(point => point.x === 103 && point.y === 748);
const counterfactualDestination = targetPixel.rgba.originalOmitted.slice(0, 3);
const idealOverlay = counterfactualDestination.map(destination =>
	destination + grain.opacity * (2 * destination * targetPixel.gray / 255 - destination));
console.log(JSON.stringify({
	status: "bounded CPU observation; input bytes agree, exact raster cause unresolved",
	scope: "fakeCanvas records production/reference calls only; no real raster, browser or acceptance decision",
	fullMatrixTested: false, thresholdsUnchanged: true, sourceMapping: { index: 15, songTicks: 1500000, songTime: 12.5, grainFrame24: 300 },
	pins: { binary, sourceManifestSha256: packageReport.sourceManifestSha256, rustPins,
		inputs: [utilPath, typoPath, rasterPath, planPath, join(pairedArtifact, "verification.json"), join(oracleArtifact, "oracle-repeat-diagnostic.json"), ...sceneNames.map(name => join(pairedArtifact, name + "-scene.rgba"))].map(identity) },
	inputComparison: { seed: 4242, stream: "reference util.js executed unchanged (mulberry32); Rust captured plan from pinned WASM", all65536GrayBytesEqual: true,
		rgbaSha256: digest(originalRgba), transform: grain.transform, rect: grain.rect, alpha: grain.opacity, composite: "overlay", first16Gray: grain.gray.slice(0, 16) },
	commandObservation: { referenceFake: originalContext.calls, nativeFake: nativeContext.calls, realOraclePattern: realPattern, realOracleDraw: realDraw },
	neighborhood,
	conditionalAlgebra: { scope: "Opaque-destination scalar overlay model, NOT Canvas raster emulation",
		assumption: "Omission capture equals the true normal-render destination immediately before grain (not established)",
		idealUnroundedRgb: idealOverlay, nearestByteRgb: idealOverlay.map(Math.round),
		actualOracleRgb: targetPixel.rgba.original.slice(0, 3), actualNativeRgb: targetPixel.rgba.production.slice(0, 3) },
	interpretation: {
		ruledOutAtThisSample: "No seed/RNG, grayscale byte, integer pattern-offset, extent or declared opacity mismatch at frame15. The two current Rust source pins agree with the frozen compiled source and prior browser admission.",
		remainingDifferences: ["Reference sets overlay/.07 before createPattern; native sets them after createPattern (at creation native is source-over/1).",
			"Reference inherits the already drawn vignette gradient; native per-command isolation recreates and reassigns a nominally identical fillHistory gradient.",
			"Reference grain tile is cached across calls in its realm; native allocates a new tile per frame. Bytes match, object and backend residency do not."],
		minimalCandidate: "After fillHistory restoration, move native overlay/globalAlpha assignments to BEFORE createPattern, retaining the existing fillHistory. This aligns the observed pattern-creation state; it is only a proposed diagnostic patch, not an established fix.",
		authority: "No production source was changed. Seek parent authorization before applying the candidate and test only a bounded paired normal frame15 raster before any acceptance claim.",
		unresolved: "Cannot distinguish real Canvas batching/paint-history differences from a normal-render pre-grain raster difference using these separate-render artifacts. No specific GPU cause established."
	},
	limits: ["Captured plan was evaluated by the prior real pinned WASM browser run; this CPU run does not invoke a new WASM evaluation.",
		"No actual pattern/composite cache state is simulated by fakeCanvas.", "Grain omission is a separate-render counterfactual, not a same-render pre-grain pixel snapshot; omission may affect batching/history."]
}, null, 2));
