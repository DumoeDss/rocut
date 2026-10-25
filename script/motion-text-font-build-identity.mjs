import { spawnSync } from "node:child_process";

export function readFontBuildHost(run = spawnSync) {
	const result = run("rustc", ["-vV"], {
		encoding: "utf8", timeout: 10_000, windowsHide: true,
	});
	if (result.error || result.status !== 0 || result.signal) {
		throw new Error("Cannot determine font-readiness build host from rustc -vV");
	}
	const hosts = [...String(result.stdout).matchAll(/^host: ([a-z0-9_]+(?:-[a-z0-9_]+)+)\r?$/gm)];
	if (hosts.length !== 1) throw new Error("rustc -vV must identify exactly one build host");
	return hosts[0][1];
}

function assertIdentity(value, label) {
	if (!value || typeof value !== "object" || Array.isArray(value) ||
		Object.keys(value).sort().join(",") !== "bytes,sha256" ||
		!Number.isSafeInteger(value.bytes) || value.bytes <= 0 ||
		typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) {
		throw new Error(`Invalid font-readiness WASM identity: ${label}`);
	}
}

function assertSameIdentity(observed, reviewed, label) {
	assertIdentity(observed, label);
	assertIdentity(reviewed, `${label} reviewed`);
	if (observed.bytes !== reviewed.bytes || observed.sha256 !== reviewed.sha256) {
		throw new Error(`${label} mismatch: reviewed bytes=${reviewed.bytes} sha256=${reviewed.sha256}; current bytes=${observed.bytes} sha256=${observed.sha256}`);
	}
}

/** Validate both byte identities before mapping the host-specific identity to the baseline.
 * All remaining fields and JSON ordering are left for the existing exact comparison.
 */
export function canonicalFontReportForCheck({ pinned, current, manifest, host }) {
	if (manifest?.schemaVersion !== 1 || typeof manifest.baselineHost !== "string" ||
		!manifest.builds || !Object.hasOwn(manifest.builds, manifest.baselineHost)) {
		throw new Error("Invalid font-readiness build identity manifest/baseline");
	}
	assertSameIdentity(pinned?.source?.canonicalWasm,
		manifest.builds[manifest.baselineHost].wasm, "canonical report baseline");
	if (!Object.hasOwn(manifest.builds, host)) {
		throw new Error(`Unreviewed font-readiness build host: ${host}`);
	}
	assertSameIdentity(current?.source?.canonicalWasm, manifest.builds[host].wasm,
		`font-readiness WASM for ${host}`);
	return { ...current, source: { ...current.source, canonicalWasm: pinned.source.canonicalWasm } };
}
