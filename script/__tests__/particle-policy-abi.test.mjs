// Compare measured private artifacts. Never rewrite a canonical ABI contract
// from this smaller fixture's export set.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";

const current = process.env.ROCUT_PARTICLE_POLICY_WASM_MODULE;
const old = process.env.ROCUT_PARTICLE_POLICY_OLD_WASM_MODULE;
const sha = (text) => createHash("sha256").update(text).digest("hex");
const signature = (items) => sha([...items].sort().join("\n"));
const trampoline =
	/^wasm_bindgen__convert__closures_____invoke__h[0-9a-f]{16}$/;
const exported = (text) =>
	text
		.match(/export \{([\s\S]*?)\} from/)?.[1]
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean)
		.sort();
const normalizedDeclarations = (text) =>
	text
		.split(/\r?\n/)
		.map((line) =>
			line.replace(
				/(wasm_bindgen__convert__closures_____invoke__h)[0-9a-f]{16}/g,
				"$1<hash>",
			),
		)
		.filter((line) => line.trim().length)
		.sort();
function surface(entry) {
	const root = dirname(entry);
	const read = (name) => readFileSync(join(root, name), "utf8");
	const module = new WebAssembly.Module(
		readFileSync(join(root, "opencut_wasm_bg.wasm")),
	);
	const binary = WebAssembly.Module.exports(module);
	return {
		dts: read("opencut_wasm.d.ts"),
		wrapper: read("opencut_wasm.js"),
		sync: read("opencut_wasm_sync.js"),
		glue: [...read("opencut_wasm_bg.js").matchAll(/^export function (\S+)\(/gm)]
			.map((match) => match[1])
			.sort(),
		declarations: normalizedDeclarations(read("opencut_wasm_bg.wasm.d.ts")),
		stable: binary
			.filter(({ name }) => !trampoline.test(name))
			.map(({ name, kind }) => `${name}|${kind}`)
			.sort(),
		trampolines: binary.filter(({ name }) => trampoline.test(name)),
		imports: WebAssembly.Module.imports(module)
			.map(({ module, name, kind }) => `${module}|${name}|${kind}`)
			.sort(),
	};
}

test(
	"private policy ABI adds only the measured getter and preserves existing signatures",
	{
		skip:
			!current || !old
				? "Explicit current and old private WASM modules required"
				: false,
	},
	(t) => {
		const previous = surface(old),
			next = surface(current);
		const getter = "particleTransportPolicyJson";
		assert.ok(!exported(previous.wrapper).includes(getter));
		assert.deepEqual(
			exported(next.wrapper),
			[...exported(previous.wrapper), getter].sort(),
		);
		assert.deepEqual(exported(next.sync), exported(next.wrapper));
		assert.deepEqual(next.glue, [...previous.glue, getter].sort());
		assert.deepEqual(
			next.stable,
			[...previous.stable, `${getter}|function`].sort(),
		);
		assert.equal(next.trampolines.length, previous.trampolines.length);
		assert.ok(next.trampolines.every(({ kind }) => kind === "function"));
		assert.deepEqual(next.imports, previous.imports);
		assert.deepEqual(
			next.declarations,
			[
				...previous.declarations,
				"export const particleTransportPolicyJson: () => [number, number];",
			].sort(),
		);
		const addedDeclaration =
			/\/\*\*\r?\n \* Return a deterministic policy snapshot for native and WASM consumers\.[\s\S]*?\*\/\r?\nexport function particleTransportPolicyJson\(\): string;\r?\n\r?\n/;
		assert.match(next.dts, addedDeclaration);
		assert.equal(next.dts.replace(addedDeclaration, ""), previous.dts);
		assert.ok(!exported(next.wrapper).includes("applyEffectPassesReadback"));
		t.diagnostic(
			JSON.stringify({
				oldPublicExports: exported(previous.wrapper).length,
				newPublicExports: exported(next.wrapper).length,
				oldStableWasmExports: previous.stable.length,
				newStableWasmExports: next.stable.length,
				trampolines: next.trampolines.length,
				imports: next.imports.length,
				added: getter,
				dtsSha256: sha(next.dts),
				wrapperSha256: sha(next.wrapper),
				wrapperExportSignature: signature(exported(next.wrapper)),
				glueExportSignature: signature(next.glue),
				stableWasmSignature: signature(next.stable),
				normalizedDeclarationSignature: signature(next.declarations),
				canonicalContractModified: false,
			}),
		);
	},
);
