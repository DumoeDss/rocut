import { expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	rm,
	writeFile,
	symlink,
	unlink,
} from "node:fs/promises";
import { join } from "node:path";
import {
	nativeExportManifestBytes,
	readNativeExportFile,
} from "../native-export-readback";

async function fixture(run: (dir: string) => Promise<void>) {
	await mkdir("C:/tmps", { recursive: true });
	const dir = await mkdtemp("C:/tmps/rocut-native-export-readback-");
	try {
		await run(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test("bounded read rejects oversized bytes and detects replacement after open", () =>
	fixture(async (dir) => {
		const path = join(dir, "artifact.webm");
		await writeFile(path, new Uint8Array(32));
		await expect(readNativeExportFile(path, 31)).rejects.toThrow("read-limit");
		await expect(
			readNativeExportFile(path, 32, async () => {
				await unlink(path);
				await writeFile(path, new Uint8Array(32));
			}),
		).rejects.toThrow("read-changed");
	}));

test("bounded read refuses redirected parent directories without following a junction", () =>
	fixture(async (dir) => {
		const real = join(dir, "real");
		const redirected = join(dir, "redirected");
		await mkdir(real);
		await writeFile(join(real, "artifact.webm"), new Uint8Array(32));
		await symlink(real, redirected, "junction");
		await expect(
			readNativeExportFile(join(redirected, "artifact.webm"), 32),
		).rejects.toThrow("directory-redirected");
		await unlink(redirected);
	}));

test("manifest JSON byte serialization is stable recursively without changing values", () => {
	const first = nativeExportManifestBytes({
		z: [1, { b: true, a: null }],
		a: { y: "fixed", x: 4 },
	});
	const second = nativeExportManifestBytes({
		a: { x: 4, y: "fixed" },
		z: [1, { a: null, b: true }],
	});
	expect(first.equals(second)).toBe(true);
	expect(first.toString("utf8")).toBe(
		'{"a":{"x":4,"y":"fixed"},"z":[1,{"a":null,"b":true}]}',
	);
});
