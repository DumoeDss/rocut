import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath, readdir, lstat, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { apiNames } from "./animation-scalar-reference.mjs";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export function within(root, path) {
	const suffix = relative(resolve(root), resolve(path));
	return suffix !== ".." && !suffix.startsWith(".." + sep) && !isAbsolute(suffix);
}

export function parseArguments(args) {
	const result = {};
	const allowed = new Set(["--pkg", "--wasm-js", "--wasm", "--out", "--source-root", "--build-evidence"]);
	for (let index = 0; index < args.length; index += 2) {
		const key = args[index];
		assert(allowed.has(key), "Unknown argument: " + key);
		assert(!(key in result) && args[index + 1] && !args[index + 1].startsWith("--"), "Argument requires one value: " + key);
		assert(isAbsolute(args[index + 1]), "Use absolute paths");
		result[key] = resolve(args[index + 1]);
	}
	assert(Boolean(result["--pkg"]) !== Boolean(result["--wasm-js"]), "Provide exactly one of --pkg or --wasm-js");
	assert(result["--out"] && result["--source-root"], "Required: --out C:/tmps/... --source-root <frozen source>");
	const jsPath = result["--wasm-js"] ?? join(result["--pkg"], "opencut_wasm_bg.js");
	return { jsPath, wasmPath: result["--wasm"] ?? join(dirname(jsPath), "opencut_wasm_bg.wasm"),
		outParent: result["--out"], sourceRoot: result["--source-root"], buildEvidence: result["--build-evidence"] };
}

export async function createIO(options) {
	const temporary = await realpath("C:/tmps");
	for (const path of [options.jsPath, options.wasmPath, options.outParent]) {
		assert(within(temporary, path) && within(temporary, await realpath(path)), "WASM inputs/output must resolve inside C:/tmps");
	}
	assert((await lstat(options.outParent)).isDirectory());
	const output = await mkdtemp(join(options.outParent, "animation-scalar-roundtrip-"));
	const inputs = new Map(), outputs = [];
	async function read(path) {
		const resolved = resolve(path), canonical = await realpath(resolved);
		assert((await lstat(canonical)).isFile());
		const bytes = await readFile(canonical), hash = sha256(bytes);
		if (inputs.has(resolved)) assert.equal(hash, inputs.get(resolved).sha256, "Input changed: " + resolved);
		inputs.set(resolved, { path: resolved, canonical, bytes: bytes.length, sha256: hash });
		return bytes;
	}
	async function tree(path) {
		for (const entry of await readdir(path, { withFileTypes: true })) {
			assert(!entry.isSymbolicLink(), "Generated package/source subtree must not redirect: " + entry.name);
			if (entry.isDirectory()) await tree(join(path, entry.name));
			else await read(join(path, entry.name));
		}
	}
	async function write(name, content) {
		assert(/^[a-zA-Z0-9._-]+$/.test(name));
		const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
		const path = join(output, name);
		await writeFile(path, bytes, { flag: "wx" });
		const artifact = { path, bytes: bytes.length, sha256: sha256(bytes) }; outputs.push(artifact); return artifact;
	}
	async function unchanged() {
		const changed = [];
		for (const entry of inputs.values()) {
			try {
				const canonical = await realpath(entry.path), bytes = await readFile(canonical);
				if (canonical !== entry.canonical || sha256(bytes) !== entry.sha256) changed.push(entry.path);
			} catch { changed.push(entry.path); }
		}
		return { checkedFiles: inputs.size, changed, ok: changed.length === 0 };
	}
	return { output, inputs, outputs, read, tree, write, unchanged };
}

/** Initialize actual wasm-bindgen glue; there is no substitute implementation. */
export async function loadGeneratedWasm(options, io) {
	const source = new TextDecoder("utf-8", { fatal: true }).decode(await io.read(options.jsPath));
	let gluePath = options.jsPath;
	if (/import \* as wasm from ["']\.\/opencut_wasm_bg\.wasm["']/.test(source)) {
		assert(/from ["']\.\/opencut_wasm_bg\.js["']/.test(source));
		gluePath = join(dirname(options.jsPath), "opencut_wasm_bg.js");
		await io.read(gluePath);
	}
	const bindings = await import(pathToFileURL(gluePath).href);
	const bytes = await io.read(options.wasmPath);
	let mode;
	if (typeof bindings.__wbg_set_wasm === "function") {
		const module = new WebAssembly.Module(bytes);
		const imports = [...new Set(WebAssembly.Module.imports(module).map(entry => entry.module))];
		assert.deepEqual(imports, ["./opencut_wasm_bg.js"], "Unexpected bundler WASM import namespace");
		const instance = new WebAssembly.Instance(module, { "./opencut_wasm_bg.js": bindings });
		bindings.__wbg_set_wasm(instance.exports);
		assert.equal(typeof instance.exports.__wbindgen_start, "function");
		instance.exports.__wbindgen_start();
		mode = "real generated bundler glue + WebAssembly.Instance";
	} else {
		assert.equal(typeof bindings.initSync, "function", "Expected generated bundler glue or web-target initSync");
		bindings.initSync({ module: bytes });
		mode = "real generated web-target initSync";
	}
	for (const name of Object.values(apiNames)) assert.equal(typeof bindings[name], "function", "Missing public generated export: " + name);
	return { bindings, provenance: { mode, entryPath: options.jsPath, gluePath, wasmPath: options.wasmPath, exports: apiNames } };
}
