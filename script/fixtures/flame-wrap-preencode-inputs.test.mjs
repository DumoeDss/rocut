import assert from "node:assert/strict";
import test from "node:test";
import { derivePreencodeHostModule } from "./flame-wrap-preencode-inputs.mjs";

const prefix =
	"// preserved fixture bytes 中文\nasync function startHost(args) {}\nclass TargetRegistry {}\n";
const marker =
	"// ../../../../../../../../C:/tmps/flame-wrap-editor-nl0MSk/editor-entry.ts\n";
const entry =
	'await run({ startHost, TargetRegistry, root: "C:/tmps/flame-wrap-editor-nl0MSk", creator: "frozen-source", configPath: "frozen-config" });\n';
test("Host derivation preserves original prefix and removes only the fixed mutating entry", () => {
	const derived = derivePreencodeHostModule(prefix + marker + entry);
	assert.equal(
		derived.module,
		prefix + "export { startHost, TargetRegistry };\n",
	);
	assert.equal(derived.retainedPrefixBytes, Buffer.byteLength(prefix));
	assert.equal(derived.removedEntry, entry);
});
test("Host derivation fails closed for ambiguous marker, altered entry, or added execution", () => {
	for (const input of [
		prefix + marker + entry + marker + entry,
		prefix +
			marker +
			entry.replace("flame-wrap-editor-nl0MSk", "another-project"),
		prefix + marker + entry + "await mutate();\n",
		prefix + entry,
	])
		assert.throws(() => derivePreencodeHostModule(input));
});
