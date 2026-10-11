import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile, unlink, symlink } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveHostStaticDirectory } from "../host-static-directory";

async function fixture() {
	const root = await mkdtemp("C:/tmps/rocut-host-static-test-");
	const runtime = join(root, "runtime"),
		surface = join(runtime, "surface"),
		entry = join(runtime, "rocut.mjs");
	await mkdir(join(surface, "assets"), { recursive: true });
	await writeFile(entry, "// packed entry\n");
	const wasm = Buffer.from("fixture-wasm"),
		sha256 = createHash("sha256").update(wasm).digest("hex");
	await writeFile(join(runtime, "opencut_wasm_bg.wasm"), wasm);
	await writeFile(join(surface, "assets/core.wasm"), wasm);
	await writeFile(
		join(surface, "index.html"),
		"<html>controlled Surface</html>",
	);
	const receipt = { coreWasm: { path: "assets/core.wasm", sha256 } };
	await writeFile(
		join(surface, "surface-wasm-package.json"),
		JSON.stringify(receipt),
	);
	return {
		root,
		runtime,
		surface,
		entryUrl: pathToFileURL(entry).href,
		receipt,
	};
}

test("packed Surface resolves relative to entry, not current working directory; explicit override wins", async () => {
	const f = await fixture();
	expect(await resolveHostStaticDirectory({ entryUrl: f.entryUrl })).toBe(
		f.surface,
	);
	expect(f.runtime).not.toBe(process.cwd());
	expect(
		await resolveHostStaticDirectory({
			entryUrl: f.entryUrl,
			explicit: "chosen-explicit-directory",
		}),
	).toBe("chosen-explicit-directory");
	await unlink(join(f.surface, "index.html"));
	expect(
		await resolveHostStaticDirectory({
			entryUrl: f.entryUrl,
			explicit: "chosen-explicit-directory",
		}),
	).toBe("chosen-explicit-directory");
});

test("source entry and missing packaged Surface retain API-only behavior", async () => {
	const f = await fixture();
	expect(
		await resolveHostStaticDirectory({
			entryUrl: pathToFileURL(join(f.runtime, "main.ts")).href,
		}),
	).toBeUndefined();
	const absent = await mkdtemp("C:/tmps/rocut-host-static-absent-");
	expect(
		await resolveHostStaticDirectory({
			entryUrl: pathToFileURL(join(absent, "rocut.mjs")).href,
		}),
	).toBeUndefined();
});

test("existing but incomplete or mismatched embedded Surface rejects instead of guessing", async () => {
	for (const missing of ["index.html", "surface-wasm-package.json"]) {
		const f = await fixture();
		await unlink(join(f.surface, missing));
		await expect(
			resolveHostStaticDirectory({ entryUrl: f.entryUrl }),
		).rejects.toThrow("Invalid embedded Surface");
	}
	const f = await fixture();
	await writeFile(join(f.runtime, "opencut_wasm_bg.wasm"), "wrong wasm");
	await expect(
		resolveHostStaticDirectory({ entryUrl: f.entryUrl }),
	).rejects.toThrow("Invalid embedded Surface");
});

test("escaped receipt path and redirected embedded directory fail closed", async () => {
	const f = await fixture();
	await writeFile(
		join(f.surface, "surface-wasm-package.json"),
		JSON.stringify({
			coreWasm: { ...f.receipt.coreWasm, path: "../opencut_wasm_bg.wasm" },
		}),
	);
	await expect(
		resolveHostStaticDirectory({ entryUrl: f.entryUrl }),
	).rejects.toThrow("Invalid embedded Surface");
	const redirected = await mkdtemp("C:/tmps/rocut-host-static-redirect-");
	await writeFile(join(redirected, "rocut.mjs"), "// packed entry\n");
	await symlink(f.surface, join(redirected, "surface"), "junction");
	await expect(
		resolveHostStaticDirectory({
			entryUrl: pathToFileURL(join(redirected, "rocut.mjs")).href,
		}),
	).rejects.toThrow("Invalid embedded Surface");
});
