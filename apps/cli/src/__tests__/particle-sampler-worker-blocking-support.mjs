// Test-only module: prove termination interrupts a real synchronous WASM loop.
// This is not the Rust sampler and is never reachable from the public factory.
import { writeFileSync } from "node:fs";
export { particleTransportPolicyJson } from "./particle-policy-fixture.mjs";
const bytes = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 7, 8, 1, 4, 115,
	112, 105, 110, 0, 0, 10, 9, 1, 7, 0, 3, 64, 12, 0, 11, 11,
]);
const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes));
export function sampleParticleSurfaceJson(json) {
	writeFileSync(JSON.parse(json).markerPath, "entered", { flag: "wx" });
	instance.exports.spin();
	return "{}";
}
