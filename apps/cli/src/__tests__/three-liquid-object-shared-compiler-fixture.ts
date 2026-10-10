import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import { runCompilerChild } from "../programmatic/engines/compiler-process";
import { REMOTION_COMPILER_CHILD } from "../programmatic/engines/remotion-compiler-child";
import { THREE_LIQUID_OBJECT_FRAME_DRIVER } from "../programmatic/engines/three-liquid-object-driver";
import { THREE_LIQUID_OBJECT_BROWSER_MODULE } from "../programmatic/liquid-object-browser-module";
import { runtime, hash } from "./three-liquid-object-provenance-fixture";

export const toolchainRoot =
	"C:/Users/Sayo/AppData/Local/Temp/rocut-three-resources-oSn2hb/.artifacts/three-toolchain/run-YuITk9";

export async function compileLiquidChild({ source }: { source: string }) {
	const root = await mkdtemp("C:/tmps/liquid-shared-compiler-"),
		outputFile = join(root, "compiled.html");
	await writeFile(join(root, "entry.ts"), source, {
		encoding: "utf8",
		flag: "wx",
	});
	const config = {
		engine: "three",
		project: root,
		toolchainRoot,
		compilerEntry: pathToFileURL(
			join(toolchainRoot, "node_modules/esbuild/lib/main.js"),
		).href,
		files: ["entry.ts"],
		entryFile: "entry.ts",
		driver: THREE_LIQUID_OBJECT_FRAME_DRIVER,
		liquidObject: { version: 1, runtime: THREE_LIQUID_OBJECT_BROWSER_MODULE },
		outputFile,
		runtimeNotices: [],
		environment: "",
		spec: {
			width: 64,
			height: 64,
			durationFrames: 8,
			frameRate: { numerator: 24, denominator: 1 },
			seed: 19,
			inputProps: {},
		},
	};
	try {
		await runCompilerChild(
			config,
			AbortSignal.timeout(25000),
			REMOTION_COMPILER_CHILD,
		);
		const html = await readFile(outputFile, "utf8");
		const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
		if (!script) throw Error("Actual child emitted no executable script");
		await writeFile(
			join(root, "receipt.json"),
			JSON.stringify(
				{
					ok: true,
					root,
					compilerChildSha256: hash(REMOTION_COMPILER_CHILD),
					driverSha256: hash(config.driver),
					runtimeSha256: hash(config.liquidObject.runtime),
					htmlSha256: hash(html),
					scope:
						"Actual shared compiler child + installed Three/esbuild bundle; VM top-level only; no Host/WASM/browser/GPU",
				},
				null,
				2,
			),
			{ flag: "wx" },
		);
		return { root, script };
	} catch (error) {
		await writeFile(join(root, "child-failure.txt"), String(error), {
			encoding: "utf8",
			flag: "wx",
		});
		throw Object.assign(error instanceof Error ? error : Error(String(error)), {
			fixtureRoot: root,
		});
	}
}

export function executeTopLevel({ script }: { script: string }) {
	const captureRegistrations: boolean[] = [];
	const sandbox: Record<string, unknown> = {
		__rocutLiquidObjectConfig: {
			version: 1,
			frame: { sessionId: "schema-vm", index: 0, time: 0, seed: 19 },
			policy: runtime().policy,
		},
		__testRegistrationCount: () => captureRegistrations.length,
		addEventListener: (
			...args: [
				type: string,
				listener: unknown,
				options?: { capture?: boolean },
			]
		) => {
			captureRegistrations.push(args[2]?.capture === true);
		},
		setTimeout: () => 1,
		clearTimeout: () => {},
		TextEncoder,
		AbortController,
		Event,
		parent: {
			postMessage: () => {
				throw Error("VM top-level must not call Host");
			},
		},
	};
	sandbox.window = sandbox;
	runInNewContext(script, sandbox, { timeout: 5000 });
	return { sandbox, captureRegistrations };
}
