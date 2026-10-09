import { createHash } from "node:crypto";

export type ParticleSamplerFileIdentity = Readonly<{
	role: "module" | "glue" | "wasm" | "worker-entry";
	sha256: string;
	bytes: number;
}>;
export type ParticleSamplerIdentityBase = Readonly<{
	version: 1;
	bindingVersion: "inline-wasm-v1";
	layout: "source-sync" | "packed-sidecar";
	runtime: Readonly<{ name: "node" | "bun"; version: string }>;
	files: readonly ParticleSamplerFileIdentity[];
	executionHash: string;
	closureHash: string;
}>;
export type ParticleSamplerIdentity = ParticleSamplerIdentityBase &
	Readonly<{
		publishedPolicyHash: string;
		policyHash: string;
		identityHash: string;
	}>;

export function particleSamplerSha256(bytes: string | Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function record(
	value: unknown,
	keys: readonly string[],
): Record<string, unknown> {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.keys(value).length !== keys.length ||
		!keys.every((key) => Object.hasOwn(value, key))
	)
		throw Error("Invalid particle sampler identity shape");
	return value as Record<string, unknown>;
}
function digest(value: unknown): string {
	if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
		throw Error("Invalid particle sampler identity digest");
	return value;
}

/** Archive data is untrusted. Rebuild a canonical, deeply frozen value and
 * verify every aggregate digest before comparing it to the host's identity. */
export function snapshotParticleSamplerIdentity(
	value: unknown,
): ParticleSamplerIdentity {
	const input = record(value, [
		"version",
		"bindingVersion",
		"layout",
		"runtime",
		"files",
		"executionHash",
		"closureHash",
		"publishedPolicyHash",
		"policyHash",
		"identityHash",
	]);
	if (
		input.version !== 1 ||
		input.bindingVersion !== "inline-wasm-v1" ||
		(input.layout !== "source-sync" && input.layout !== "packed-sidecar")
	)
		throw Error("Unsupported particle sampler identity version or layout");
	const runtime = record(input.runtime, ["name", "version"]);
	if (
		(runtime.name !== "node" && runtime.name !== "bun") ||
		typeof runtime.version !== "string" ||
		!/^v?\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(runtime.version)
	)
		throw Error("Invalid particle sampler runtime identity");
	const roles =
		input.layout === "source-sync"
			? (["module", "glue", "wasm", "worker-entry"] as const)
			: (["module", "wasm", "worker-entry"] as const);
	if (!Array.isArray(input.files) || input.files.length !== roles.length)
		throw Error("Incomplete particle sampler closure identity");
	const files = Object.freeze(
		input.files.map((value, index): ParticleSamplerFileIdentity => {
			const file = record(value, ["role", "sha256", "bytes"]);
			if (
				file.role !== roles[index] ||
				typeof file.bytes !== "number" ||
				!Number.isSafeInteger(file.bytes) ||
				file.bytes < 1 ||
				file.bytes > 64 * 1024 * 1024
			)
				throw Error("Invalid particle sampler closure file identity");
			return Object.freeze({
				role: roles[index]!,
				sha256: digest(file.sha256),
				bytes: file.bytes,
			});
		}),
	);
	const unsigned: Omit<ParticleSamplerIdentity, "identityHash"> = {
		version: 1 as const,
		bindingVersion: "inline-wasm-v1" as const,
		layout: input.layout,
		runtime: Object.freeze({ name: runtime.name, version: runtime.version }),
		files,
		executionHash: digest(input.executionHash),
		closureHash: digest(input.closureHash),
		publishedPolicyHash: digest(input.publishedPolicyHash),
		policyHash: digest(input.policyHash),
	};
	if (particleSamplerSha256(JSON.stringify(files)) !== unsigned.closureHash)
		throw Error("Particle sampler closure identity digest mismatch");
	const identityHash = digest(input.identityHash);
	if (particleSamplerSha256(JSON.stringify(unsigned)) !== identityHash)
		throw Error("Particle sampler identity digest mismatch");
	return Object.freeze({ ...unsigned, identityHash });
}

export function completeParticleSamplerIdentity(
	base: ParticleSamplerIdentityBase,
	policy: Readonly<{ publishedPolicyHash: string; policyHash: string }>,
): ParticleSamplerIdentity {
	const unsigned = {
		...base,
		publishedPolicyHash: policy.publishedPolicyHash,
		policyHash: policy.policyHash,
	};
	return snapshotParticleSamplerIdentity({
		...unsigned,
		identityHash: particleSamplerSha256(JSON.stringify(unsigned)),
	});
}

export function assertParticleSamplerIdentity(
	expected: unknown,
	current: unknown,
): void {
	const previous = snapshotParticleSamplerIdentity(expected);
	const actual = snapshotParticleSamplerIdentity(current);
	if (previous.identityHash !== actual.identityHash)
		throw Error("Particle sampler identity changed; recompile the source");
}
