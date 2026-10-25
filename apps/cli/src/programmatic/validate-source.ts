import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as wasm from "opencut-wasm";
import { isProgrammaticSource } from "@opencut/editor-contracts";

export interface ProgrammaticSourceReceipt {
	producerFingerprint: string;
	requiredCapabilities: string[];
	resourceIds: string[];
	fontResourceIds: string[];
}
const digest = (value: Uint8Array | string) =>
	createHash("sha256").update(value).digest("hex");

function nativeFingerprint(): string {
	const entry = fileURLToPath(import.meta.url);
	const binary =
		basename(entry) === "rocut.mjs"
			? join(dirname(entry), "opencut_wasm_bg.wasm")
			: fileURLToPath(import.meta.resolve("opencut-wasm/opencut_wasm_bg.wasm"));
	const stat = statSync(binary);
	if (!stat.isFile() || stat.size <= 0 || stat.size > 64 * 1024 ** 2)
		throw new Error(
			"Programmatic validation requires matching Native WASM bytes",
		);
	return digest(
		JSON.stringify({
			protocol: "rocut-programmatic-source-validation/1",
			validator:
				"rust-editor-api/programmatic.rs:resolve_programmatic_frame_json",
			wasmSha256: digest(readFileSync(binary)),
		}),
	);
}

/** Runs Rust source/recipe/resource validation only. Never executes authored JavaScript,
 * renders a frame, loads attachments, starts a browser, or mutates the Native project. */
export function validateProgrammaticSource(
	value: unknown,
	native: {
		resolve(input: string): string;
		fingerprint(): string;
	} = {
		resolve: wasm.resolveProgrammaticFrameJson,
		fingerprint: nativeFingerprint,
	},
): ProgrammaticSourceReceipt {
	if (
		!isProgrammaticSource(value) ||
		value.runtime !== "canvas-worker" ||
		value.documentId !== undefined ||
		value.build !== undefined ||
		value.audio !== undefined ||
		(value.resources ?? []).some(
			(resource) => !["image", "analysis", "font"].includes(resource.kind),
		) ||
		Buffer.byteLength(JSON.stringify(value), "utf8") > 4 * 1024 ** 2
	)
		throw new Error("Programmatic validation requires a bounded Canvas source");
	if (typeof native.resolve !== "function")
		throw new Error("Native programmatic validator is unavailable");
	const frameTicks =
		(120000 * value.frameRate.denominator) / value.frameRate.numerator;
	const duration = frameTicks * value.durationFrames;
	if (!Number.isSafeInteger(duration) || duration <= 0)
		throw new Error(
			"Programmatic validation requires an integral bounded clock",
		);
	const result: unknown = JSON.parse(
		native.resolve(
			JSON.stringify({
				source: value,
				clipStart: 0,
				clipDuration: duration,
				trimStart: 0,
				timelineTime: 0,
				deferRecipe: true,
			}),
		),
	);
	if (!result || typeof result !== "object" || Array.isArray(result))
		throw new Error("Native programmatic validation response is invalid");
	const response = result as { error?: unknown; frame?: unknown };
	if (response.error !== undefined)
		throw new Error(`Native programmatic source: ${String(response.error)}`);
	if (!response.frame || typeof response.frame !== "object")
		throw new Error("Native programmatic validator did not accept the source");
	const fingerprint = native.fingerprint();
	if (!/^[a-f0-9]{64}$/.test(fingerprint))
		throw new Error("Native programmatic validator fingerprint is invalid");
	const resources = value.resources ?? [];
	return {
		producerFingerprint: fingerprint,
		requiredCapabilities: [
			value.recipe ? "programmatic:recipe" : "programmatic:canvas-worker",
		],
		resourceIds: resources.map((resource) => resource.id),
		fontResourceIds: resources
			.filter((resource) => resource.kind === "font")
			.map((resource) => resource.id),
	};
}
