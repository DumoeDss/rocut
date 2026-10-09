import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

/** Reviewed npm core 0.8.139 bytes, not a project-provided digest. The module
 * contains only the generated IIFE and getAudioFxRuntimeScript(). Updating
 * either allowlisted digest requires reviewing the native implementation. */
export const HYPERFRAMES_FX_NATIVE = Object.freeze({
	nativeVersion: "0.8.139" as const,
	moduleBytes: 39536,
	moduleSha256:
		"cebd5b7d493763013ed2df44ec927fd7c7b85ea72c088604bfa8a305bd0accd2",
	codeSha256:
		"eec4e4349b87ee1542b88a32a4a5dd1428a2bc50fda7ad124c27083d126eb426",
});

export interface HyperframesFxRuntime {
	readonly nativeVersion: "0.8.139";
	readonly sha256: string;
	readonly moduleSha256: string;
	readonly packageIntegrity: string;
	readonly packageLockSha256: string;
	readonly code: string;
}

// Provenance must come from this loader, not a project-deserialized object
// carrying matching code plus invented package/lock metadata.
const admittedRuntimes = new WeakSet<HyperframesFxRuntime>();

export const hyperframesFxDigest = (bytes: string | Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");

/** Bounds here protect trusted toolchain-file IO, not project/DSP admission. */
async function readBounded(
	filePath: string,
	maxBytes: number,
	signal: AbortSignal,
) {
	signal.throwIfAborted();
	const file = await open(filePath, "r");
	try {
		const before = await file.stat();
		if (!before.isFile() || before.size > maxBytes)
			throw Error("Invalid HyperFrames FX toolchain file size");
		const bytes = Buffer.alloc(before.size);
		let offset = 0;
		while (offset < bytes.length) {
			signal.throwIfAborted();
			const { bytesRead } = await file.read(
				bytes,
				offset,
				bytes.length - offset,
				offset,
			);
			if (!bytesRead)
				throw Error("HyperFrames FX toolchain file changed while reading");
			offset += bytesRead;
		}
		const after = await file.stat();
		if (
			before.size !== after.size ||
			before.mtimeMs !== after.mtimeMs ||
			before.ctimeMs !== after.ctimeMs
		)
			throw Error("HyperFrames FX toolchain file changed while reading");
		signal.throwIfAborted();
		return bytes;
	} finally {
		await file.close();
	}
}

const utf8 = (bytes: Uint8Array) =>
	new TextDecoder("utf-8", { fatal: true }).decode(bytes);

/** Only configured, locally installed native code is admitted. Never execute a
 * module from project attachments, even if an attachment supplies its own hash.
 * Import the exact checked bytes, not a pathname that can change after hashing. */
export async function loadHyperframesFxRuntime({
	toolchainDirectory,
	signal,
}: {
	toolchainDirectory: string;
	signal: AbortSignal;
}): Promise<HyperframesFxRuntime> {
	signal.throwIfAborted();
	if (!isAbsolute(toolchainDirectory))
		throw Error("HyperFrames FX toolchain path must be absolute");
	const root = await realpath(toolchainDirectory);
	const core = join(root, "node_modules/@hyperframes/core");
	const [manifestBytes, lockBytes] = await Promise.all([
		readBounded(join(core, "package.json"), 1024 * 1024, signal),
		readBounded(join(root, "package-lock.json"), 4 * 1024 * 1024, signal),
	]);
	const manifest = JSON.parse(utf8(manifestBytes));
	const locked = JSON.parse(utf8(lockBytes)).packages?.[
		"node_modules/@hyperframes/core"
	];
	if (
		manifest.name !== "@hyperframes/core" ||
		manifest.version !== HYPERFRAMES_FX_NATIVE.nativeVersion ||
		locked?.version !== HYPERFRAMES_FX_NATIVE.nativeVersion ||
		typeof locked.integrity !== "string" ||
		!/^sha512-[A-Za-z0-9+/]+=*$/.test(locked.integrity)
	)
		throw Error(
			"HyperFrames FX requires the fixed core 0.8.139 package and registry lock",
		);
	const moduleBytes = await readBounded(
		join(core, "dist/generated/audio-fx-runtime-inline.js"),
		HYPERFRAMES_FX_NATIVE.moduleBytes,
		signal,
	);
	if (
		moduleBytes.length !== HYPERFRAMES_FX_NATIVE.moduleBytes ||
		hyperframesFxDigest(moduleBytes) !== HYPERFRAMES_FX_NATIVE.moduleSha256
	)
		throw Error(
			"HyperFrames FX native runtime module differs from reviewed bytes",
		);
	const module = await import(
		`data:text/javascript;base64,${moduleBytes.toString("base64")}`
	);
	const code: unknown = module.getAudioFxRuntimeScript();
	signal.throwIfAborted();
	if (
		typeof code !== "string" ||
		hyperframesFxDigest(code) !== HYPERFRAMES_FX_NATIVE.codeSha256
	)
		throw Error(
			"HyperFrames FX native runtime code differs from reviewed bytes",
		);
	const runtime: HyperframesFxRuntime = Object.freeze({
		nativeVersion: HYPERFRAMES_FX_NATIVE.nativeVersion,
		sha256: HYPERFRAMES_FX_NATIVE.codeSha256,
		moduleSha256: HYPERFRAMES_FX_NATIVE.moduleSha256,
		packageIntegrity: locked.integrity,
		packageLockSha256: hyperframesFxDigest(lockBytes),
		code,
	});
	admittedRuntimes.add(runtime);
	return runtime;
}

export function assertHyperframesFxRuntime(runtime: HyperframesFxRuntime) {
	if (
		!admittedRuntimes.has(runtime) ||
		runtime.nativeVersion !== HYPERFRAMES_FX_NATIVE.nativeVersion ||
		runtime.sha256 !== HYPERFRAMES_FX_NATIVE.codeSha256 ||
		runtime.moduleSha256 !== HYPERFRAMES_FX_NATIVE.moduleSha256 ||
		hyperframesFxDigest(runtime.code) !== HYPERFRAMES_FX_NATIVE.codeSha256
	)
		throw Error(
			"HyperFrames FX executor requires reviewed native runtime bytes",
		);
}
