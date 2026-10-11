import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const FILES = Object.freeze([
	"opencut_wasm_sync.js",
	"opencut_wasm_bg.js",
	"opencut_wasm_bg.wasm",
]);

/** One canonical producer supplies both generated JS and its WASM sibling.
 * Validate the declared sync entry and ABI before touching any pack output.
 */
export function resolveRuntimeWasmPackage({ repoRoot }) {
	if (typeof repoRoot !== "string" || !isAbsolute(repoRoot))
		throw Error("Runtime WASM closure requires an explicit absolute repository path");
	const canonical = join(repoRoot, "rust/wasm/pkg");
	const decoder = new TextDecoder("utf-8", { fatal: true });
	const manifest = JSON.parse(decoder.decode(readFileSync(join(canonical, "package.json"))));
	if (manifest.name !== "opencut-wasm" || manifest.type !== "module" ||
		manifest.exports?.["./sync"]?.default !== "./opencut_wasm_sync.js")
		throw Error("Canonical opencut-wasm must declare its fixed ./sync entry");
	const bytes = FILES.map(name => readFileSync(join(canonical, name)));
	const sync = decoder.decode(bytes[0]);
	const glue = decoder.decode(bytes[1]);
	if (!/readFileSync\(\s*new URL\(\s*["']\.\/opencut_wasm_bg\.wasm["']\s*,\s*import\.meta\.url/.test(sync))
		throw Error("Canonical opencut-wasm sync entry must load its fixed WASM sibling");
	const binary = new WebAssembly.Module(bytes[2]);
	const exported = new Set(WebAssembly.Module.exports(binary).map(item => item.name));
	const required = ["resolveGlassObjectParamsJson", "resolveInkObjectParamsJson",
		"resolveLiquidObjectParamsJson", "evaluateLiquidObjectFrameJson", "liquidObjectTransportPolicyJson",
		"liquidobjecttransportowner_new", "liquidobjecttransportowner_command", "__wbg_liquidobjecttransportowner_free"];
	const referenced = [...glue.matchAll(/\bwasm\.(\w+)/g)].map(match => match[1]);
	for (const name of new Set([...required, ...referenced]))
		if (!exported.has(name)) throw Error(`Canonical opencut-wasm ABI missing binary export: ${name}`);
	const glueExports = new Set([...glue.matchAll(/export\s+(?:function|const|let|var|class)\s+(\w+)/g)].map(match => match[1]));
	const syncExport = sync.match(/export\s*\{([^}]+)\}\s*from\s*["']\.\/opencut_wasm_bg\.js["']/);
	const syncExports = new Set(syncExport?.[1].split(",").map(name => name.trim()) ?? []);
	for (const name of ["LiquidObjectTransportOwner", ...required.slice(0, 5)])
		if (!glueExports.has(name) || !syncExports.has(name))
			throw Error(`Canonical opencut-wasm ABI missing public sync export: ${name}`);
	for (const imported of WebAssembly.Module.imports(binary))
		if (imported.module !== "./opencut_wasm_bg.js" || !glueExports.has(imported.name))
			throw Error(`Canonical opencut-wasm ABI missing glue import: ${imported.name}`);
	const files = FILES.map((name, index) => {
		const source = bytes[index];
		return {
			name,
			bytes: source.byteLength,
			sha256: createHash("sha256").update(source).digest("hex"),
		};
	});
	return { wasmSyncEntry: join(canonical, FILES[0]), files };
}
