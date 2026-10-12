import { expect, test } from "bun:test";
import { access, mkdtemp, readFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runCompilerChild } from "../programmatic/engines/compiler-process";

// These are fixed test compiler entries, not authored composition sources.
const readConfig = `const fs=require('node:fs/promises');
(async()=>{let input='';for await(const chunk of process.stdin)input+=chunk;
const config=JSON.parse(input);`;
const finish = `})().catch(error=>{console.error(error.message);process.exit(1);});`;

test("compiler preserves only the exact Electron Node-mode flag", async () => {
	const originalFlag = process.env.ELECTRON_RUN_AS_NODE;
	const originalPrivate = process.env.ROCUT_COMPILER_PRIVATE_TEST;
	process.env.ROCUT_COMPILER_PRIVATE_TEST = "must-not-inherit";
	try {
		for (const flag of [undefined, "0", "true", "1"]) {
			if (flag === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
			else process.env.ELECTRON_RUN_AS_NODE = flag;
			await runCompilerChild(
				{ expected: flag === "1" ? "1" : null },
				AbortSignal.timeout(5000),
				`${readConfig}
if((process.env.ELECTRON_RUN_AS_NODE??null)!==config.expected)throw Error('Node-mode flag changed');
if(process.env.ROCUT_COMPILER_PRIVATE_TEST!==undefined)throw Error('private environment inherited');
${finish}`,
			);
		}
	} finally {
		if (originalFlag === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
		else process.env.ELECTRON_RUN_AS_NODE = originalFlag;
		if (originalPrivate === undefined)
			delete process.env.ROCUT_COMPILER_PRIVATE_TEST;
		else process.env.ROCUT_COMPILER_PRIVATE_TEST = originalPrivate;
	}
});

test("large fixed compiler starts without command-line transport and cleans its private entry", async () => {
	const directory = await mkdtemp(join(tmpdir(), "rocut-compiler-test-"));
	const output = join(directory, "result.json");
	try {
		const script = `${readConfig}
if(config.label!=='资源桥')throw Error('stdin configuration corrupted');
await fs.writeFile(config.output,JSON.stringify({entry:process.argv[1],arguments:process.argv.slice(2)}),{flag:'wx'});
${finish}\n/*${"fixed compiler padding ".repeat(4096)}*/`;
		expect(script.length).toBeGreaterThan(65536);
		await runCompilerChild(
			{ output, label: "资源桥" },
			AbortSignal.timeout(5000),
			script,
		);
		const result = JSON.parse(await readFile(output, "utf8"));
		expect(result.arguments).toEqual([]);
		expect(result.entry.endsWith("compiler.cjs")).toBe(true);
		await expect(access(result.entry)).rejects.toThrow();
		await expect(access(dirname(result.entry))).rejects.toThrow();
	} finally {
		await rm(output, { force: true });
		await rmdir(directory);
	}
});

test("failed fixed compiler reports bounded stderr and cleans its private entry", async () => {
	const directory = await mkdtemp(join(tmpdir(), "rocut-compiler-test-"));
	const output = join(directory, "entry.txt");
	try {
		const failure = await runCompilerChild(
			{ output },
			AbortSignal.timeout(5000),
			`${readConfig}await fs.writeFile(config.output,process.argv[1],{flag:'wx'});
throw Error('x'.repeat(6000)+'fixed-compiler-failure');${finish}`,
		).then(
			() => "unexpected completion",
			(error: Error) => error.message,
		);
		expect(failure).toContain("fixed-compiler-failure");
		expect(failure.length).toBeLessThanOrEqual(
			"Engine compiler failed: ".length + 2000,
		);
		const entry = await readFile(output, "utf8");
		await expect(access(entry)).rejects.toThrow();
		await expect(access(dirname(entry))).rejects.toThrow();
	} finally {
		await rm(output, { force: true });
		await rmdir(directory);
	}
});

test("aborted fixed compiler closes before its private entry is removed", async () => {
	const directory = await mkdtemp(join(tmpdir(), "rocut-compiler-test-"));
	const output = join(directory, "entry.txt");
	const controller = new AbortController();
	const pending = runCompilerChild(
		{ output },
		controller.signal,
		`${readConfig}await fs.writeFile(config.output,process.argv[1],{flag:'wx'});
setInterval(()=>{},1000);${finish}`,
	);
	const outcome = pending.then(
		() => "unexpected completion",
		(error: Error) => error.message,
	);
	try {
		let entry: string | undefined;
		for (let attempt = 0; attempt < 100 && !entry; attempt++) {
			try {
				entry = await readFile(output, "utf8");
			} catch {
				await delay(20);
			}
		}
		expect(entry).toBeTruthy();
		controller.abort();
		expect(await outcome).toContain("cancelled");
		await expect(access(entry!)).rejects.toThrow();
		await expect(access(dirname(entry!))).rejects.toThrow();
	} finally {
		controller.abort();
		await outcome;
		await rm(output, { force: true });
		await rmdir(directory);
	}
});

test("pre-aborted compilation never starts a compiler", async () => {
	const controller = new AbortController();
	controller.abort(Error("already cancelled"));
	await expect(
		runCompilerChild({}, controller.signal, "throw Error('must not run');"),
	).rejects.toThrow("already cancelled");
});
