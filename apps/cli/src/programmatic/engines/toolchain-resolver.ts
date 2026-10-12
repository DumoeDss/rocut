import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	ENGINE_VERSIONS,
	HYPERFRAMES_TOOLCHAIN,
	REMOTION_TOOLCHAIN,
	THREE_TOOLCHAIN,
} from "./engine-versions";

type Engine = keyof typeof ENGINE_VERSIONS;
export interface ToolchainDiagnostic {
	readonly code: string;
	readonly package?: string;
	readonly expectedVersion?: string;
	readonly file?: string;
}
const engines = Object.keys(ENGINE_VERSIONS) as Engine[];
const packages = { hyperframes: HYPERFRAMES_TOOLCHAIN, remotion: REMOTION_TOOLCHAIN, three: THREE_TOOLCHAIN };
const entries: Record<Engine, readonly string[]> = {
	hyperframes: ["node_modules/@hyperframes/core/dist/compiler/index.js", "node_modules/@hyperframes/core/dist/compiler/htmlDocument.js", "node_modules/acorn/dist/acorn.mjs"],
	remotion: ["node_modules/esbuild/lib/main.js"],
	three: ["node_modules/esbuild/lib/main.js"],
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function json(file: string): unknown {
	const size = statSync(file).size;
	if (size > 8_000_000) throw Error("Toolchain metadata exceeds limit");
	return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(file)));
}
const existsFile = (file: string) => { try { return statSync(file).isFile(); } catch { return false; } };

/** Fixed package-relative discovery only. Never search cwd, project, ancestors,
 * global modules or developer paths. This probes dependency metadata/files;
 * compile admission still revalidates pins/provenance and runtime health. */
export function resolveEngineToolchain({
	explicit,
	entryUrl = import.meta.url,
	platform = process.platform,
	arch = process.arch,
}: { explicit?: string; entryUrl?: string; platform?: string; arch?: string } = {}) {
	const source = explicit === undefined ? "bundled" : "explicit";
	let directory: string | undefined;
	const diagnostics: ToolchainDiagnostic[] = [];
	let declared = engines;
	if (explicit !== undefined) {
		if (!explicit) diagnostics.push({ code: "toolchain-disabled" });
		else if (!isAbsolute(explicit)) diagnostics.push({ code: "toolchain-path-not-absolute" });
		else directory = explicit;
	} else {
		// Validate Node target identifiers before constructing a fixed package path.
		// Other valid targets never borrow the Windows dependency closure.
		if (!["aix", "android", "darwin", "freebsd", "haiku", "linux", "openbsd", "sunos", "win32"].includes(platform) ||
			!["arm", "arm64", "ia32", "loong64", "mips", "mipsel", "ppc", "ppc64", "riscv64", "s390", "s390x", "x64"].includes(arch))
			diagnostics.push({ code: "bundled-toolchain-platform-unsupported" });
		else try { directory = join(dirname(fileURLToPath(entryUrl)), "..", "..", "prebuilds", `${platform}-${arch}`, "toolchain"); }
		catch { diagnostics.push({ code: "toolchain-entry-not-file-url" }); }
	}
	if (directory && !diagnostics.length) {
		const marker = join(directory, "rocut-engine-toolchain.json");
		if (!existsFile(marker)) {
			if (source === "bundled") diagnostics.push({ code: "bundled-toolchain-marker-missing" });
		} else try {
			const value = json(marker);
			if (!record(value) || Object.keys(value).sort().join(",") !== "engines,kind,version" || value.version !== 1 || value.kind !== "rocut-engine-toolchain" || !Array.isArray(value.engines) || !value.engines.every(e => engines.includes(e)) || new Set(value.engines).size !== value.engines.length)
				throw Error("Invalid marker");
			declared = value.engines as Engine[];
		} catch { diagnostics.push({ code: "bundled-toolchain-marker-invalid" }); }
	}
	let lock: Record<string, unknown> | undefined;
	if (directory && !diagnostics.length) {
		try {
			const value = json(join(directory, "package-lock.json"));
			if (!record(value) || !record(value.packages)) throw Error("Invalid lock");
			lock = value.packages;
		} catch { diagnostics.push({ code: "toolchain-lock-missing-or-invalid" }); }
	}
	const probes = engines.map(engine => {
		const issues: ToolchainDiagnostic[] = [...diagnostics];
		if (!issues.length && !declared.includes(engine)) issues.push({ code: "engine-not-packaged" });
		if (!issues.length && directory && lock) {
			for (const [name, version] of Object.entries(packages[engine])) {
				try {
					const value = json(join(directory, "node_modules", name, "package.json"));
					if (!record(value) || value.name !== name || value.version !== version)
						issues.push({ code: "package-pin-mismatch", package: name, expectedVersion: version });
				} catch { issues.push({ code: "package-missing-or-invalid", package: name, expectedVersion: version }); }
				const locked = lock[`node_modules/${name}`];
				if (!record(locked) || locked.version !== version || typeof locked.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]+=*$/.test(locked.integrity))
					issues.push({ code: "lock-package-pin-or-integrity-mismatch", package: name, expectedVersion: version });
			}
			for (const file of entries[engine]) if (!existsFile(join(directory, file))) issues.push({ code: "compiler-entry-missing", file });
		}
		return { engine, version: ENGINE_VERSIONS[engine], ready: issues.length === 0, diagnostics: issues,
			requiredPackages: packages[engine] };
	});
	return { directory, source, configured: probes.some(p => p.ready), diagnostics, probes };
}
