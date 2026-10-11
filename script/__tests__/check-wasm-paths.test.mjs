import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const gate = fileURLToPath(new URL("../check-wasm-paths.mjs", import.meta.url));
const virtual = "/rustc/6b00bc3880198600130e1cf62b8f8a93494488cc/library/core/src/num/f64.rs";
const invoke = (...args) => spawnSync(process.execPath, [gate, ...args], { encoding: "utf8", windowsHide: true });
function fixture(content, verify) {
	const directory = mkdtempSync(join(tmpdir(), "rocut-path-scanner-"));
	const file = join(directory, "opencut_wasm_bg.wasm");
	try { writeFileSync(file, content, { flag: "wx" }); verify({ directory, file }); }
	finally { unlinkSync(file); rmdirSync(directory); }
}

test("exact observed error literal adjacent to compiler virtual path is accepted", () => {
	fixture("Invalid or incomplete HyperFrames native fallback history identity/coverage" + virtual, ({ file }) => {
		const result = invoke("--file", file);
		assert.equal(result.status, 0, result.stdout + result.stderr);
	});
});

test("virtual-root split never hides a real checkout or user home prefix", () => {
	for (const prefix of ["/workspace/checkout", "/home/alice", "/Users/alice", "/root", "C:\\Users\\alice\\checkout"]) {
		fixture(prefix + virtual, ({ file }) => {
			const result = invoke("--file", file);
			assert.equal(result.status, 1, prefix + "\n" + result.stdout + result.stderr);
		});
	}
});

test("a malformed compiler root is never treated as virtual", () => {
	fixture("/coverage/rustc/not-a-compiler-commit/library/core/src/num/f64.rs", ({ file }) => assert.equal(invoke("--file", file).status, 1));
});

test("private package selection retains both remap anti-vacuity thresholds", () => {
	for (const content of ["clean text", "/cargo/registry/src/example/src/lib.rs", "/opencut/rust/crates/example/src/lib.rs"]) {
		fixture(content, ({ directory }) => {
			const result = invoke("--pkg-dir", directory);
			assert.equal(result.status, 1, result.stdout + result.stderr);
			assert.match(result.stdout + result.stderr, /proves the scan is not vacuous|proves workspace paths were sanctioned/);
		});
	}
	fixture("/cargo/registry/src/example/src/lib.rs\0/opencut/rust/crates/example/src/lib.rs", ({ directory }) => assert.equal(invoke("--pkg-dir", directory).status, 0));
});

test("ambiguous target selection is rejected", () => {
	fixture("clean text", ({ directory, file }) => assert.equal(invoke("--pkg-dir", directory, "--file", file).status, 2));
});

test("this run's actual private binary passes the complete package path gate", { skip: !process.env.ROCUT_TEST_WASM_DIRECTORY }, () => {
	const result = invoke("--pkg-dir", process.env.ROCUT_TEST_WASM_DIRECTORY);
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout, /remapped `\/cargo` prefix present \([1-9]/);
});
