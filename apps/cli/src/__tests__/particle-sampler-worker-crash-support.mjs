// Test-only process crash after the fixed sample operation starts.
export { particleTransportPolicyJson } from "./particle-policy-fixture.mjs";
export function sampleParticleSurfaceJson() {
	process.exit(9);
}
