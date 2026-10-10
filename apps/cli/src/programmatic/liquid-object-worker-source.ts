import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	particleSamplerSha256,
	type ParticleSamplerFileIdentity,
	type ParticleSamplerIdentityBase,
} from "./particle-sampler-identity";

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const DATA_PREFIX = "data:text/javascript;base64,";
const WASM_READ =
	/readFileSync\(\s*new URL\(\s*["']\.\/opencut_wasm_bg\.wasm["']\s*,\s*import\.meta\.url\s*\)\s*\)/g;
const FS_IMPORT = /import\s*\{\s*readFileSync\s*\}\s*from\s*["']node:fs["'];?/g;
const GLUE_IMPORT =
	/import\s*\*\s*as\s*glue\s*from\s*["']\.\/opencut_wasm_bg\.js["'];?/g;
const GLUE_EXPORT =
	/export\s*\{[^}]*\}\s*from\s*["']\.\/opencut_wasm_bg\.js["'];?/g;

function exactlyOne({
	source,
	pattern,
}: {
	source: string;
	pattern: RegExp;
}): void {
	if ([...source.matchAll(pattern)].length !== 1)
		throw Error("Unknown Liquid Object worker generated module layout");
}
function noDependencies(source: string): void {
	// This recognizes our trusted generated package layouts, not arbitrary JS.
	// A changed generator with more imports/resources needs an explicit update.
	const code = source
		.replace(/^\s*\/\/.*$/gm, "")
		.replace(/\/\*[\s\S]*?\*\//g, "");
	if (
		/\bimport\s*(?:["'{*(]|[\w$]+\s+from)|\bexport\s*(?:\*|\{[^}]*\})\s*from|\brequire\s*\(|\bfetch\s*\(|\bnew\s+URL\s*\(|\bimport\s*\.\s*meta|\breadFile(?:Sync)?\s*\(/.test(
			code,
		)
	)
		throw Error("Unknown Liquid Object worker dependency closure");
}
function moduleData(source: string): string {
	return DATA_PREFIX + Buffer.from(source, "utf8").toString("base64");
}

/** Internal host seam. Production supplies only fixed package/sibling paths.
 * All executable bytes are read once, then passed in memory to the child. Disk
 * mutation after this snapshot cannot change the bytes behind its identity. */
export function captureLiquidObjectWorkerSource(options: {
	moduleUrl: string;
	workerEntryUrl: string;
	layout: ParticleSamplerIdentityBase["layout"];
}) {
	const modulePath = fileURLToPath(options.moduleUrl);
	const expectedName =
		options.layout === "source-sync"
			? "opencut_wasm_sync.js"
			: "liquid-object-wasm.mjs";
	if (
		basename(modulePath) !== expectedName ||
		basename(fileURLToPath(options.workerEntryUrl)) !==
			"liquid-object-worker-entry.mjs"
	)
		throw Error("Invalid fixed Liquid Object worker layout");
	const files: ParticleSamplerFileIdentity[] = [];
	function read({
		path,
		role,
	}: {
		path: string;
		role: ParticleSamplerFileIdentity["role"];
	}) {
		const stat = statSync(path);
		if (!stat.isFile() || stat.size < 1 || stat.size > MAX_FILE_BYTES)
			throw Error("Invalid Liquid Object worker closure file size");
		const bytes = readFileSync(path);
		if (bytes.byteLength < 1 || bytes.byteLength > MAX_FILE_BYTES)
			throw Error("Invalid Liquid Object worker closure bytes");
		files.push(
			Object.freeze({
				role,
				sha256: particleSamplerSha256(bytes),
				bytes: bytes.byteLength,
			}),
		);
		return bytes;
	}
	const decoder = new TextDecoder("utf-8", { fatal: true });
	const original = decoder.decode(read({ path: modulePath, role: "module" }));
	let generated = original;
	exactlyOne({ source: generated, pattern: FS_IMPORT });
	exactlyOne({ source: generated, pattern: WASM_READ });
	let recognized = generated.replace(FS_IMPORT, "").replace(WASM_READ, "0");
	if (options.layout === "source-sync") {
		exactlyOne({ source: generated, pattern: GLUE_IMPORT });
		exactlyOne({ source: generated, pattern: GLUE_EXPORT });
		recognized = recognized.replace(GLUE_IMPORT, "").replace(GLUE_EXPORT, "");
		const glue = decoder.decode(
			read({
				path: join(dirname(modulePath), "opencut_wasm_bg.js"),
				role: "glue",
			}),
		);
		noDependencies(glue);
		if (process.versions.bun) {
			// Bun 1.2 resolves large data URLs as package names. Blob modules keep
			// the same captured bytes in memory without that filesystem resolver.
			const exported = generated.match(GLUE_EXPORT)![0];
			const names = exported.slice(
				exported.indexOf("{") + 1,
				exported.indexOf("}"),
			);
			if (!/^\s*[\w$]+(?:\s*,\s*[\w$]+)*\s*,?\s*$/.test(names))
				throw Error("Unknown Liquid Object worker glue export layout");
			generated = generated
				.replace(
					GLUE_IMPORT,
					`const __rocutGlueUrl = URL.createObjectURL(new Blob([Buffer.from("${Buffer.from(glue).toString("base64")}", "base64")], {type:"text/javascript"}));
let glue;
try { glue = await import(__rocutGlueUrl); } finally { URL.revokeObjectURL(__rocutGlueUrl); }`,
				)
				.replace(GLUE_EXPORT, `const {${names}} = glue; export {${names}};`);
		} else {
			generated = generated.replace(
				/(["'])\.\/opencut_wasm_bg\.js\1/g,
				JSON.stringify(moduleData(glue)),
			);
		}
	}
	noDependencies(recognized);
	const binary = read({
		path: join(dirname(modulePath), "opencut_wasm_bg.wasm"),
		role: "wasm",
	});
	const workerEntrySource = decoder.decode(
		read({ path: fileURLToPath(options.workerEntryUrl), role: "worker-entry" }),
	);
	// The small fixed IPC entry goes through argv; the large module goes via IPC.
	if (Buffer.byteLength(workerEntrySource, "utf8") > 8_192)
		throw Error("Particle sampler process entry exceeds the inline argv bound");
	generated = generated
		.replace(FS_IMPORT, "")
		.replace(
			WASM_READ,
			`Buffer.from("${binary.toString("base64")}", "base64")`,
		);
	const runtime: ParticleSamplerIdentityBase["runtime"] = Object.freeze(
		process.versions.bun
			? { name: "bun", version: process.versions.bun }
			: { name: "node", version: process.version },
	);
	const identityBase: ParticleSamplerIdentityBase = Object.freeze({
		version: 1,
		bindingVersion: "inline-wasm-v1",
		layout: options.layout,
		runtime,
		files: Object.freeze(files),
		executionHash: particleSamplerSha256(generated),
		closureHash: particleSamplerSha256(JSON.stringify(files)),
	});
	return Object.freeze({
		identityBase,
		moduleUrl: moduleData(generated),
		workerEntrySource,
		// Bootstrap bytes are separate from per-frame logical payload retention.
		bootstrapSourceBytes: files.reduce((total, file) => total + file.bytes, 0),
		bootstrapModuleBytes: Buffer.byteLength(generated, "utf8"),
	});
}
