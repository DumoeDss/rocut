import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { REMOTION_COMPILER_CHILD } from "../programmatic/engines/remotion-compiler-child";

test("controlled compiler ignores ancestor packages and rejects undeclared relatives", async () => {
	const parent = await realpath(tmpdir());
	const root = await mkdtemp(join(parent, "rocut-compiler-isolation-"));
	const project = join(root, "author"),
		toolchain = join(root, "toolchain");
	const packageAt = async (directory: string, value: string) => {
		await mkdir(directory, { recursive: true });
		await writeFile(
			join(directory, "package.json"),
			JSON.stringify({ name: "fixture-module", main: "index.js" }),
		);
		await writeFile(
			join(directory, "index.js"),
			`export default ${JSON.stringify(value)}`,
		);
	};
	const compilerEntry = createRequire(import.meta.url).resolve("esbuild");
	const execute = async (entry: string, output: string) => {
		const child = spawn(process.execPath, ["-e", REMOTION_COMPILER_CHILD], {
			windowsHide: true,
			stdio: ["pipe", "ignore", "pipe"],
			cwd: parent,
		});
		let error = "";
		child.stderr.on("data", (chunk) => {
			error += chunk;
		});
		const done = new Promise<number | null>((resolve, reject) => {
			child.once("error", reject);
			child.once("close", resolve);
		});
		child.stdin.end(
			JSON.stringify({
				engine: "remotion",
				compilerEntry: pathToFileURL(compilerEntry).href,
				toolchainRoot: toolchain,
				project,
				files: [entry],
				entryFile: entry,
				driver: "import 'rocut:entry'",
				environment: "",
				spec: {},
				outputFile: join(root, output),
			}),
		);
		return { code: await done, error };
	};
	try {
		await mkdir(project);
		await packageAt(
			join(root, "node_modules/fixture-module"),
			"UNDECLARED ANCESTOR",
		);
		await packageAt(
			join(toolchain, "node_modules/fixture-module"),
			"PINNED TOOLCHAIN",
		);
		await writeFile(
			join(project, "entry.js"),
			"import value from 'fixture-module'; window.fixtureValue = value;",
		);
		expect(await execute("entry.js", "valid.html")).toEqual({
			code: 0,
			error: "",
		});
		const html = await readFile(join(root, "valid.html"), "utf8");
		expect(html).toContain("PINNED TOOLCHAIN");
		expect(html).not.toContain("UNDECLARED ANCESTOR");
		await writeFile(join(project, "hidden.js"), "window.hidden = true");
		await writeFile(join(project, "bad.js"), "import './hidden.js'");
		const denied = await execute("bad.js", "invalid.html");
		expect(denied.code).not.toBe(0);
		expect(denied.error).toContain("Compiler read an undeclared source file");
	} finally {
		if (
			dirname(resolve(root)) !== parent ||
			!basename(root).startsWith("rocut-compiler-isolation-")
		)
			throw Error("Unsafe compiler fixture cleanup");
		await rm(root, {
			recursive: true,
			force: true,
			maxRetries: 3,
			retryDelay: 100,
		});
	}
}, 30000);
