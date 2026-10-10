import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createPrivateEffectInputs } from "./private-effect-inputs.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture(contents = "original") {
	const root = await mkdtemp("C:/tmps/private-effect-inputs-cpu-");
	const source = join(root, "live.txt");
	await writeFile(source, contents, { flag: "wx" });
	return { root, source, inputs: await createPrivateEffectInputs(root) };
}
test("snapshot pins exact returned buffer, deduplicates, and survives later live changes", async () => {
	const f = await fixture(),
		captured = await f.inputs.capture(f.source);
	assert.equal(sha(captured.bytes), captured.file.sha256);
	assert.equal(captured.file.originalPath, f.source);
	assert.equal(
		(await f.inputs.capture(f.source)).file.path,
		captured.file.path,
	);
	await f.inputs.verify([captured.file]);
	await writeFile(f.source, "post-build change");
	assert.equal((await readFile(captured.file.path)).toString(), "original");
});
test("repeated live source drift and during-build final drift fail closed", async () => {
	const f = await fixture(),
		captured = await f.inputs.capture(f.source);
	await writeFile(f.source, "drift");
	await assert.rejects(
		f.inputs.capture(f.source),
		/Repeated loader read changed/,
	);
	await assert.rejects(f.inputs.verify([captured.file]), (error) =>
		error.receipt.issues.some(
			(i) => i.path === f.source && i.actual === sha("drift"),
		),
	);
});
test("immutable snapshot drift fails both reuse and validation", async () => {
	const f = await fixture(),
		captured = await f.inputs.capture(f.source);
	await writeFile(captured.file.path, "tampered");
	await assert.rejects(
		f.inputs.capture(f.source),
		/Immutable snapshot changed/,
	);
	await assert.rejects(f.inputs.verify([captured.file]), (error) =>
		error.receipt.issues.some((i) => i.path === captured.file.path),
	);
});
test("wx never overwrites hidden preexisting files", async () => {
	const f = await fixture();
	const path = join(f.inputs.root, sha("original"), basename(f.source));
	await mkdir(join(path, ".."), { recursive: true });
	await writeFile(path, "foreign", { flag: "wx" });
	await assert.rejects(
		f.inputs.capture(f.source),
		(error) => error.code === "EEXIST",
	);
	assert.equal((await readFile(path)).toString(), "foreign");
});
test("strict text, read errors and count/byte budgets fail closed", async () => {
	const f = await fixture(Buffer.from([255, 254]));
	await assert.rejects(
		f.inputs.capture(f.source),
		/encoded data was not valid/,
	);
	await assert.rejects(
		f.inputs.capture(join(f.root, "missing")),
		(error) => error.code === "ENOENT",
	);
	const limited = await createPrivateEffectInputs(f.root, {
		files: 1,
		bytes: 1,
	});
	await assert.rejects(limited.capture(f.source));
	await writeFile(f.source, "ab");
	await assert.rejects(limited.capture(f.source), /byte budget/);
	await writeFile(f.source, "a");
	await limited.capture(f.source);
	const other = join(f.root, "other.txt");
	await writeFile(other, "b");
	await assert.rejects(limited.capture(other), /file budget/);
});
test("private dynamic helper group resolves siblings, never later live helpers", async () => {
	const f = await fixture(),
		creator = join(f.root, "flame-wrap.mjs"),
		spatial = join(f.root, "spatial.mjs");
	await writeFile(creator, "export { value } from './spatial.mjs';");
	await writeFile(spatial, "export const value = 41;");
	const group = await f.inputs.captureGroup([creator, spatial]);
	await f.inputs.verify(group.map((item) => item.file));
	await writeFile(spatial, "throw new Error('live helper must not run');");
	assert.equal(
		(await import(pathToFileURL(group[0].file.path).href)).value,
		41,
	);
});
