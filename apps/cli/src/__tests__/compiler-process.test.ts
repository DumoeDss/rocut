import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
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

test("Electron runtime guard keeps Node mode even without an exact parent flag", async () => {
	const originalElectron = Object.getOwnPropertyDescriptor(
		process.versions,
		"electron",
	);
	const originalFlag = process.env.ELECTRON_RUN_AS_NODE;
	try {
		Object.defineProperty(process.versions, "electron", {
			configurable: true,
			value: "cpu-fixture",
		});
		process.env.ELECTRON_RUN_AS_NODE = "0";
		await runCompilerChild(
			{},
			AbortSignal.timeout(5000),
			`${readConfig}
if(process.env.ELECTRON_RUN_AS_NODE!=='1')throw Error('Electron runtime guard missing');
${finish}`,
		);
	} finally {
		if (originalElectron)
			Object.defineProperty(process.versions, "electron", originalElectron);
		else delete process.versions.electron;
		if (originalFlag === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
		else process.env.ELECTRON_RUN_AS_NODE = originalFlag;
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

const electronPath = process.env.ROCUT_TEST_ELECTRON_PATH;
test.skipIf(!electronPath)(
	"real Electron Node parent preserves child mode and complete UTF8 stdin without secret env",
	async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "rocut-compiler-electron-test-"),
		);
		const entry = join(directory, "parent.mjs"),
			output = join(directory, "result.json");
		try {
			const built = await Bun.build({
				entrypoints: [join(import.meta.dir, "compiler-electron-worker.ts")],
				outdir: directory,
				naming: "parent.mjs",
				target: "node",
			});
			expect(built.success).toBe(true);
			const env: Record<string, string> = {};
			for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "TEMP", "TMP"])
				if (process.env[key] !== undefined) env[key] = process.env[key]!;
			env.ELECTRON_RUN_AS_NODE = "1";
			env.ROCUT_COMPILER_TEST_SECRET = "must-not-propagate";
			const child = spawn(electronPath!, [entry, output], {
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
				env,
			});
			let logs = "";
			child.stdout.on("data", (chunk) => {
				logs = (logs + chunk).slice(-2000);
			});
			child.stderr.on("data", (chunk) => {
				logs = (logs + chunk).slice(-2000);
			});
			const timer = setTimeout(() => child.kill(), 15000);
			const code = await new Promise<number | null>((resolve, reject) => {
				child.once("error", reject);
				child.once("close", resolve);
			}).finally(() => clearTimeout(timer));
			expect({ code, logs }).toEqual({ code: 0, logs: "" });
			expect(JSON.parse(await readFile(output, "utf8"))).toEqual({
				label: "\u8d44\u6e90\u56fe",
				payloadLength: 70000,
				electron: true,
				nodeMode: "1",
				secretInherited: false,
			});
		} finally {
			await rm(output, { force: true });
			await rm(entry, { force: true });
			await rmdir(directory);
		}
	},
	20000,
);
