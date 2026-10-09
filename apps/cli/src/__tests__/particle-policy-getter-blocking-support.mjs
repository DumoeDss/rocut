// Test-only getter that enters synchronous WASM before discovery can finish.
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const bytes = new Uint8Array([
	0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 7, 8, 1, 4, 115,
	112, 105, 110, 0, 0, 10, 9, 1, 7, 0, 3, 64, 12, 0, 11, 11,
]);
const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes));
export function particleTransportPolicyJson() {
	writeFileSync(
		join(tmpdir(), `particle-policy-getter-${process.pid}.entered`),
		"entered",
		{ flag: "wx" },
	);
	instance.exports.spin();
}
export function sampleParticleSurfaceJson() {
	return "{}";
}
