import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import test from "node:test";
test("actual Rust LUT binary preflight rejects overlarge/gapped/overflowed/readback/owner-coerced transports", () => {
	const temp = mkdtempSync(join(tmpdir(), "rocut-lut-adapter-"));
	const executable = join(
		temp,
		process.platform === "win32" ? "transport.exe" : "transport",
	);
	const build = spawnSync(
		"rustc",
		[
			"--edition=2021",
			"--test",
			"rust/crates/editor-api/src/mv_lut_atlas_transport.rs",
			"-o",
			executable,
		],
		{ encoding: "utf8", timeout: 30000 },
	);
	assert.equal(build.status, 0, build.stderr);
	const run = spawnSync(executable, [], { encoding: "utf8", timeout: 30000 });
	assert.equal(run.status, 0, run.stderr);
	assert.match(run.stdout, /4 passed/);
});
test("WASM adapter is Uint8Array-ref transport and checks lengths before either byte copy", () => {
	const source = readFileSync("rust/wasm/src/mv_lut_atlas.rs", "utf8");
	const prepare = source.slice(
		source.indexOf("pub fn prepare("),
		source.indexOf("pub fn sample("),
	);
	assert.match(prepare, /bytes: js_sys::Uint8Array/);
	assert.ok(
		prepare.indexOf("validate_transport_lengths(") <
			prepare.indexOf("bytes.copy_to("),
	);
	assert.ok(
		prepare.indexOf("bounded_string(") < prepare.indexOf("bytes.copy_to("),
	);
	const bind = source.slice(
		source.indexOf("pub fn bind_row("),
		source.indexOf("pub fn row_pixels("),
	);
	assert.match(bind, /rgba: js_sys::Uint8Array/);
	assert.ok(
		bind.indexOf("validate_row_lengths(") < bind.indexOf("rgba.copy_to("),
	);
	assert.match(source, /Serializer::json_compatible/);
	assert.doesNotMatch(
		source,
		/crate::programmatic_resources|serde_json::|script\/fixtures/,
	);
});
