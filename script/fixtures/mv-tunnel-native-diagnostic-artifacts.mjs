import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tunnelFileIdentity } from "./mv-tunnel-native-identities.mjs";

export const TUNNEL_DIAGNOSTIC_BUFFERS = [
	"original",
	"production",
	"originalOmitted",
	"nativeOmitted",
].flatMap((owner) =>
	["scene", "post"].map((layer) => ({
		owner,
		layer,
		file: `${owner}-${layer}.rgba`,
	})),
);
export function encodeTunnelDiagnosticChunk({
	owner,
	layer,
	offset,
	count,
	length,
}) {
	const bytes = globalThis.__tunnelNativeDiagnostic?.[owner]?.rgba?.[layer];
	// Playwright may evaluate this helper in an isolated utility world whose
	// Uint8ClampedArray constructor differs from the page realm; a cross-realm
	// instanceof would reject the exact same retained buffer. Validate the
	// value structurally instead of by realm-specific identity.
	if (
		typeof bytes?.length !== "number" ||
		bytes.length !== length ||
		typeof bytes.subarray !== "function" ||
		!Number.isSafeInteger(offset) ||
		!Number.isSafeInteger(count) ||
		offset < 0 ||
		count < 1 ||
		count > 256 * 1024 ||
		offset + count > length
	)
		throw Error("Missing retained Tunnel diagnostic RGBA or invalid chunk");
	let binary = "";
	for (let i = offset; i < offset + count; i += 8192)
		binary += String.fromCharCode(
			...bytes.subarray(i, Math.min(i + 8192, offset + count)),
		);
	return btoa(binary);
}
/** Each browser roundtrip returns at most 256 KiB of bytes as base64, never a
 * multi-million-element JSON array. Only one full output buffer exists in Node. */
export async function saveTunnelDiagnosticArtifacts({
	page,
	artifact,
	result,
	originalMain,
}) {
	assert.equal(result.mode, "frame4-grain-diagnostic");
	assert.equal(result.diagnosticComplete, true);
	assert.equal(result.fullMatrixTested, false);
	assert.ok(
		result.metadata.originalApplied.grain > 0 &&
			result.metadata.nativeApplied.grain > 0,
	);
	const length = 1920 * 1080 * 4,
		chunkSize = 256 * 1024;
	const files = [];
	for (const { owner, layer, file } of TUNNEL_DIAGNOSTIC_BUFFERS) {
		const buffer = Buffer.alloc(length);
		for (let offset = 0; offset < length; offset += chunkSize) {
			const count = Math.min(chunkSize, length - offset);
			const encoded = await page.evaluate(encodeTunnelDiagnosticChunk, {
				owner,
				layer,
				offset,
				count,
				length,
			});
			const bytes = Buffer.from(encoded, "base64");
			assert.equal(bytes.length, count, "Truncated Tunnel diagnostic chunk");
			bytes.copy(buffer, offset);
		}
		const path = join(artifact, file);
		await writeFile(path, buffer, { flag: "wx" });
		files.push({ file, ...(await tunnelFileIdentity(path)) });
	}
	for (const [file, value] of [
		["frame4-diagnostic.json", { ...result, plans: undefined, files }],
		["native-production-root-plan.json", result.plans.production],
		["native-omitted-root-plan.json", result.plans.omitted],
		["original-main-reference.json", originalMain],
	])
		await writeFile(join(artifact, file), JSON.stringify(value, null, 2), {
			flag: "wx",
		});
	return files;
}
