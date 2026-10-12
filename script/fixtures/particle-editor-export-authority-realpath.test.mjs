import assert from "node:assert/strict";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";

const source =
	new TextDecoder("utf8", { fatal: true })
		.decode(
			await readFile(
				new URL("./particle-editor-export-authority.mjs", import.meta.url),
			),
		)
		.replace(
			'"./particle-editor-export-authority-identity.mjs"',
			JSON.stringify(
				new URL(
					"./particle-editor-export-authority-identity.mjs",
					import.meta.url,
				).href,
			),
		) + "\nexport { sameRealPath as testSameRealPath, plain as testPlain };\n";
const { testSameRealPath, testPlain } = await import(
	`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

test(
	"only matching absolute drive root admits Bun bare-drive realpath",
	{ skip: process.platform !== "win32" },
	() => {
		assert.equal(testSameRealPath("E:", "E:\\"), true);
		assert.equal(testSameRealPath("e:", "E:\\"), true);
		for (const [actual, expected] of [
			["F:", "E:\\"],
			["E:", "F:\\"],
			["E:", "E:"],
			["E:", process.cwd()],
			["E:", "E:\\ordinary"],
			["E:relative", "E:\\"],
			["E:\\ordinary", "E:\\"],
			["E:\\", "E:\\ordinary"],
			["\\\\?\\E:\\", "E:\\"],
		])
			assert.equal(testSameRealPath(actual, expected), false);
	},
);

test("ordinary canonical path comparison still rejects a different target", () => {
	const path = resolve("ordinary-file.fixture");
	assert.equal(testSameRealPath(path, path), true);
	assert.equal(
		testSameRealPath(resolve("different-file.fixture"), path),
		false,
	);
});

test("real runtime drive-root result and normal fixture path pass unchanged plain checks", async () => {
	const path = new URL(
			"./particle-editor-export-authority.mjs",
			import.meta.url,
		),
		{ fileURLToPath } = await import("node:url"),
		target = fileURLToPath(path);
	await testPlain(target, false);
	if (process.platform === "win32") {
		let root = resolve(target);
		while (dirname(root) !== root) root = dirname(root);
		assert.equal((await lstat(root)).isSymbolicLink(), false);
		assert.equal(testSameRealPath(await realpath(root), root), true);
	}
});
